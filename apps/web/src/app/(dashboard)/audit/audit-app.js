(function () {
  'use strict';
  const API_BASE = window.API_BASE || window.GFP_DEFAULT_API_BASE || '/api';
  const PAGE_SIZE = 20;

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
  const canAudit = perms.has('settings.manage') || /Owner/i.test(role);

  let page = 1;
  let cache = {};

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
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
          second: '2-digit',
        });
  }
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    el.textContent = msg;
    setTimeout(() => el.classList.remove('show'), 4000);
  }
  function problemMessage(data, status) {
    if (!data) return 'Request failed (' + status + ')';
    return data.detail || data.message || data.title || 'Request failed (' + status + ')';
  }

  async function api(method, path) {
    const res = await fetch(API_BASE + path, { method, headers: getH() });
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, data: null };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  /** Parse raw JSON string from API; never assume already-parsed objects. */
  function parseJsonField(raw) {
    if (raw == null || raw === '') return { ok: true, value: null, pretty: 'null' };
    if (typeof raw === 'object') {
      return { ok: true, value: raw, pretty: JSON.stringify(raw, null, 2) };
    }
    try {
      const value = JSON.parse(raw);
      return { ok: true, value, pretty: JSON.stringify(value, null, 2) };
    } catch (e) {
      return { ok: false, value: null, pretty: String(raw) };
    }
  }

  function flatten(obj, prefix, out) {
    out = out || {};
    if (obj === null || obj === undefined) {
      out[prefix || '(root)'] = obj;
      return out;
    }
    if (typeof obj !== 'object') {
      out[prefix || '(root)'] = obj;
      return out;
    }
    if (Array.isArray(obj)) {
      out[prefix || '(root)'] = JSON.stringify(obj);
      return out;
    }
    const keys = Object.keys(obj);
    if (!keys.length) {
      out[prefix || '(root)'] = '{}';
      return out;
    }
    keys.forEach((k) => {
      const path = prefix ? prefix + '.' + k : k;
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
      else out[path] = Array.isArray(v) ? JSON.stringify(v) : v;
    });
    return out;
  }

  function buildDiffRows(beforeVal, afterVal) {
    const b = flatten(beforeVal);
    const a = flatten(afterVal);
    const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
    return keys.map((k) => {
      const bv = Object.prototype.hasOwnProperty.call(b, k) ? b[k] : undefined;
      const av = Object.prototype.hasOwnProperty.call(a, k) ? a[k] : undefined;
      let cls = '';
      if (bv === undefined && av !== undefined) cls = 'added';
      else if (av === undefined && bv !== undefined) cls = 'removed';
      else if (String(bv) !== String(av)) cls = 'changed';
      return { k, bv, av, cls };
    });
  }

  function actorCell(actorUserId) {
    if (actorUserId == null || actorUserId === '') {
      return '<span class="actor-sys" title="Hangfire / system action"><i class="ti ti-robot"></i> System</span>';
    }
    return '<code>' + esc(actorUserId) + '</code>';
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

  function openDiff(ev) {
    cache[ev.id] = ev;
    const before = parseJsonField(ev.beforeJson);
    const after = parseJsonField(ev.afterJson);
    document.getElementById('diffMeta').textContent =
      ev.action +
      (ev.entityType ? ' · ' + ev.entityType : '') +
      (ev.entityId ? ' · ' + ev.entityId : '') +
      ' · ' +
      dt(ev.createdAtUtc);
    document.getElementById('diffBefore').textContent = before.pretty;
    document.getElementById('diffAfter').textContent = after.pretty;

    const keysEl = document.getElementById('diffKeys');
    if (before.ok && after.ok && (before.value !== null || after.value !== null)) {
      const rows = buildDiffRows(before.value, after.value);
      const changed = rows.filter((r) => r.cls);
      keysEl.innerHTML =
        '<h4>Field changes (' +
        changed.length +
        ')</h4>' +
        (rows.length
          ? rows
              .map(
                (r) =>
                  '<div class="diff-row ' +
                  r.cls +
                  '"><div class="diff-k">' +
                  esc(r.k) +
                  '</div><div>' +
                  esc(r.bv === undefined ? '—' : String(r.bv)) +
                  '</div><div>' +
                  esc(r.av === undefined ? '—' : String(r.av)) +
                  '</div></div>',
              )
              .join('')
          : '<p class="muted">No fields</p>');
    } else {
      keysEl.innerHTML =
        '<p class="muted">Raw strings shown above' +
        (!before.ok || !after.ok ? ' (one side failed JSON.parse)' : '') +
        '.</p>';
    }
    document.getElementById('diffModal').classList.add('show');
  }

  async function loadList() {
    if (!canAudit) {
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="6" class="muted">Need settings.manage (Owner)</td></tr>';
      return;
    }
    const q = new URLSearchParams();
    q.set('page', String(page));
    q.set('pageSize', String(PAGE_SIZE));
    const entityType = document.getElementById('fEntityType').value.trim();
    const entityId = document.getElementById('fEntityId').value.trim();
    const action = document.getElementById('fAction').value.trim();
    const from = document.getElementById('fFrom').value;
    const to = document.getElementById('fTo').value;
    if (entityType) q.set('entityType', entityType);
    if (entityId) q.set('entityId', entityId);
    if (action) q.set('action', action);
    if (from) q.set('from', from);
    if (to) q.set('to', to);

    const res = await api('GET', '/audit?' + q.toString());
    const tbody = document.getElementById('tbody');
    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">' + esc(problemMessage(res.data, res.status)) + '</td></tr>';
      renderPager(1, 0);
      return;
    }
    const data = res.data || {};
    const items = Array.isArray(data) ? data : data.items || [];
    renderPager(data.totalPages != null ? data.totalPages : 1, data.totalCount != null ? data.totalCount : items.length);
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No audit events</td></tr>';
      return;
    }
    tbody.innerHTML = items
      .map((ev) => {
        cache[ev.id] = ev;
        const hasDiff = ev.beforeJson != null || ev.afterJson != null;
        return (
          '<tr>' +
          '<td>' +
          esc(dt(ev.createdAtUtc)) +
          '</td>' +
          '<td>' +
          actorCell(ev.actorUserId) +
          '</td>' +
          '<td><strong>' +
          esc(ev.action) +
          '</strong></td>' +
          '<td>' +
          esc(ev.entityType || '—') +
          (ev.entityId ? '<div class="muted"><code>' + esc(ev.entityId) + '</code></div>' : '') +
          '</td>' +
          '<td>' +
          esc(ev.ipAddress || '—') +
          '</td>' +
          '<td>' +
          (hasDiff
            ? '<button type="button" class="btn secondary" data-diff="' + esc(ev.id) + '">Diff</button>'
            : '<span class="muted">—</span>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-diff]').forEach((btn) => {
      btn.onclick = () => {
        const ev = cache[btn.getAttribute('data-diff')];
        if (ev) openDiff(ev);
      };
    });
  }

  document.getElementById('btnFilter').onclick = () => {
    page = 1;
    loadList();
  };
  document.getElementById('btnDiffClose').onclick = () => {
    document.getElementById('diffModal').classList.remove('show');
  };
  document.getElementById('diffModal').addEventListener('click', (e) => {
    if (e.target.id === 'diffModal') e.target.classList.remove('show');
  });

  loadList();
})();
