(function () {
  'use strict';
  const API_BASE = window.API_BASE || 'https://localhost:5001/api';
  const PAGE_SIZE = 20;
  const TABS = {
    sell_membership: { kind: 'sell', lineType: 'membership', title: 'Sell · Memberships' },
    sell_products: { kind: 'sell', lineType: 'retail', title: 'Sell · Products' },
    buy: { kind: 'buy', title: 'Buy · Suppliers' },
    all: { kind: 'all', title: 'All documents' },
  };

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
  }
  function getH(extra) {
    const t = getToken();
    const h = Object.assign(
      {
        'Content-Type': 'application/json',
        // Free ngrok blocks browser GETs without this — fetch then throws and list stays on Loading…
        'ngrok-skip-browser-warning': 'true',
      },
      extra || {},
    );
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
  const canViewSell =
    perms.has('reports.financial.view') || /Owner|Manager/i.test(role);
  const canViewBuy =
    perms.has('inventory.view') ||
    perms.has('inventory.purchase') ||
    perms.has('inventory.manage') ||
    /Owner|Manager/i.test(role);
  const canVoid = perms.has('payments.refund.approve') || /Owner/i.test(role);
  const canResend = perms.has('sales.sell') || /Owner|Manager|Receptionist/i.test(role);
  const canReceipt = canResend;

  const params = new URLSearchParams(location.search);
  let activeTab = params.get('tab') || 'sell_membership';
  if (!TABS[activeTab]) activeTab = 'sell_membership';
  if (params.get('grnId')) activeTab = 'buy';

  let page = 1;
  let selectedId = null;
  let selectedKind = null; // sell | buy
  let selectedInvoice = null;
  let buyRows = [];
  let voidTargetId = null;
  let receiptInvoiceId = null;
  let pendingGrnId = params.get('grnId') || params.get('id') || null;

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
  function toast(msg, type, htmlExtra) {
    const el = document.getElementById('toast');
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    el.innerHTML = esc(msg) + (htmlExtra || '');
    setTimeout(() => el.classList.remove('show'), 5200);
  }
  function problemMessage(data, status) {
    if (!data) return 'Request failed (' + status + ')';
    const title = data.title || '';
    const detail = data.detail || data.message || data.error || '';
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
    let res;
    try {
      res = await fetch(API_BASE + path, fetchOpts);
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: {
          message:
            'Network error talking to API (' +
            (API_BASE || '') +
            '). ' +
            (err && err.message ? err.message : 'Failed to fetch'),
        },
        text: null,
      };
    }
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
    else if (!res.ok) {
      const text = await res.text().catch(() => '');
      data = { message: text ? text.slice(0, 180) : 'Request failed (' + res.status + ')' };
    }
    return { ok: res.ok, status: res.status, data, text: null };
  }

  function syncTabUi() {
    document.querySelectorAll('.hub-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === activeTab);
    });
    const meta = TABS[activeTab];
    document.getElementById('listTitle').textContent = meta.title;
    const isBuy = meta.kind === 'buy';
    document.getElementById('sellFilters').style.display = isBuy ? 'none' : '';
    document.getElementById('buyFilters').style.display = isBuy ? '' : 'none';
    document.getElementById('theadSell').style.display = isBuy ? 'none' : '';
    document.getElementById('theadBuy').style.display = isBuy ? '' : 'none';
    const url = new URL(location.href);
    url.searchParams.set('tab', activeTab);
    if (pendingGrnId && activeTab === 'buy') url.searchParams.set('grnId', pendingGrnId);
    else url.searchParams.delete('grnId');
    history.replaceState(null, '', url.pathname + url.search);
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

  function renderPager(totalPages, totalCount, onPage) {
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
            onPage();
          }
        };
      if (next)
        next.onclick = () => {
          if (page < (totalPages || 1)) {
            page += 1;
            onPage();
          }
        };
    });
  }

  function renderSellRows(items) {
    const tbody = document.getElementById('tbody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No invoices</td></tr>';
      return;
    }
    tbody.innerHTML = items
      .map((inv) => {
        const sel =
          selectedKind === 'sell' && selectedId && String(inv.id) === String(selectedId)
            ? ' sel'
            : '';
        return (
          '<tr class="' +
          sel +
          '" data-kind="sell" data-id="' +
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
    bindRowClicks();
  }

  function renderBuyRows(items) {
    buyRows = items || [];
    const tbody = document.getElementById('tbody');
    if (!buyRows.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="muted">No purchase documents (goods receipts)</td></tr>';
      return;
    }
    tbody.innerHTML = buyRows
      .map((row) => {
        const sel =
          selectedKind === 'buy' && selectedId && String(row.id) === String(selectedId)
            ? ' sel'
            : '';
        return (
          '<tr class="' +
          sel +
          '" data-kind="buy" data-id="' +
          esc(row.id) +
          '">' +
          '<td><span class="tp purchase_doc">فاتورة شراء</span><div class="muted"><code>' +
          esc(String(row.id).slice(0, 8)) +
          '…</code></div></td>' +
          '<td>' +
          esc(row.supplierName || '—') +
          '</td>' +
          '<td>' +
          esc(row.warehouseCode || '—') +
          '</td>' +
          '<td>' +
          esc(dt(row.receivedAtUtc)) +
          '</td>' +
          '<td>' +
          esc(money(row.totalAmount)) +
          '</td>' +
          '<td><span class="st received">' +
          esc(row.status || 'received') +
          '</span></td>' +
          '<td><a href="/dashboard/inventory/purchase-orders/?id=' +
          esc(row.purchaseOrderId) +
          '" onclick="event.stopPropagation()">PO</a></td>' +
          '</tr>'
        );
      })
      .join('');
    bindRowClicks();
  }

  function bindRowClicks() {
    document.querySelectorAll('#tbody tr[data-id]').forEach((tr) => {
      tr.onclick = () => {
        const kind = tr.getAttribute('data-kind');
        const id = tr.getAttribute('data-id');
        if (kind === 'buy') selectBuy(id);
        else selectInvoice(id);
      };
    });
  }

  async function loadSellList(lineType) {
    if (!canViewSell) {
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="7" class="muted">Need reports.financial.view</td></tr>';
      renderPager(1, 0, loadList);
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
    if (lineType) q.set('lineType', lineType);

    const res = await api('GET', '/invoices?' + q.toString());
    const tbody = document.getElementById('tbody');
    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      renderPager(1, 0, loadList);
      return;
    }
    const data = res.data || {};
    const items = Array.isArray(data) ? data : data.items || [];
    const totalPages = data.totalPages != null ? data.totalPages : 1;
    const totalCount = data.totalCount != null ? data.totalCount : items.length;
    renderPager(totalPages, totalCount, loadList);
    renderSellRows(items);
  }

  async function loadBuyList() {
    if (!canViewBuy) {
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="7" class="muted">Need inventory.view</td></tr>';
      renderPager(1, 0, loadList);
      return;
    }
    const q = new URLSearchParams();
    const from = document.getElementById('fBuyFrom').value;
    const to = document.getElementById('fBuyTo').value;
    const supplierId = document.getElementById('fSupplierId').value.trim();
    if (from) q.set('fromUtc', new Date(from + 'T00:00:00').toISOString());
    if (to) q.set('toUtc', new Date(to + 'T23:59:59').toISOString());
    if (supplierId) q.set('supplierId', supplierId);

    const res = await api('GET', '/inventory/goods-receipts' + (q.toString() ? '?' + q : ''));
    if (!res.ok) {
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="7" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      renderPager(1, 0, loadList);
      return;
    }
    const items = Array.isArray(res.data) ? res.data : (res.data && res.data.items) || [];
    renderPager(1, items.length, loadList);
    renderBuyRows(items);

    if (pendingGrnId) {
      const id = pendingGrnId;
      pendingGrnId = null;
      await selectBuy(id);
    }
  }

  async function loadAllList() {
    // Sell page + Buy capped list merged client-side for the hub overview.
    page = 1;
    document.getElementById('theadSell').style.display = '';
    document.getElementById('theadBuy').style.display = 'none';
    document.getElementById('sellFilters').style.display = '';
    document.getElementById('buyFilters').style.display = 'none';

    const sellPromise = canViewSell
      ? api('GET', '/invoices?page=1&pageSize=50')
      : Promise.resolve({ ok: true, data: { items: [] } });
    const buyPromise = canViewBuy
      ? api('GET', '/inventory/goods-receipts')
      : Promise.resolve({ ok: true, data: [] });

    const [sellRes, buyRes] = await Promise.all([sellPromise, buyPromise]);
    const sellItems = sellRes.ok
      ? Array.isArray(sellRes.data)
        ? sellRes.data
        : (sellRes.data && sellRes.data.items) || []
      : [];
    const buyItems = buyRes.ok
      ? Array.isArray(buyRes.data)
        ? buyRes.data
        : (buyRes.data && buyRes.data.items) || []
      : [];

    const merged = [];
    sellItems.forEach((inv) => {
      merged.push({
        sortAt: inv.issuedAt,
        kind: 'sell',
        id: inv.id,
        html:
          '<tr data-kind="sell" data-id="' +
          esc(inv.id) +
          '"><td><code>' +
          esc(inv.invoiceNumber) +
          '</code></td><td><span class="tp ' +
          esc(inv.type) +
          '">' +
          esc(inv.type) +
          '</span></td><td>' +
          esc(inv.memberNameSnapshot || '—') +
          '</td><td>' +
          esc(dt(inv.issuedAt)) +
          '</td><td>' +
          esc(money(inv.total, inv.currency)) +
          '</td><td><span class="st ' +
          esc(inv.status) +
          '">' +
          esc(inv.status) +
          '</span></td><td>' +
          pdfCell(inv) +
          '</td></tr>',
      });
    });
    buyItems.forEach((row) => {
      merged.push({
        sortAt: row.receivedAtUtc,
        kind: 'buy',
        id: row.id,
        html:
          '<tr data-kind="buy" data-id="' +
          esc(row.id) +
          '"><td><span class="tp purchase_doc">شراء</span> <code>' +
          esc(String(row.id).slice(0, 8)) +
          '…</code></td><td>Buy</td><td>' +
          esc(row.supplierName || '—') +
          '</td><td>' +
          esc(dt(row.receivedAtUtc)) +
          '</td><td>' +
          esc(money(row.totalAmount)) +
          '</td><td><span class="st received">received</span></td><td>—</td></tr>',
      });
    });
    merged.sort((a, b) => new Date(b.sortAt || 0) - new Date(a.sortAt || 0));
    buyRows = buyItems;
    const tbody = document.getElementById('tbody');
    if (!merged.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No documents</td></tr>';
    } else {
      tbody.innerHTML = merged.map((m) => m.html).join('');
      bindRowClicks();
    }
    renderPager(1, merged.length, loadList);
  }

  async function loadList() {
    syncTabUi();
    const meta = TABS[activeTab];
    if (meta.kind === 'buy') return loadBuyList();
    if (meta.kind === 'all') return loadAllList();
    return loadSellList(meta.lineType);
  }

  async function selectInvoice(id) {
    selectedId = id;
    selectedKind = 'sell';
    document.querySelectorAll('#tbody tr').forEach((tr) => {
      tr.classList.toggle('sel', tr.getAttribute('data-id') === id && tr.getAttribute('data-kind') === 'sell');
    });
    const res = await api('GET', '/invoices/' + id);
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    selectedInvoice = res.data;
    renderDetail(res.data);
  }

  async function selectBuy(id) {
    selectedId = id;
    selectedKind = 'buy';
    document.querySelectorAll('#tbody tr').forEach((tr) => {
      tr.classList.toggle('sel', tr.getAttribute('data-id') === id && tr.getAttribute('data-kind') === 'buy');
    });
    const cached = buyRows.find((r) => String(r.id) === String(id));
    const res = await api('GET', '/inventory/goods-receipts/' + id);
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    renderBuyDetail(Object.assign({}, cached || {}, res.data));
  }

  function renderBuyDetail(doc) {
    document.getElementById('detailEmpty').style.display = 'none';
    const body = document.getElementById('detailBody');
    body.style.display = 'block';
    const lines = Array.isArray(doc.lines) ? doc.lines : [];
    const linesHtml = lines.length
      ? '<table class="lines-tbl"><thead><tr><th>Product</th><th>Qty</th><th>Unit cost</th><th>Line</th></tr></thead><tbody>' +
        lines
          .map((ln) => {
            const lineTotal =
              ln.unitCost != null && ln.qty != null ? Number(ln.qty) * Number(ln.unitCost) : null;
            return (
              '<tr><td><code>' +
              esc(ln.productId) +
              '</code>' +
              (ln.batchNumber ? '<div class="muted">Batch ' + esc(ln.batchNumber) + '</div>' : '') +
              '</td><td>' +
              esc(String(ln.qty)) +
              '</td><td>' +
              esc(money(ln.unitCost)) +
              '</td><td>' +
              esc(money(lineTotal)) +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table>'
      : '<p class="muted">No lines</p>';

    body.innerHTML =
      '<div class="detail-meta">' +
      '<div class="row"><span>Doc</span><span class="tp purchase_doc">فاتورة شراء / Purchase</span></div>' +
      '<div class="row"><span>Status</span><span class="st received">received</span></div>' +
      '<div class="row"><span>Supplier</span><span>' +
      esc(doc.supplierName || '—') +
      '</span></div>' +
      '<div class="row"><span>Warehouse</span><span>' +
      esc(doc.warehouseCode || doc.warehouseId || '—') +
      '</span></div>' +
      '<div class="row"><span>Received</span><span>' +
      esc(dt(doc.receivedAtUtc)) +
      '</span></div>' +
      '<div class="row"><span>Total</span><strong>' +
      esc(money(doc.totalAmount)) +
      '</strong></div>' +
      '<div class="row"><span>Note</span><span class="muted">Paid/due live on supplier statement — not allocated per GRN yet.</span></div>' +
      '</div>' +
      '<h3 style="font-family:var(--fd);font-size:14px;margin-bottom:6px">Lines</h3>' +
      linesHtml +
      '<div class="actions">' +
      '<a class="btn secondary" href="/dashboard/inventory/purchase-orders/?id=' +
      esc(doc.purchaseOrderId) +
      '"><i class="ti ti-truck"></i> Open PO</a>' +
      (doc.supplierId
        ? '<a class="btn secondary" href="/dashboard/inventory/suppliers/?id=' +
          esc(doc.supplierId) +
          '"><i class="ti ti-building-store"></i> Supplier statement</a>'
        : '') +
      '</div>';
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
    if (btnReceipt) btnReceipt.onclick = () => openReceiptModal(inv.id);
    const btnResend = document.getElementById('btnResend');
    if (btnResend) btnResend.onclick = () => resendInvoice(inv.id);
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
  document.getElementById('btnBuyFilter').onclick = () => {
    page = 1;
    loadList();
  };

  document.querySelectorAll('.hub-tab').forEach((btn) => {
    btn.onclick = () => {
      activeTab = btn.getAttribute('data-tab');
      page = 1;
      selectedId = null;
      selectedKind = null;
      document.getElementById('detailEmpty').style.display = '';
      document.getElementById('detailBody').style.display = 'none';
      loadList().catch((err) => {
        document.getElementById('tbody').innerHTML =
          '<tr><td colspan="7" class="muted">' +
          esc(err && err.message ? err.message : 'Failed to load') +
          '</td></tr>';
      });
    };
  });

  loadList().catch((err) => {
    document.getElementById('tbody').innerHTML =
      '<tr><td colspan="7" class="muted">' +
      esc(err && err.message ? err.message : 'Failed to load') +
      '</td></tr>';
  });
})();
