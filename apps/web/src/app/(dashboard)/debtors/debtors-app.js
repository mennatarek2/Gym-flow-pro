(function () {
  'use strict';
  const API_BASE = window.API_BASE || 'https://reach-lullaby-tighten.ngrok-free.dev/api';
  const PAGE_SIZE = 20;

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
  }
  function getH(opts) {
    const t = getToken();
    const h = { 'ngrok-skip-browser-warning': 'true' };
    if (!(opts && opts.noJson)) h['Content-Type'] = 'application/json';
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
  const canList = perms.has('sales.sell') || /Owner|Manager|Receptionist/i.test(role);
  const canSummary = perms.has('reports.financial.view') || /Owner|Manager/i.test(role);

  let page = 1;

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
    if (!Number.isNaN(d.getTime()) && String(iso).length > 10) {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
      REMINDER_THROTTLE: 'Already reminded recently — try again later.',
      MEMBER_NOT_FOUND: 'Member not found.',
      NO_OUTSTANDING_BALANCE: 'No outstanding balance.',
      FEATURE_DISABLED: 'Debtors feature is disabled for this tenant.',
    };
    if (map[title]) return map[title];
    if (status === 429) return map.REMINDER_THROTTLE;
    return detail || title || 'Request failed (' + status + ')';
  }

  async function api(method, path, body, opts) {
    const headers = getH(opts);
    const fetchOpts = { method, headers };
    if (body !== undefined) fetchOpts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, fetchOpts);
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, data: null, blob: null, text: null };
    }
    if (opts && opts.asBlob) {
      if (!res.ok) {
        let data = null;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) data = await res.json().catch(() => null);
        return { ok: false, status: res.status, data, blob: null, text: null };
      }
      const blob = await res.blob();
      return { ok: true, status: res.status, data: null, blob, text: null };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, blob: null, text: null };
  }

  function agingClass(bucket) {
    if (bucket === '0-7') return 'b0-7';
    if (bucket === '8-30') return 'b8-30';
    return 'b30';
  }

  async function loadSummary() {
    const note = document.getElementById('kpiNote');
    if (!canSummary) {
      document.getElementById('kpiTotal').textContent = '—';
      document.getElementById('kpiCount').textContent = '—';
      note.textContent = 'KPI needs reports.financial.view (list still available with sales.sell).';
      return;
    }
    const res = await api('GET', '/debtors/summary');
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      note.textContent = problemMessage(res.data, res.status);
      return;
    }
    const d = res.data || {};
    document.getElementById('kpiTotal').textContent = money(d.totalOutstanding);
    document.getElementById('kpiCount').textContent = String(d.debtorCount != null ? d.debtorCount : '—');
    note.textContent = 'Summary from GET /debtors/summary';
  }

  function renderPager(totalPages, totalCount) {
    const el = document.getElementById('pager');
    el.innerHTML =
      '<button type="button" class="btn secondary js-prev"' +
      (page <= 1 ? ' disabled' : '') +
      '>Prev</button>' +
      '<span>Page ' +
      page +
      ' / ' +
      Math.max(1, totalPages || 1) +
      ' · ' +
      esc(String(totalCount || 0)) +
      '</span>' +
      '<button type="button" class="btn secondary js-next"' +
      (page >= (totalPages || 1) ? ' disabled' : '') +
      '>Next</button>';
    el.querySelector('.js-prev').onclick = () => {
      if (page > 1) {
        page -= 1;
        loadList();
      }
    };
    el.querySelector('.js-next').onclick = () => {
      if (page < (totalPages || 1)) {
        page += 1;
        loadList();
      }
    };
  }

  async function loadList() {
    if (!canList) {
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="7" class="muted">Need sales.sell</td></tr>';
      return;
    }
    const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    const res = await api('GET', '/debtors?' + q.toString());
    const tbody = document.getElementById('tbody');
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      tbody.innerHTML =
        '<tr><td colspan="7" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      renderPager(1, 0);
      return;
    }
    const data = res.data || {};
    const items = Array.isArray(data) ? data : data.items || [];
    renderPager(data.totalPages != null ? data.totalPages : 1, data.totalCount != null ? data.totalCount : items.length);
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No debtors</td></tr>';
      return;
    }
    tbody.innerHTML = items
      .map((d) => {
        return (
          '<tr>' +
          '<td><a href="/dashboard/members/' +
          encodeURIComponent(d.memberId) +
          '/">' +
          esc(d.fullName) +
          '</a></td>' +
          '<td dir="ltr">' +
          esc(d.phoneNumber) +
          '</td>' +
          '<td><strong>' +
          esc(money(d.totalDue)) +
          '</strong></td>' +
          '<td>' +
          esc(dt(d.oldestDueDate)) +
          '</td>' +
          '<td><span class="aging ' +
          agingClass(d.agingBucket) +
          '">' +
          esc(d.agingBucket || '—') +
          '</span></td>' +
          '<td>' +
          esc(dt(d.lastPaymentAt)) +
          '</td>' +
          '<td><button type="button" class="btn secondary" data-remind="' +
          esc(d.memberId) +
          '">Remind</button></td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-remind]').forEach((btn) => {
      btn.onclick = () => remind(btn.getAttribute('data-remind'), btn);
    });
  }

  async function remind(memberId, btn) {
    if (btn) btn.disabled = true;
    const res = await api('POST', '/debtors/' + memberId + '/remind');
    if (btn) btn.disabled = false;
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    toast('Reminder sent.', 'ok');
  }

  async function exportCsv() {
    if (!canList) {
      toast('Need sales.sell', 'err');
      return;
    }
    // Explicit action only — format=csv on list endpoint
    const res = await api('GET', '/debtors?format=csv&page=1&pageSize=10000', undefined, {
      asBlob: true,
      noJson: true,
    });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'debtors.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('CSV downloaded.', 'ok');
  }

  document.getElementById('btnRefresh').onclick = () => {
    loadSummary();
    loadList();
  };
  document.getElementById('btnCsv').onclick = exportCsv;

  loadSummary();
  loadList();
})();
