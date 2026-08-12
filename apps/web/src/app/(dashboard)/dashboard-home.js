/**
 * Dashboard Overview — per-widget useCan() gates (not a page-level gate).
 *
 * | Widget              | Gate                                      | Endpoints |
 * |---------------------|-------------------------------------------|-----------|
 * | Revenue / members   | reports.financial.view                    | GET /analytics/overview (+ snapshotTimeUtc) |
 * | Check-ins           | members.view                              | today → /attendance/today; week → /reports/attendance-summary |
 * | My open shift       | shift.open                                | GET/POST /shifts/current, close           |
 * | My sessions today   | AnyStaff (Trainer UI)                     | GET /pt-sessions + /classes (client filter trainerId) |
 * | Front-desk queue    | checkin.manual OR sales.sell              | manual today + /debtors                   |
 * | Staff activity      | settings.manage                           | GET /audit?pageSize=8                     |
 * | Quick Actions       | fallback when zero widgets                | Front desk items from useVisibleNav()     |
 */
(function (global) {
  'use strict';

  function can(access) {
    return global.GfpAuthz && global.GfpAuthz.useCan(access);
  }

  function roleNorm() {
    return global.GfpAuthz ? global.GfpAuthz.normalizeRole(global.GfpAuthz.getUserRole()) : '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(
      Number(n) || 0
    );
  }

  function asOfLocal(iso) {
    if (!iso) return 'as of —';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'as of —';
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return 'as of ' + hh + ':' + mm;
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return (
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0')
    );
  }

  function fmtDateOnly(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function currentUserIds() {
    var ids = [];
    var user = (global.GfpApi && global.GfpApi.tokens.getUser()) || null;
    if (user && user.id) ids.push(String(user.id));
    try {
      var payload =
        global.GfpAuthz && global.GfpAuthz.decodeJwtPayload(global.GfpAuthz.getAccessToken());
      if (payload && payload.sub) ids.push(String(payload.sub));
    } catch (e) { /* ignore */ }
    return ids;
  }

  function unwrapList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  async function apiGet(path) {
    if (!global.GfpApi) return { ok: false, status: 0, data: null };
    var r = await global.GfpApi.get(path);
    if (r.status === 401 && !(r.headers && String(r.headers.get('Token-Expired') || '').toLowerCase() === 'true')) {
      global.location.href = '/auth/login/';
      return { ok: false, status: 401, data: null };
    }
    return r;
  }

  async function apiSend(method, path, body) {
    if (!global.GfpApi) return { ok: false, status: 0, data: null };
    var r =
      method === 'POST'
        ? await global.GfpApi.post(path, body)
        : await global.GfpApi.get(path);
    if (r.status === 401 && !(r.headers && String(r.headers.get('Token-Expired') || '').toLowerCase() === 'true')) {
      global.location.href = '/auth/login/';
    }
    return r;
  }

  function widgetShell(opts) {
    return (
      '<article class="dash-widget" data-widget="' +
      esc(opts.id) +
      '">' +
      '<header class="dash-widget-hdr">' +
      '<div>' +
      '<h2 class="dash-widget-title"><i class="ti ' +
      esc(opts.icon) +
      '"></i> ' +
      esc(opts.title) +
      '</h2>' +
      (opts.sub
        ? '<p class="dash-widget-sub">' + opts.sub + '</p>'
        : '') +
      '</div>' +
      (opts.badge || '') +
      '</header>' +
      '<div class="dash-widget-body" id="' +
      esc(opts.bodyId) +
      '">' +
      (opts.body || '<div class="dash-muted">Loading…</div>') +
      '</div></article>'
    );
  }

  // ── Revenue + activeMembers (snapshot) ─────────────────────────
  function canRevenue() {
    return can('reports.financial.view');
  }

  async function loadRevenue(el) {
    var r = await apiGet('/analytics/overview');
    if (!r.ok || !r.data) {
      el.innerHTML = '<div class="dash-muted">Could not load snapshot</div>';
      return;
    }
    var d = r.data;
    el.innerHTML =
      '<div class="dash-kpi-row">' +
      '<div class="dash-kpi"><span class="lbl">Revenue this month</span><strong>' +
      esc(money(d.revenueThisMonth)) +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">Active members</span><strong>' +
      esc(Number(d.activeMembers || 0).toLocaleString()) +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">New this month</span><strong>' +
      esc(Number(d.newMembersThisMonth || 0).toLocaleString()) +
      '</strong></div>' +
      '</div>' +
      '<p class="dash-snapshot" title="Snapshot time (UTC source shown in local clock)">' +
      '<i class="ti ti-clock"></i> ' +
      esc(asOfLocal(d.snapshotTimeUtc)) +
      ' <span class="dash-muted">· snapshot, not live</span></p>';
  }

  // ── Check-ins (live members.view) ──────────────────────────────
  function canCheckins() {
    return can('members.view');
  }

  async function loadCheckins(el) {
    var todayCount = 0;
    var weekCount = 0;

    var todayRes = await apiGet('/attendance/today?filter=all');
    if (todayRes.ok) todayCount = unwrapList(todayRes.data).length;

    var to = new Date();
    var from = new Date();
    from.setDate(from.getDate() - 6);
    var sumRes = await apiGet(
      '/reports/attendance-summary?from=' + fmtDateOnly(from) + '&to=' + fmtDateOnly(to)
    );
    if (sumRes.ok) {
      weekCount = unwrapList(sumRes.data).reduce(function (acc, row) {
        return acc + (Number(row.checkinCount) || 0);
      }, 0);
    } else {
      weekCount = todayCount;
    }

    el.innerHTML =
      '<div class="dash-kpi-row">' +
      '<div class="dash-kpi"><span class="lbl">Check-ins today</span><strong>' +
      todayCount +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">Check-ins this week</span><strong>' +
      weekCount +
      '</strong></div>' +
      '</div>' +
      '<p class="dash-muted" style="margin-top:10px"><a href="/dashboard/attendance/">Open attendance</a></p>';
  }

  // ── My open shift ──────────────────────────────────────────────
  function canShift() {
    return can('shift.open');
  }

  function renderShiftBody(shift) {
    if (!shift || shift.status !== 'open') {
      return (
        '<p class="dash-muted">No open shift.</p>' +
        '<div class="dash-actions">' +
        '<button type="button" class="dash-btn primary" data-shift-open>Open shift</button>' +
        '<a class="dash-btn ghost" href="/dashboard/shifts/">Shift desk</a>' +
        '</div>'
      );
    }
    return (
      '<div class="dash-kpi-row">' +
      '<div class="dash-kpi"><span class="lbl">Status</span><strong class="ok">Open</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">Opened</span><strong>' +
      esc(fmtTime(shift.openedAt)) +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">Opening float</span><strong>' +
      esc(money(shift.openingFloat)) +
      '</strong></div>' +
      '</div>' +
      '<div class="dash-actions">' +
      (can('shift.close')
        ? '<a class="dash-btn primary" href="/dashboard/shifts/">Close (blind count)</a>'
        : '') +
      '<a class="dash-btn ghost" href="/dashboard/shifts/">Manage shift</a>' +
      '</div>' +
      '<p class="dash-muted" style="margin-top:8px">Close requires counted cash — use the Shifts screen (blind count).</p>'
    );
  }

  async function loadShift(el) {
    var r = await apiGet('/shifts/current');
    var shift = null;
    if (r.ok && r.data) shift = r.data;
    el.innerHTML = renderShiftBody(shift);

    var openBtn = el.querySelector('[data-shift-open]');
    if (openBtn) {
      openBtn.addEventListener('click', async function () {
        var raw = global.prompt('Opening float (EGP)', '0');
        if (raw == null) return;
        var openingFloat = Number(raw);
        if (Number.isNaN(openingFloat) || openingFloat < 0) {
          global.alert('Enter a non-negative amount.');
          return;
        }
        openBtn.disabled = true;
        var res = await apiSend('POST', '/shifts/open', { openingFloat: openingFloat });
        if (!res.ok) {
          var title = (res.data && (res.data.title || res.data.detail)) || 'Could not open shift';
          global.alert(title);
          openBtn.disabled = false;
          return;
        }
        el.innerHTML = renderShiftBody(res.data);
      });
    }
  }

  // ── My sessions today (Trainer / staff) ────────────────────────
  function canSessions() {
    if (!can({ kind: 'policy', value: 'AnyStaff' })) return false;
    // Widget targets trainers; Owner/Manager still see the card (full grid).
    var r = roleNorm();
    return r === 'trainer' || r === 'owner' || r === 'manager';
  }

  function matchesTrainer(row, ids) {
    var tid = row.trainerId != null ? String(row.trainerId) : row.trainerUserId != null ? String(row.trainerUserId) : '';
    if (!tid) return false;
    return ids.indexOf(tid) !== -1;
  }

  async function loadSessions(el) {
    var ids = currentUserIds();
    var today = fmtDateOnly(new Date());
    var paths = [
      '/pt-sessions?date=' + today,
      '/pt-sessions?from=' + today + '&to=' + today,
      '/classes?date=' + today,
      '/classes?from=' + today + '&to=' + today
    ];
    var rows = [];
    var anyOk = false;
    for (var i = 0; i < paths.length; i++) {
      var r = await apiGet(paths[i]);
      if (r.status === 404) continue;
      if (r.ok) {
        anyOk = true;
        unwrapList(r.data).forEach(function (row) {
          rows.push(row);
        });
      }
    }

    var mine = rows.filter(function (row) {
      return matchesTrainer(row, ids);
    });

    if (!anyOk) {
      el.innerHTML =
        '<p class="dash-muted">No PT sessions / classes endpoint available yet.</p>';
      return;
    }
    if (!mine.length) {
      el.innerHTML = '<p class="dash-muted">No sessions assigned to you today.</p>';
      return;
    }

    el.innerHTML =
      '<ul class="dash-list">' +
      mine
        .slice(0, 8)
        .map(function (s) {
          var label = s.title || s.name || s.className || s.memberName || 'Session';
          var when = s.startAtUtc || s.startsAtUtc || s.startTime || s.scheduledAtUtc || '';
          return (
            '<li><span class="dash-list-main">' +
            esc(label) +
            '</span><span class="dash-list-meta">' +
            esc(fmtTime(when)) +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>';
  }

  // ── Front-desk queue ───────────────────────────────────────────
  function canFrontDesk() {
    return can('checkin.manual') || can('sales.sell');
  }

  async function loadFrontDesk(el) {
    var parts = [];

    if (can('members.view')) {
      var att = await apiGet('/attendance/today?filter=manual');
      var manuals = att.ok ? unwrapList(att.data) : [];
      parts.push(
        '<div class="dash-queue-block">' +
          '<h3>Manual check-ins today</h3>' +
          (manuals.length
            ? '<ul class="dash-list">' +
              manuals
                .slice(0, 5)
                .map(function (m) {
                  return (
                    '<li><span class="dash-list-main">' +
                    esc(m.memberName || 'Member') +
                    '</span><span class="dash-list-meta">' +
                    esc(fmtTime(m.checkInAtUtc)) +
                    '</span></li>'
                  );
                })
                .join('') +
              '</ul>'
            : '<p class="dash-muted">None yet</p>') +
          (can('checkin.manual')
            ? '<a class="dash-link" href="/dashboard/attendance/">Manual check-in →</a>'
            : '') +
          '</div>'
      );
    } else if (can('checkin.manual')) {
      parts.push(
        '<div class="dash-queue-block">' +
          '<h3>Manual check-in</h3>' +
          '<p class="dash-muted">Ready at the attendance desk.</p>' +
          '<a class="dash-link" href="/dashboard/attendance/">Open attendance →</a>' +
          '</div>'
      );
    }

    if (can('sales.sell')) {
      var deb = await apiGet('/debtors?page=1&pageSize=5');
      var debtors = deb.ok ? unwrapList(deb.data) : [];
      parts.push(
        '<div class="dash-queue-block">' +
          '<h3>Debtors due</h3>' +
          (debtors.length
            ? '<ul class="dash-list">' +
              debtors
                .map(function (d) {
                  return (
                    '<li><span class="dash-list-main">' +
                    esc(d.fullName || 'Member') +
                    '</span><span class="dash-list-meta">' +
                    esc(money(d.totalDue)) +
                    '</span></li>'
                  );
                })
                .join('') +
              '</ul>'
            : '<p class="dash-muted">No outstanding balances</p>') +
          '<a class="dash-link" href="/dashboard/debtors/">Debtors →</a>' +
          '</div>'
      );
    }

    el.innerHTML = parts.join('') || '<p class="dash-muted">Nothing queued.</p>';
  }

  // ── Staff activity (Owner / settings.manage) ───────────────────
  function canStaffActivity() {
    return can('settings.manage');
  }

  async function loadStaffActivity(el) {
    var r = await apiGet('/audit?page=1&pageSize=8');
    if (!r.ok || !r.data) {
      el.innerHTML = '<div class="dash-muted">Could not load audit feed</div>';
      return;
    }
    var items = unwrapList(r.data);
    if (!items.length) {
      el.innerHTML = '<p class="dash-muted">No recent staff activity</p>';
      return;
    }
    el.innerHTML =
      '<ul class="dash-list">' +
      items
        .map(function (e) {
          var actor = e.actorUserId ? String(e.actorUserId).slice(0, 8) + '…' : 'system';
          return (
            '<li><span class="dash-list-main">' +
            esc(e.action || 'event') +
            ' <span class="dash-muted">· ' +
            esc(e.entityType || '') +
            '</span></span><span class="dash-list-meta">' +
            esc(fmtTime(e.createdAtUtc)) +
            ' · ' +
            esc(actor) +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>' +
      '<a class="dash-link" href="/dashboard/audit/">Full audit log →</a>';
  }

  // ── Quick Actions fallback ─────────────────────────────────────
  function frontDeskNavItems() {
    var cats = [];
    if (global.GfpShell && global.GfpShell.useVisibleNav) cats = global.GfpShell.useVisibleNav();
    else if (global.useVisibleNav) cats = global.useVisibleNav();
    var fd = null;
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].key === 'front-desk') {
        fd = cats[i];
        break;
      }
    }
    return (fd && fd.items) || [];
  }

  function renderQuickActions(host) {
    var items = frontDeskNavItems();
    var tLabel = function (en, ar) {
      return global.GfpI18n ? global.GfpI18n.tLabel(en, ar) : en;
    };
    var body;
    if (!items.length) {
      body =
        '<p class="dash-muted">No Front Desk actions are available for this account. Contact your gym owner.</p>';
    } else {
      body =
        '<div class="dash-quick">' +
        items
          .map(function (it) {
            return (
              '<a class="dash-quick-item" href="' +
              esc(it.path) +
              '"><i class="ti ' +
              esc(it.icon || 'ti-circle') +
              '"></i><span>' +
              esc(tLabel(it.label, it.labelAr)) +
              '</span></a>'
            );
          })
          .join('') +
        '</div>';
    }
    host.innerHTML = widgetShell({
      id: 'quick-actions',
      icon: 'ti-bolt',
      title: 'Quick Actions',
      sub: 'Shortcuts granted to your role',
      bodyId: 'wQuickBody',
      body: body
    });
  }

  async function bootWidgets() {
    var host = global.document.getElementById('widgetGrid');
    if (!host) return;

    var widgets = [];
    if (canRevenue()) {
      widgets.push({
        id: 'revenue',
        icon: 'ti-currency-dollar',
        title: 'Revenue & members',
        sub: '§16 analytics overview snapshot',
        bodyId: 'wRevenueBody',
        load: loadRevenue,
        badge: '<span class="dash-perm">reports.financial.view</span>'
      });
    }
    if (canCheckins()) {
      widgets.push({
        id: 'checkins',
        icon: 'ti-door-enter',
        title: 'Check-ins',
        sub: 'Live attendance counts',
        bodyId: 'wCheckinsBody',
        load: loadCheckins,
        badge: '<span class="dash-perm">members.view</span>'
      });
    }
    if (canShift()) {
      widgets.push({
        id: 'shift',
        icon: 'ti-cash',
        title: 'My open shift',
        sub: 'Cash drawer status',
        bodyId: 'wShiftBody',
        load: loadShift,
        badge: '<span class="dash-perm">shift.open</span>'
      });
    }
    if (canSessions()) {
      widgets.push({
        id: 'sessions',
        icon: 'ti-dumbbell',
        title: 'My sessions today',
        sub: 'Filtered to your trainerId',
        bodyId: 'wSessionsBody',
        load: loadSessions,
        badge: '<span class="dash-perm">AnyStaff</span>'
      });
    }
    if (canFrontDesk()) {
      widgets.push({
        id: 'queue',
        icon: 'ti-list-check',
        title: "Today's front-desk queue",
        sub: 'Manual check-ins & debtors',
        bodyId: 'wQueueBody',
        load: loadFrontDesk,
        badge: '<span class="dash-perm">checkin / sales</span>'
      });
    }
    if (canStaffActivity()) {
      widgets.push({
        id: 'staff-activity',
        icon: 'ti-activity',
        title: 'Staff activity',
        sub: 'Owner mini audit feed',
        bodyId: 'wAuditBody',
        load: loadStaffActivity,
        badge: '<span class="dash-perm">settings.manage</span>'
      });
    }

    if (!widgets.length) {
      renderQuickActions(host);
      return;
    }

    host.innerHTML = widgets
      .map(function (w) {
        return widgetShell(w);
      })
      .join('');

    await Promise.all(
      widgets.map(function (w) {
        var el = global.document.getElementById(w.bodyId);
        return el ? w.load(el) : Promise.resolve();
      })
    );
  }

  function paintUserChrome() {
    var user = (global.GfpApi && global.GfpApi.tokens.getUser()) || null;
    if (!user) {
      global.location.href = '/auth/login/';
      return false;
    }
    var av = global.document.getElementById('userAvatar');
    var nm = global.document.getElementById('userName');
    var rl = global.document.getElementById('userRole');
    if (av) {
      av.textContent = (user.fullName || 'U')
        .split(/\s+/)
        .map(function (w) {
          return w[0];
        })
        .join('')
        .substring(0, 2)
        .toUpperCase();
    }
    if (nm) nm.textContent = user.fullName || 'User';
    if (rl) rl.textContent = user.role || 'Staff';
    return true;
  }

  async function loadGymName() {
    var gn = global.document.getElementById('gymName');
    var ga = global.document.getElementById('gymNameAr');
    // Prefer staff-readable branding (any auth) — Owner-only /settings fails for Receptionist.
    var r = await apiGet('/settings/branding');
    if (r.ok && r.data) {
      if (gn) gn.textContent = r.data.gymName || '';
      if (ga) ga.textContent = r.data.gymNameAr || '';
      if (global.GfpBranding && typeof global.GfpBranding.apply === 'function') {
        try {
          await global.GfpBranding.apply(r.data);
        } catch (e) { /* ignore */ }
      }
      return;
    }
    r = await apiGet('/settings');
    if (r.ok && r.data) {
      if (gn) gn.textContent = r.data.gymName || '';
      if (ga) ga.textContent = r.data.gymNameAr || '';
      return;
    }
    r = await apiGet('/settings/gym-code');
    if (r.ok && r.data && gn) gn.textContent = r.data.gymCode || gn.textContent;
  }

  function wireChrome() {
    var btn = global.document.getElementById('btnLogout');
    if (btn) {
      btn.addEventListener('click', function () {
        if (global.GfpApi) global.GfpApi.logout();
        else global.location.href = '/auth/login/';
      });
    }
    var mob = global.document.getElementById('mobToggle');
    var sidebar = global.document.getElementById('sidebar');
    if (mob && sidebar) {
      mob.addEventListener('click', function () {
        sidebar.classList.toggle('open');
      });
    }
  }

  async function init() {
    if (!paintUserChrome()) return;
    wireChrome();
    loadGymName();
    await bootWidgets();
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.GfpDashboardHome = { refresh: bootWidgets };
})(typeof window !== 'undefined' ? window : globalThis);
