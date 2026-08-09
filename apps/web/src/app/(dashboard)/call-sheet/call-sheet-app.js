(function () {
  'use strict';
  const API_BASE = window.API_BASE || 'https://localhost:5001/api';
  const OUTCOMES = ['contacted', 'renewed', 'declined', 'no_answer'];

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
  const jwtSub = (decodeJwt(getToken() || '') || {}).sub || null;
  const canSell = perms.has('sales.sell') || /Owner|Manager|Receptionist/i.test(role);
  const canReport = perms.has('reports.financial.view') || /Owner|Manager/i.test(role);
  const isOwner = /^Owner$/i.test(role);

  /** Domain AppUser.Id — NOT JWT sub / LoginResponse.user.id (Identity id). */
  let resolvedAppUserId = null;
  let outcomeMembershipId = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function dt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime()) && String(iso).length > 10) {
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return esc(String(iso));
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
      MEMBERSHIP_NOT_FOUND: 'Membership not found.',
      STAFF_USER_NOT_FOUND: 'Staff user not found.',
      INVALID_OUTCOME: 'Invalid outcome — use contacted/renewed/declined/no_answer.',
    };
    if (map[title]) return map[title];
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

  function fillStaffSelect(options) {
    const sel = document.getElementById('rrStaff');
    const keep = sel.value;
    sel.innerHTML =
      '<option value="">All staff</option>' +
      options
        .map(
          (o) =>
            '<option value="' +
            esc(o.id) +
            '"' +
            (resolvedAppUserId && o.id === resolvedAppUserId ? ' data-me="1"' : '') +
            '>' +
            esc(o.name) +
            (resolvedAppUserId && o.id === resolvedAppUserId ? ' (you)' : '') +
            '</option>',
        )
        .join('');
    if (keep) sel.value = keep;
  }

  /**
   * Resolve AppUser.Id for filters:
   * 1) current shift.userId (domain id)
   * 2) Owner admin staff list
   * Never use JWT sub / gfp_user.id for renewals filter.
   */
  async function resolveStaffIds() {
    const hint = document.getElementById('staffResolveHint');
    const map = new Map();

    // Current shift → AppUser.Id
    const shiftRes = await api('GET', '/shifts/current');
    if (shiftRes.ok && shiftRes.data && shiftRes.data.userId) {
      resolvedAppUserId = String(shiftRes.data.userId);
      map.set(resolvedAppUserId, {
        id: resolvedAppUserId,
        name: shiftRes.data.userName || 'Current staff',
      });
      if (jwtSub && String(resolvedAppUserId) === String(jwtSub)) {
        // Extremely unlikely; warn if ids collide so we don't assume wrongly
        console.warn('AppUser.Id unexpectedly equals JWT sub');
      }
    }

    if (isOwner) {
      const staffRes = await api('GET', '/admin/staff');
      if (staffRes.ok) {
        const list = Array.isArray(staffRes.data) ? staffRes.data : [];
        list.forEach((s) => {
          if (s.id) map.set(String(s.id), { id: String(s.id), name: s.fullName || s.email || s.id });
        });
      }
    }

    fillStaffSelect(Array.from(map.values()));

    if (resolvedAppUserId) {
      hint.innerHTML =
        'Resolved your <code>AppUser.Id</code> = <code>' +
        esc(resolvedAppUserId) +
        '</code> via current shift (JWT <code>sub</code> not used).';
    } else if (map.size) {
      hint.textContent =
        'Staff filter uses AppUser.Id from admin list. Open a shift to auto-resolve “you”.';
    } else {
      hint.textContent =
        'Could not pre-resolve AppUser.Id. Load renewal report first — rows include staffUserId options; never paste JWT sub.';
    }
  }

  async function loadExpiring() {
    if (!canSell) {
      document.getElementById('expTbody').innerHTML =
        '<tr><td colspan="6" class="muted">Need sales.sell</td></tr>';
      return;
    }
    const days = Number(document.getElementById('days').value) || 7;
    const res = await api('GET', '/call-sheet/expiring?days=' + encodeURIComponent(String(days)));
    const tbody = document.getElementById('expTbody');
    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      return;
    }
    const items = Array.isArray(res.data) ? res.data : [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No expiring memberships</td></tr>';
      return;
    }
    tbody.innerHTML = items
      .map((e) => {
        return (
          '<tr>' +
          '<td><a href="/dashboard/members/' +
          encodeURIComponent(e.memberId) +
          '/">' +
          esc(e.fullName) +
          '</a><div class="muted" dir="ltr">' +
          esc(e.phoneNumber) +
          '</div></td>' +
          '<td>' +
          esc(e.planName) +
          '</td>' +
          '<td>' +
          esc(e.endDate) +
          '</td>' +
          '<td>' +
          esc(dt(e.lastVisitAt)) +
          '</td>' +
          '<td>' +
          (e.lastCallOutcome
            ? '<span class="st">' + esc(e.lastCallOutcome) + '</span>'
            : '<span class="muted">—</span>') +
          '</td>' +
          '<td><button type="button" class="btn secondary" data-ms="' +
          esc(e.membershipId) +
          '" data-name="' +
          esc(e.fullName) +
          '">Log</button></td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-ms]').forEach((btn) => {
      btn.onclick = () => {
        outcomeMembershipId = btn.getAttribute('data-ms');
        document.getElementById('outcomeMember').textContent =
          btn.getAttribute('data-name') || '';
        document.getElementById('outcomeValue').value = 'contacted';
        document.getElementById('outcomeNote').value = '';
        document.getElementById('outcomeModal').classList.add('show');
      };
    });
  }

  document.getElementById('btnOutcomeCancel').onclick = () => {
    document.getElementById('outcomeModal').classList.remove('show');
    outcomeMembershipId = null;
  };

  document.getElementById('btnOutcomeSave').onclick = async () => {
    const outcome = document.getElementById('outcomeValue').value;
    if (!OUTCOMES.includes(outcome)) {
      toast('Invalid outcome', 'err');
      return;
    }
    if (!outcomeMembershipId) return;
    const note = document.getElementById('outcomeNote').value.trim() || null;
    const res = await api('POST', '/call-sheet/' + outcomeMembershipId + '/outcome', {
      outcome,
      note,
    });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    document.getElementById('outcomeModal').classList.remove('show');
    outcomeMembershipId = null;
    toast('Outcome recorded.', 'ok');
    await loadExpiring();
  };

  async function loadRenewalRate() {
    if (!canReport) {
      document.getElementById('rrTbody').innerHTML =
        '<tr><td colspan="5" class="muted">Need reports.financial.view</td></tr>';
      return;
    }
    const from = document.getElementById('rrFrom').value;
    const to = document.getElementById('rrTo').value;
    if (!from || !to) {
      toast('From and to dates required', 'err');
      return;
    }
    const staffUserId = document.getElementById('rrStaff').value.trim();
    // Guard: never send JWT sub accidentally
    if (staffUserId && jwtSub && staffUserId === String(jwtSub)) {
      toast('Refusing JWT sub as staffUserId — pick an AppUser.Id from the list.', 'err');
      return;
    }
    const q = new URLSearchParams({ from, to });
    if (staffUserId) q.set('staffUserId', staffUserId);
    const res = await api('GET', '/call-sheet/renewal-rate?' + q.toString());
    const tbody = document.getElementById('rrTbody');
    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      return;
    }
    const items = Array.isArray(res.data) ? res.data : [];
    // Enrich staff select from report rows (AppUser.Id)
    const sel = document.getElementById('rrStaff');
    const existing = new Set(Array.from(sel.options).map((o) => o.value).filter(Boolean));
    items.forEach((r) => {
      const id = String(r.staffUserId || '');
      if (id && !existing.has(id)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = (r.staffName || id) + ' (from report)';
        sel.appendChild(opt);
        existing.add(id);
      }
    });

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No call outcomes in range</td></tr>';
      return;
    }
    tbody.innerHTML = items
      .map(
        (r) =>
          '<tr>' +
          '<td>' +
          esc(r.staffName || '—') +
          '</td>' +
          '<td><code>' +
          esc(r.staffUserId) +
          '</code></td>' +
          '<td>' +
          esc(String(r.totalCalled)) +
          '</td>' +
          '<td>' +
          esc(String(r.renewed)) +
          '</td>' +
          '<td><strong>' +
          esc(String(r.renewalRatePercent)) +
          '%</strong></td>' +
          '</tr>',
      )
      .join('');
  }

  // Default renewal dates: last 30 days
  (function initDates() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    document.getElementById('rrTo').value = to.toISOString().slice(0, 10);
    document.getElementById('rrFrom').value = from.toISOString().slice(0, 10);
  })();

  document.getElementById('btnLoadExpiring').onclick = loadExpiring;
  document.getElementById('btnRenewal').onclick = loadRenewalRate;

  resolveStaffIds().then(() => {
    loadExpiring();
    if (canReport) loadRenewalRate();
  });
})();
