(function () {
  'use strict';
  const API_BASE = window.API_BASE || 'https://localhost:5001/api';

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
  }
  function getH() {
    const t = getToken();
    const h = { 'Content-Type': 'application/json' };
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
  const mySub = (decodeJwt(getToken() || '') || {}).sub || (user && user.id) || '';
  const canRequest = perms.has('payments.refund.request') || /Owner|Manager/i.test(role);
  const canApprove = perms.has('payments.refund.approve') || /Owner/i.test(role);
  const isOwner = /^Owner$/i.test(role);

  let rejectTargetId = null;
  let lastMemberIdForCredits = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(Number(n));
  }
  function dt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? esc(iso)
      : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
      GATEWAY_REFUND_UNSUPPORTED: 'Gateway refunds are not supported. Use cash or account credit.',
      SELF_APPROVAL_FORBIDDEN: 'You cannot approve your own refund request (Owners excepted).',
      OPEN_SHIFT_REQUIRED: 'Open a cash-drawer shift before cash refunds.',
      NOT_AWAITING_APPROVAL: 'This refund is not awaiting approval.',
      SALE_FULLY_REFUNDED: 'Sale is already fully refunded.',
      SALE_NOT_FOUND: 'Sale not found.',
      REFUND_NOT_FOUND: 'Refund not found.',
      FEATURE_DISABLED: 'Refunds feature is disabled for this tenant.',
      REFUND_EXCEEDS_REMAINDER: 'Amount exceeds refundable remainder.',
      INSUFFICIENT_CREDIT: 'Insufficient account credit.',
      ORIGINAL_SALE_MOVEMENT_MISSING:
        'Cannot restore stock — original sale stock movement is missing. Contact support before approving again.',
      STOCK_RESTORE_FAILED: 'Refund money path failed while restoring retail stock. Try again or contact support.',
    };
    if (map[title]) return map[title];
    if (detail && detail.indexOf(' / ') !== -1) return detail.split(' / ')[0].trim();
    return detail || title || 'Request failed (' + status + ')';
  }

  async function api(method, path, body) {
    const opts = { method, headers: getH() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, data: null };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  if (canRequest) document.getElementById('btnShowRequest').style.display = 'inline-flex';

  document.getElementById('btnShowRequest').onclick = () => {
    document.getElementById('requestCard').style.display = 'block';
  };
  document.getElementById('btnHideRequest').onclick = () => {
    document.getElementById('requestCard').style.display = 'none';
  };

  // Never allow selecting gateway via UI (disabled option)
  document.getElementById('rfMethod').addEventListener('change', (e) => {
    if (e.target.value === 'gateway') {
      e.target.value = 'cash';
      toast('Gateway refunds are unsupported.', 'err');
    }
  });

  document.getElementById('requestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const method = document.getElementById('rfMethod').value;
    if (method === 'gateway') {
      toast('Gateway refunds are unsupported (GATEWAY_REFUND_UNSUPPORTED).', 'err');
      return;
    }
    const body = {
      saleId: document.getElementById('rfSaleId').value.trim(),
      amount: Number(document.getElementById('rfAmount').value),
      method,
      reason: document.getElementById('rfReason').value.trim(),
    };
    const res = await api('POST', '/refunds', body);
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    toast('Refund requested.', 'ok');
    document.getElementById('requestForm').reset();
    document.getElementById('requestCard').style.display = 'none';
    await loadList();
  });

  async function loadList() {
    if (!canApprove && !canRequest) {
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="8" class="muted">Need payments.refund.request or payments.refund.approve</td></tr>';
      return;
    }
    // List endpoint requires payments.refund.approve per contracts
    const q = new URLSearchParams();
    const saleId = document.getElementById('fSaleId').value.trim();
    const memberId = document.getElementById('fMemberId').value.trim();
    const status = document.getElementById('fStatus').value;
    if (saleId) q.set('saleId', saleId);
    if (memberId) q.set('memberId', memberId);
    if (status) q.set('status', status);

    const res = await api('GET', '/refunds' + (q.toString() ? '?' + q.toString() : ''));
    const tbody = document.getElementById('tbody');
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      tbody.innerHTML =
        '<tr><td colspan="8" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      return;
    }

    const items = Array.isArray(res.data) ? res.data : res.data.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No refunds</td></tr>';
      return;
    }

    tbody.innerHTML = items
      .map((r) => {
        const creditNote =
          r.method === 'credit' && !r.creditNoteInvoiceId
            ? '<span class="muted" title="Expected for credit-method refunds">null (OK)</span>'
            : r.creditNoteInvoiceId
              ? '<code>' + esc(r.creditNoteInvoiceId) + '</code>'
              : '—';

        const actions = [];
        if (canApprove && r.status === 'requested') {
          const selfReq = r.requestedByUserId && mySub && String(r.requestedByUserId) === String(mySub);
          if (selfReq && !isOwner) {
            actions.push(
              '<span class="muted" title="SELF_APPROVAL_FORBIDDEN">Self — ask another approver</span>',
            );
          } else {
            actions.push(
              '<button type="button" class="btn secondary" data-approve="' +
                esc(r.id) +
                '" data-sale="' +
                esc(r.saleId) +
                '">Approve</button>',
            );
          }
          actions.push(
            '<button type="button" class="btn ghost" data-reject="' + esc(r.id) + '">Reject</button>',
          );
        }

        return (
          '<tr>' +
          '<td>' +
          esc(dt(r.createdAtUtc)) +
          '</td>' +
          '<td><code>' +
          esc(r.saleId) +
          '</code></td>' +
          '<td>' +
          esc(money(r.amount)) +
          '</td>' +
          '<td>' +
          esc(r.method) +
          '</td>' +
          '<td><span class="st ' +
          esc(r.status) +
          '">' +
          esc(r.status) +
          '</span>' +
          (r.stockRestored
            ? ' <span class="badge-stock" title="Retail stock was returned to inventory">Stock restored</span>'
            : '') +
          '</td>' +
          '<td>' +
          creditNote +
          '</td>' +
          '<td>' +
          esc(r.reason || '—') +
          (r.rejectionNote ? '<div class="muted">Reject: ' + esc(r.rejectionNote) + '</div>' : '') +
          '</td>' +
          '<td style="display:flex;gap:6px;flex-wrap:wrap">' +
          actions.join('') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.onclick = () => approveRefund(btn.getAttribute('data-approve'), btn.getAttribute('data-sale'));
    });
    tbody.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.onclick = () => {
        rejectTargetId = btn.getAttribute('data-reject');
        document.getElementById('rejectNote').value = '';
        document.getElementById('rejectModal').classList.add('show');
      };
    });
  }

  async function approveRefund(id, saleIdHint) {
    const saleId =
      saleIdHint ||
      document.getElementById('fSaleId').value.trim();

    const res = await api('POST', '/refunds/' + id + '/approve');
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    const refund = res.data || {};
    if (refund.stockRestored === true) {
      toast('Retail stock restored', 'ok');
    } else {
      toast(
        'Approved' +
          (refund.method === 'credit' && !refund.creditNoteInvoiceId
            ? ' — credit note id null (expected for credit method)'
            : ''),
        'ok',
      );
    }

    // Re-fetch refunds for this sale (no dedicated GET /sales/{id} in contracts)
    if (saleId || refund.saleId) {
      document.getElementById('fSaleId').value = saleId || refund.saleId;
    }
    await loadList();
  }

  document.getElementById('btnRejectCancel').onclick = () => {
    document.getElementById('rejectModal').classList.remove('show');
    rejectTargetId = null;
  };
  document.getElementById('btnRejectConfirm').onclick = async () => {
    const note = document.getElementById('rejectNote').value.trim();
    if (!note || !rejectTargetId) {
      toast('Rejection note required.', 'err');
      return;
    }
    const res = await api('POST', '/refunds/' + rejectTargetId + '/reject', { note });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    document.getElementById('rejectModal').classList.remove('show');
    rejectTargetId = null;
    toast('Refund rejected.', 'ok');
    await loadList();
  };

  document.getElementById('btnFilter').onclick = () => loadList();

  loadList();
})();
