(function () {
  'use strict';
  const API_BASE = window.API_BASE || 'https://localhost:5001/api';
  const PAGE_SIZE = 20;

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
  }
  function getH(extra) {
    const t = getToken();
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user'));
    } catch (_) {
      return null;
    }
  }
  function decodeJwt(token) {
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_) {
      return null;
    }
  }
  function getPerms() {
    const p = decodeJwt(getToken() || '');
    const set = new Set();
    if (!p) return set;
    const raw = p.perm;
    if (Array.isArray(raw)) raw.forEach((x) => set.add(String(x)));
    else if (raw) set.add(String(raw));
    return set;
  }

  const user = getUser();
  const perms = getPerms();
  const role = (user && user.role) || '';
  const canView =
    perms.has('reports.financial.view') || /Owner|Manager/i.test(role);
  const canVoid = perms.has('payments.refund.approve') || /Owner/i.test(role);
  const canResend = perms.has('sales.sell') || /Owner|Manager|Receptionist/i.test(role);
  const canReceipt = canResend;

  let page = 1;
  let selectedId = null;
  let selectedInvoice = null;
  let voidTargetId = null;
  let receiptInvoiceId = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function money(n, currency) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const cur = currency || 'EGP';
    try {
      return new Intl.NumberFormat('en-EG', { style: 'currency', currency: cur }).format(Number(n));
    } catch (_) {
      return cur + ' ' + Number(n).toFixed(2);
    }
  }
  /** Display amount as stored. Credit notes are positive — never negate for display. */
  function displayTotal(inv) {
    const amt = money(inv.total, inv.currency);
    if (inv.type === 'credit_note') {
      return amt + ' <span class="net-hint">(credit note — nets against invoices)</span>';
    }
    return amt;
  }
  function dt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? esc(iso)
      : d.toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  }
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    el.textContent = msg;
    setTimeout(() => el.classList.remove('show'), 4200);
  }
  function problemMessage(data, status) {
    if (!data) return 'Request failed (' + status + ')';
    const title = data.title || '';
    const detail = data.detail || data.message || '';
    const map = {
      INVOICE_NOT_FOUND: 'Invoice not found.',
      ALREADY_VOIDED: 'Invoice is already voided.',
      FEATURE_DISABLED: 'Feature disabled for this tenant.',
      FORBIDDEN: 'You do not have permission for this action.',
    };
    if (map[title]) return map[title];
    if (detail && detail.indexOf(' / ') !== -1) return detail.split(' / ')[0].trim();
    return detail || title || 'Request failed (' + status + ')';
  }

  async function api(method, path, body, opts) {
    const headers = getH(opts && opts.headers);
    if (opts && opts.acceptHtml) delete headers['Content-Type'];
    const fetchOpts = { method, headers };
    if (body !== undefined) fetchOpts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, fetchOpts);
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, data: null, text: null };
    }
    if (opts && opts.acceptHtml) {
      const text = await res.text();
      return { ok: res.ok, status: res.status, data: null, text };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, text: null };
  }

  function pdfCell(inv) {
    if (inv.pdfUrl) {
      return (
        '<span class="pdf-ready"><a href="' +
        esc(inv.pdfUrl) +
        '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open PDF</a></span>'
      );
    }
    return '<span class="pdf-pending" title="PDF still generating">Not ready yet</span>';
  }

  function renderPager(totalPages, totalCount) {
    const mk =
      '<button type="button" class="btn secondary js-prev"' +
      (page <= 1 ? ' disabled' : '') +
      '>Prev</button>' +
      '<span>Page ' +
      page +
      ' / ' +
      Math.max(1, totalPages || 1) +
      ' · ' +
      esc(String(totalCount || 0)) +
      ' total</span>' +
      '<button type="button" class="btn secondary js-next"' +
      (page >= (totalPages || 1) ? ' disabled' : '') +
      '>Next</button>';
    ['pagerTop', 'pagerBottom'].forEach((id) => {
      const el = document.getElementById(id);
      el.innerHTML = mk;
      const prev = el.querySelector('.js-prev');
      const next = el.querySelector('.js-next');
      if (prev)
        prev.onclick = () => {
          if (page > 1) {
            page -= 1;
            loadList();
          }
        };
      if (next)
        next.onclick = () => {
          if (page < (totalPages || 1)) {
            page += 1;
            loadList();
          }
        };
    });
  }

  async function loadList() {
    if (!canView) {
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="7" class="muted">Need reports.financial.view</td></tr>';
      return;
    }
    const q = new URLSearchParams();
    q.set('page', String(page));
    q.set('pageSize', String(PAGE_SIZE));
    const from = document.getElementById('fFrom').value;
    const to = document.getElementById('fTo').value;
    const memberId = document.getElementById('fMemberId').value.trim();
    const status = document.getElementById('fStatus').value;
    const type = document.getElementById('fType').value;
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (memberId) q.set('memberId', memberId);
    if (status) q.set('status', status);
    if (type) q.set('type', type);

    const res = await api('GET', '/invoices?' + q.toString());
    const tbody = document.getElementById('tbody');
    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      renderPager(1, 0);
      return;
    }

    const data = res.data || {};
    const items = Array.isArray(data) ? data : data.items || [];
    const totalPages = data.totalPages != null ? data.totalPages : 1;
    const totalCount = data.totalCount != null ? data.totalCount : items.length;
    renderPager(totalPages, totalCount);

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No invoices</td></tr>';
      return;
    }

    tbody.innerHTML = items
      .map((inv) => {
        const sel = selectedId && String(inv.id) === String(selectedId) ? ' sel' : '';
        return (
          '<tr class="' +
          sel +
          '" data-id="' +
          esc(inv.id) +
          '">' +
          '<td><code>' +
          esc(inv.invoiceNumber) +
          '</code></td>' +
          '<td><span class="tp ' +
          esc(inv.type) +
          '">' +
          esc(inv.type) +
          '</span></td>' +
          '<td>' +
          esc(inv.memberNameSnapshot || '—') +
          '<div class="muted">' +
          esc(inv.memberPhoneSnapshot || '') +
          '</div></td>' +
          '<td>' +
          esc(dt(inv.issuedAt)) +
          '</td>' +
          '<td>' +
          esc(money(inv.total, inv.currency)) +
          (inv.type === 'credit_note' ? ' <span class="muted">CN</span>' : '') +
          '</td>' +
          '<td><span class="st ' +
          esc(inv.status) +
          '">' +
          esc(inv.status) +
          '</span></td>' +
          '<td>' +
          pdfCell(inv) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = () => selectInvoice(tr.getAttribute('data-id'));
    });
  }

  async function selectInvoice(id) {
    selectedId = id;
    document.querySelectorAll('#tbody tr').forEach((tr) => {
      tr.classList.toggle('sel', tr.getAttribute('data-id') === id);
    });
    const res = await api('GET', '/invoices/' + id);
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    selectedInvoice = res.data;
    renderDetail(res.data);
  }

  function renderDetail(inv) {
    document.getElementById('detailEmpty').style.display = 'none';
    const body = document.getElementById('detailBody');
    body.style.display = 'block';

    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const linesHtml = lines.length
      ? '<table class="lines-tbl"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead><tbody>' +
        lines
          .map(
            (ln) =>
              '<tr><td>' +
              esc(ln.description) +
              (ln.descriptionAr
                ? '<div class="muted" dir="rtl">' + esc(ln.descriptionAr) + '</div>'
                : '') +
              '</td><td>' +
              esc(String(ln.qty != null ? ln.qty : 1)) +
              '</td><td>' +
              esc(money(ln.unitPrice, inv.currency)) +
              '</td><td>' +
              esc(money(ln.lineTotal, inv.currency)) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table>'
      : '<p class="muted">No lines</p>';

    const pdfBlock = inv.pdfUrl
      ? '<a class="btn secondary" href="' +
        esc(inv.pdfUrl) +
        '" target="_blank" rel="noopener"><i class="ti ti-file-type-pdf"></i> PDF</a>'
      : '<span class="pdf-pending">PDF not ready yet</span>';

    const actions = [];
    if (canReceipt && inv.status === 'issued') {
      actions.push(
        '<button type="button" class="btn secondary" id="btnReceipt"><i class="ti ti-printer"></i> 80mm receipt</button>',
      );
    }
    if (canResend && inv.status === 'issued') {
      actions.push(
        '<button type="button" class="btn secondary" id="btnResend"><i class="ti ti-send"></i> Resend</button>',
      );
    }
    if (canVoid && inv.status === 'issued') {
      actions.push(
        '<button type="button" class="btn danger" id="btnVoid"><i class="ti ti-ban"></i> Void</button>',
      );
    }

    body.innerHTML =
      '<div class="detail-meta">' +
      '<div class="row"><span>Number</span><strong>' +
      esc(inv.invoiceNumber) +
      '</strong></div>' +
      '<div class="row"><span>Type</span><span class="tp ' +
      esc(inv.type) +
      '">' +
      esc(inv.type) +
      '</span></div>' +
      '<div class="row"><span>Status</span><span class="st ' +
      esc(inv.status) +
      '">' +
      esc(inv.status) +
      '</span></div>' +
      '<div class="row"><span>Member</span><span>' +
      esc(inv.memberNameSnapshot) +
      '<br><span class="muted">' +
      esc(inv.memberPhoneSnapshot || '') +
      '</span></span></div>' +
      '<div class="row"><span>Issued</span><span>' +
      esc(dt(inv.issuedAt)) +
      '</span></div>' +
      (inv.saleId
        ? '<div class="row"><span>Sale</span><code>' + esc(inv.saleId) + '</code></div>'
        : '') +
      (inv.originalInvoiceId
        ? '<div class="row"><span>Original invoice</span><code>' +
          esc(inv.originalInvoiceId) +
          '</code></div>'
        : '') +
      (inv.voidReason
        ? '<div class="row"><span>Void reason</span><span>' + esc(inv.voidReason) + '</span></div>'
        : '') +
      '</div>' +
      '<h3 style="font-family:var(--fd);font-size:14px;margin-bottom:6px">Lines (snapshot)</h3>' +
      linesHtml +
      '<div class="totals">' +
      '<div>Subtotal: ' +
      esc(money(inv.subtotal, inv.currency)) +
      '</div>' +
      '<div>Discount: ' +
      esc(money(inv.discountAmount, inv.currency)) +
      '</div>' +
      '<div>VAT (' +
      esc(String(inv.vatRate != null ? inv.vatRate : '')) +
      '%): ' +
      esc(money(inv.vatAmount, inv.currency)) +
      '</div>' +
      '<div class="grand">Total: ' +
      displayTotal(inv) +
      '</div>' +
      '</div>' +
      '<div class="actions">' +
      pdfBlock +
      actions.join('') +
      '</div>';

    const btnReceipt = document.getElementById('btnReceipt');
    if (btnReceipt) {
      btnReceipt.onclick = () => openReceiptModal(inv.id);
    }
    const btnResend = document.getElementById('btnResend');
    if (btnResend) {
      btnResend.onclick = () => resendInvoice(inv.id);
    }
    const btnVoid = document.getElementById('btnVoid');
    if (btnVoid) {
      btnVoid.onclick = () => {
        voidTargetId = inv.id;
        document.getElementById('voidReason').value = '';
        document.getElementById('voidModal').classList.add('show');
      };
    }
  }

  async function resendInvoice(id) {
    const res = await api('POST', '/invoices/' + id + '/resend');
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    toast('Invoice resend queued.', 'ok');
  }

  document.getElementById('btnVoidCancel').onclick = () => {
    document.getElementById('voidModal').classList.remove('show');
    voidTargetId = null;
  };
  document.getElementById('btnVoidConfirm').onclick = async () => {
    const reason = document.getElementById('voidReason').value.trim();
    if (!reason || !voidTargetId) {
      toast('Void reason required.', 'err');
      return;
    }
    const res = await api('POST', '/invoices/' + voidTargetId + '/void', { reason });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    document.getElementById('voidModal').classList.remove('show');
    toast('Invoice voided.', 'ok');
    const id = voidTargetId;
    voidTargetId = null;
    await loadList();
    await selectInvoice(id);
  };

  function openReceiptModal(id) {
    receiptInvoiceId = id;
    document.getElementById('receiptPaymentId').value = '';
    document.getElementById('receiptFrame').srcdoc =
      '<p style="padding:16px;font-family:sans-serif;color:#666">Click Load to fetch receipt HTML.</p>';
    document.getElementById('printModal').classList.add('show');
  }

  document.getElementById('btnPrintCancel').onclick = () => {
    document.getElementById('printModal').classList.remove('show');
    receiptInvoiceId = null;
  };

  document.getElementById('btnLoadReceipt').onclick = async () => {
    if (!receiptInvoiceId) return;
    const paymentId = document.getElementById('receiptPaymentId').value.trim();
    let path = '/invoices/' + receiptInvoiceId + '/receipt-html';
    if (paymentId) path += '?paymentId=' + encodeURIComponent(paymentId);
    const res = await api('GET', path, undefined, { acceptHtml: true });
    if (!res.ok) {
      let msg = 'Failed to load receipt (' + res.status + ')';
      try {
        const parsed = JSON.parse(res.text || '{}');
        msg = problemMessage(parsed, res.status);
      } catch (_) {}
      toast(msg, 'err');
      return;
    }
    document.getElementById('receiptFrame').srcdoc = res.text || '';
    if (paymentId) {
      toast('Receipt loaded with payment section (same invoice number).', 'ok');
    }
  };

  document.getElementById('btnPrintReceipt').onclick = () => {
    const frame = document.getElementById('receiptFrame');
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (e) {
      toast('Print failed — load the receipt first.', 'err');
    }
  };

  document.getElementById('btnFilter').onclick = () => {
    page = 1;
    loadList();
  };

  loadList();
})();
