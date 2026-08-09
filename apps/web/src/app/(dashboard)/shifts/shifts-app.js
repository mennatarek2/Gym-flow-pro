(function () {
  'use strict';

  const API_BASE = window.API_BASE || 'https://localhost:5001/api';

  /** Four distinct 409 titles from ShiftFailureCode (+ bilingual-friendly copy). */
  const SHIFT_409 = {
    SHIFT_ALREADY_OPEN: 'A shift is already open for this staff member. Close it before opening another.',
    NO_OPEN_SHIFT: 'No open shift. Open a drawer with an opening float first.',
    NOT_AWAITING_APPROVAL: 'This shift is not awaiting approval (wrong status for approve).',
    SHIFT_NOT_OPEN: 'This shift is not open. Force-close / movement actions require an open shift.',
  };

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

  function decodeJwtPayload(token) {
    try {
      const part = token.split('.')[1];
      const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function getPerms() {
    const payload = decodeJwtPayload(getToken() || '');
    if (!payload) return new Set();
    const raw = payload.perm;
    if (Array.isArray(raw)) return new Set(raw.map(String));
    if (typeof raw === 'string') return new Set([raw]);
    // Some JWT serializers emit multiple "perm" as comma or object — collect all claim arrays
    const set = new Set();
    Object.keys(payload).forEach((k) => {
      if (k === 'perm' || k === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/perm') {
        const v = payload[k];
        if (Array.isArray(v)) v.forEach((x) => set.add(String(x)));
        else if (v) set.add(String(v));
      }
    });
    return set;
  }

  const user = getUser();
  const perms = getPerms();
  const role = (user && user.role) || '';
  const isManagerPlus = /^(Owner|Manager)$/i.test(role);
  const canOpen = perms.has('shift.open') || isManagerPlus || /Owner/i.test(role);
  const canClose = perms.has('shift.close') || isManagerPlus || /Owner/i.test(role);
  const canApprove = perms.has('shift.reconcile.approve') || /Owner/i.test(role);
  const canFinancial = perms.has('reports.financial.view') || /Owner/i.test(role);

  let currentShift = null;
  let histPage = 1;

  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    el.innerHTML = '<i class="ti ' + (type === 'err' ? 'ti-alert-circle' : 'ti-check') + '"></i><span>' + esc(msg) + '</span>';
    setTimeout(() => el.classList.remove('show'), 4200);
  }

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
    if (Number.isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function problemMessage(data, status) {
    if (!data) return 'Request failed (' + status + ')';
    const title = data.title || data.code || '';
    if (status === 409 && SHIFT_409[title]) return SHIFT_409[title];
    if (status === 403 && title === 'MANAGER_APPROVAL_REQUIRED') {
      return 'Manager approval is required for this paid-out amount (threshold).';
    }
    if (status === 404 && title === 'FEATURE_DISABLED') {
      return 'Shifts feature is disabled for this tenant.';
    }
    const detail = data.detail || data.message || data.error || '';
    if (detail && detail.includes(' / ')) {
      return detail.split(' / ')[0].trim();
    }
    return detail || title || 'Request failed (' + status + ')';
  }

  async function api(method, path, body) {
    const opts = { method, headers: getH() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401) {
      window.location.href = '/auth/login/';
      return { ok: false, status: 401, data: null };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      data = await res.json().catch(() => null);
    } else if (res.status !== 204) {
      const text = await res.text().catch(() => '');
      data = text ? { detail: text } : null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  // ── Current shift ─────────────────────────────────────────────
  async function loadCurrent() {
    const body = document.getElementById('currentBody');
    const actions = document.getElementById('actionsBody');
    const movCard = document.getElementById('movementsCard');
    body.innerHTML = '<div class="loader"></div> Loading…';

    const res = await api('GET', '/shifts/current');

    if (res.status === 404 && res.data && res.data.title === 'FEATURE_DISABLED') {
      document.getElementById('featureDisabled').style.display = 'flex';
      body.innerHTML = '<p class="muted">Module unavailable.</p>';
      actions.innerHTML = '';
      movCard.style.display = 'none';
      currentShift = null;
      return;
    }

    // No open shift
    if (res.status === 404 || res.status === 409 || (res.ok && !res.data)) {
      const code = (res.data && res.data.title) || 'NO_OPEN_SHIFT';
      currentShift = null;
      document.getElementById('shiftStatus').textContent = 'none';
      document.getElementById('shiftStatus').className = 'status-pill';
      body.innerHTML =
        '<p class="muted">' +
        esc(SHIFT_409[code] || SHIFT_409.NO_OPEN_SHIFT) +
        '</p>';
      movCard.style.display = 'none';
      renderOpenForm(actions);
      return;
    }

    if (!res.ok) {
      body.innerHTML = '<p class="muted">' + esc(problemMessage(res.data, res.status)) + '</p>';
      actions.innerHTML = '';
      return;
    }

    currentShift = res.data;
    renderCurrent(currentShift);
    renderOpenActions(actions, currentShift);
    movCard.style.display = currentShift.status === 'open' ? 'block' : 'none';
    if (currentShift.status === 'open') renderMovements(currentShift);
  }

  /**
   * Blind-count rule: while status === 'open', expectedCash from API is null.
   * Never sum movements client-side to invent an expected total.
   */
  function renderCurrent(s) {
    const st = document.getElementById('shiftStatus');
    st.textContent = s.status;
    st.className = 'status-pill ' + (s.status || '');

    const expectedCell =
      s.status === 'open'
        ? '<strong class="muted">Hidden (blind)</strong>'
        : '<strong>' + esc(money(s.expectedCash)) + '</strong>';

    document.getElementById('currentBody').innerHTML =
      '<div class="kv">' +
      '<div class="kv-row"><span>Staff</span><strong>' +
      esc(s.userName || s.userId) +
      '</strong></div>' +
      '<div class="kv-row"><span>Opened</span><strong>' +
      esc(dt(s.openedAt)) +
      '</strong></div>' +
      '<div class="kv-row"><span>Opening float</span><strong>' +
      esc(money(s.openingFloat)) +
      '</strong></div>' +
      '<div class="kv-row"><span>Expected cash</span>' +
      expectedCell +
      '</div>' +
      (s.status !== 'open'
        ? '<div class="kv-row"><span>Counted</span><strong>' +
          esc(money(s.countedCash)) +
          '</strong></div>' +
          '<div class="kv-row"><span>Variance</span><strong>' +
          esc(money(s.variance)) +
          '</strong></div>'
        : '') +
      '<div class="kv-row"><span>Movements</span><strong>' +
      esc(String((s.movements || []).length)) +
      '</strong></div>' +
      '</div>' +
      (s.status === 'open'
        ? '<div class="blind-note"><i class="ti ti-eye-off"></i> Blind count active — expected cash is null until you submit the physical count. Do not calculate it from the movements list.</div>'
        : '');
  }

  function renderOpenForm(el) {
    if (!canOpen) {
      el.innerHTML = '<p class="muted">You need <code>shift.open</code> to open a drawer.</p>';
      return;
    }
    el.innerHTML =
      '<form class="form-stack" id="openForm">' +
      '<label>Opening float (EGP)<input type="number" id="openingFloat" step="0.01" min="0" required placeholder="0.00"></label>' +
      '<button class="btn primary" type="submit"><i class="ti ti-lock-open"></i> Open shift</button>' +
      '</form>';
    document.getElementById('openForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const openingFloat = Number(document.getElementById('openingFloat').value);
      if (Number.isNaN(openingFloat) || openingFloat < 0) {
        toast('Enter a valid opening float.', 'err');
        return;
      }
      const res = await api('POST', '/shifts/open', { openingFloat });
      if (!res.ok) {
        toast(problemMessage(res.data, res.status), 'err');
        return;
      }
      toast('Shift opened.', 'ok');
      await loadCurrent();
      if (isManagerPlus) await loadHistory();
    });
  }

  function renderOpenActions(el, s) {
    if (s.status !== 'open') {
      el.innerHTML = '<p class="muted">Current shift is <strong>' + esc(s.status) + '</strong>.</p>';
      return;
    }
    let html = '<p class="muted">Close with a physical count. Variance appears only after submit.</p>';
    if (canClose) {
      html +=
        '<form class="form-stack" id="closeForm">' +
        '<label>Counted cash (EGP)<input type="number" id="countedCash" step="0.01" min="0" required></label>' +
        '<label>Variance note (optional)<textarea id="varianceNote" rows="2" placeholder="Required by policy if variance is large"></textarea></label>' +
        '<button class="btn primary" type="submit"><i class="ti ti-lock"></i> Close shift (blind count)</button>' +
        '</form>';
    } else {
      html += '<p class="muted">Missing <code>shift.close</code>.</p>';
    }
    el.innerHTML = html;
    const form = document.getElementById('closeForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const countedCash = Number(document.getElementById('countedCash').value);
      const varianceNote = document.getElementById('varianceNote').value.trim() || null;
      if (Number.isNaN(countedCash) || countedCash < 0) {
        toast('Enter counted cash.', 'err');
        return;
      }
      const res = await api('POST', '/shifts/current/close', { countedCash, varianceNote });
      if (!res.ok) {
        toast(problemMessage(res.data, res.status), 'err');
        return;
      }
      toast(
        'Shift closed. Expected ' +
          money(res.data && res.data.expectedCash) +
          ' · variance ' +
          money(res.data && res.data.variance),
        'ok',
      );
      await loadCurrent();
      if (isManagerPlus) await loadHistory();
    });
  }

  function renderMovements(s) {
    const tbody = document.getElementById('movBody');
    const list = s.movements || [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No movements yet.</td></tr>';
    } else {
      tbody.innerHTML = list
        .map(
          (m) =>
            '<tr><td>' +
            esc(dt(m.createdAtUtc)) +
            '</td><td>' +
            esc(m.type) +
            '</td><td>' +
            esc(money(m.amount)) +
            '</td><td>' +
            esc(m.reason || '—') +
            '</td></tr>',
        )
        .join('');
    }
  }

  document.getElementById('btnAddMov').addEventListener('click', async () => {
    if (!canOpen) {
      toast('Missing shift.open permission.', 'err');
      return;
    }
    const type = document.getElementById('movType').value;
    let amount = Number(document.getElementById('movAmount').value);
    const reason = document.getElementById('movReason').value.trim() || null;
    if (Number.isNaN(amount) || amount === 0) {
      toast('Enter a non-zero amount.', 'err');
      return;
    }
    // paid_in / paid_out: send positive magnitude (server normalizes sign)
    if (type === 'paid_in' || type === 'paid_out') {
      amount = Math.abs(amount);
    }
    const res = await api('POST', '/shifts/current/movements', {
      type,
      amount,
      reason,
    });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    toast('Movement recorded.', 'ok');
    document.getElementById('movAmount').value = '';
    document.getElementById('movReason').value = '';
    await loadCurrent();
  });

  // ── Open summary ──────────────────────────────────────────────
  async function loadOpenSummary() {
    const card = document.getElementById('openSummaryCard');
    if (!canFinancial) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    const res = await api('GET', '/shifts/open-summary');
    if (!res.ok) {
      document.getElementById('summaryBody').textContent = problemMessage(res.data, res.status);
      return;
    }
    const data = res.data || {};
    document.getElementById('summaryTotal').textContent =
      'Total in drawers: ' + money(data.totalCashInDrawers);
    const opens = data.openShifts || [];
    if (!opens.length) {
      document.getElementById('summaryBody').innerHTML = '<p class="muted">No open shifts across staff.</p>';
      return;
    }
    document.getElementById('summaryBody').innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Opened</th><th>Float</th><th>Status</th></tr></thead><tbody>' +
      opens
        .map(
          (s) =>
            '<tr><td>' +
            esc(s.userName || s.userId) +
            '</td><td>' +
            esc(dt(s.openedAt)) +
            '</td><td>' +
            esc(money(s.openingFloat)) +
            '</td><td>' +
            esc(s.status) +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table></div>';
  }

  // ── History ───────────────────────────────────────────────────
  async function loadHistory() {
    const card = document.getElementById('historyCard');
    if (!isManagerPlus) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    const from = document.getElementById('histFrom').value;
    const to = document.getElementById('histTo').value;
    const q = new URLSearchParams({ page: String(histPage), pageSize: '20' });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const res = await api('GET', '/shifts?' + q.toString());
    const tbody = document.getElementById('histBody');
    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      return;
    }
    const page = res.data || {};
    const items = page.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="muted">No shifts in range.</td></tr>';
    } else {
      tbody.innerHTML = items
        .map((s) => {
          const actions = [];
          if (s.status === 'closed' && canApprove) {
            actions.push(
              '<button class="btn secondary" data-approve="' + esc(s.id) + '">Approve</button>',
            );
          }
          if (s.status === 'open' && isManagerPlus) {
            actions.push(
              '<button class="btn danger" data-force="' + esc(s.id) + '">Force close</button>',
            );
          }
          return (
            '<tr>' +
            '<td>' +
            esc(s.userName || s.userId) +
            '</td>' +
            '<td>' +
            esc(dt(s.openedAt)) +
            '</td>' +
            '<td>' +
            esc(dt(s.closedAt)) +
            '</td>' +
            '<td>' +
            esc(money(s.openingFloat)) +
            '</td>' +
            '<td>' +
            esc(s.status === 'open' ? 'Hidden' : money(s.expectedCash)) +
            '</td>' +
            '<td>' +
            esc(money(s.countedCash)) +
            '</td>' +
            '<td>' +
            esc(money(s.variance)) +
            '</td>' +
            '<td><span class="status-pill ' +
            esc(s.status) +
            '">' +
            esc(s.status) +
            '</span></td>' +
            '<td class="action-gap">' +
            actions.join('') +
            '</td>' +
            '</tr>'
          );
        })
        .join('');
    }

    tbody.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-approve');
        const res2 = await api('POST', '/shifts/' + id + '/approve', { note: null });
        if (!res2.ok) {
          toast(problemMessage(res2.data, res2.status), 'err');
          return;
        }
        toast('Shift approved.', 'ok');
        await loadHistory();
      });
    });
    tbody.querySelectorAll('[data-force]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Force-close this open shift? (ManagerOrAbove)')) return;
        const id = btn.getAttribute('data-force');
        const res2 = await api('POST', '/shifts/' + id + '/force-close');
        if (!res2.ok) {
          toast(problemMessage(res2.data, res2.status), 'err');
          return;
        }
        toast('Shift force-closed.', 'ok');
        await loadCurrent();
        await loadHistory();
      });
    });

    const pager = document.getElementById('histPager');
    pager.innerHTML = '';
    if (page.hasPrevious) {
      const prev = document.createElement('button');
      prev.className = 'btn secondary';
      prev.textContent = 'Previous';
      prev.onclick = () => {
        histPage = Math.max(1, histPage - 1);
        loadHistory();
      };
      pager.appendChild(prev);
    }
    if (page.hasNext) {
      const next = document.createElement('button');
      next.className = 'btn secondary';
      next.textContent = 'Next';
      next.onclick = () => {
        histPage += 1;
        loadHistory();
      };
      pager.appendChild(next);
    }
  }

  document.getElementById('btnHistLoad').addEventListener('click', () => {
    histPage = 1;
    loadHistory();
  });
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    await Promise.all([loadCurrent(), loadOpenSummary(), isManagerPlus ? loadHistory() : Promise.resolve()]);
  });

  // boot
  loadCurrent();
  loadOpenSummary();
  if (isManagerPlus) loadHistory();
})();
