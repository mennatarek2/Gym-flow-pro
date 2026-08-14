/**
 * Dashboard Overview — operational control center.
 *
 * Hierarchy: KPIs → Quick Actions → follow-ups → attendance/finance.
 * Real APIs only. Per-widget permission gates. No duplicated alert/glance strips.
 *
 * Data sources:
 *   GET /analytics/overview          reports.financial.view
 *   GET /analytics/members-status    members.view
 *   GET /analytics/revenue           reports.financial.view (monthly trend)
 *   GET /attendance/today            members.view
 *   GET /reports/attendance-summary  members.view
 *   GET /debtors/summary             reports.financial.view
 *   GET /debtors                     sales.sell (count / top preview)
 *   GET /call-sheet/expiring         sales.sell
 *   GET /inventory/reports/summary   inventory.view
 *   GET /reports/z/{date}            reports.financial.view (optional)
 *   GET /member-orders               FE module (not yet in contracts)
 *   GET /shifts/current              shift.open
 */
(function (global) {
  'use strict';

  var state = {
    overview: null,
    membersStatus: null,
    checkinsToday: null,
    attendanceWeek: null,
    debtorsSummary: null,
    debtorsPreview: null,
    expiring: null,
    inventory: null,
    zReport: null,
    ordersPending: null,
    ordersReady: null,
    shift: null,
    revenueChart: null,
    revenueMonths: 6
  };

  var charts = { attendance: null, revenue: null };

  function can(access) {
    return global.GfpAuthz && global.GfpAuthz.useCan(access);
  }

  function t(en, ar) {
    return global.GfpI18n && global.GfpI18n.tLabel ? global.GfpI18n.tLabel(en, ar) : en;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 0
    }).format(Number(n) || 0);
  }

  function num(n) {
    return Number(n || 0).toLocaleString();
  }

  function fmtDateOnly(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function daysUntil(iso) {
    if (!iso) return null;
    var end = new Date(iso);
    if (Number.isNaN(end.getTime())) {
      // DateOnly YYYY-MM-DD
      var p = String(iso).split('-');
      if (p.length === 3) end = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    if (Number.isNaN(end.getTime())) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.round((end - today) / 86400000);
  }

  function unwrapList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  function pagedTotal(data) {
    if (!data) return 0;
    if (typeof data.totalCount === 'number') return data.totalCount;
    return unwrapList(data).length;
  }

  async function apiGet(path) {
    if (!global.GfpApi) return { ok: false, status: 0, data: null };
    var r = await global.GfpApi.get(path);
    if (
      r.status === 401 &&
      !(r.headers && String(r.headers.get('Token-Expired') || '').toLowerCase() === 'true')
    ) {
      global.location.href = '/auth/login/';
      return { ok: false, status: 401, data: null };
    }
    return r;
  }

  async function apiPost(path, body) {
    if (!global.GfpApi) return { ok: false, status: 0, data: null };
    var r = await global.GfpApi.post(path, body);
    if (
      r.status === 401 &&
      !(r.headers && String(r.headers.get('Token-Expired') || '').toLowerCase() === 'true')
    ) {
      global.location.href = '/auth/login/';
    }
    return r;
  }

  function ensureChartJs() {
    return new Promise(function (resolve) {
      if (global.Chart) {
        resolve(true);
        return;
      }
      var s = global.document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
      s.onload = function () {
        resolve(!!global.Chart);
      };
      s.onerror = function () {
        resolve(false);
      };
      global.document.head.appendChild(s);
    });
  }

  function widgetShell(opts) {
    var span = opts.span || 6;
    return (
      '<article class="dash-widget span-' +
      span +
      '" data-widget="' +
      esc(opts.id) +
      '">' +
      '<header class="dash-widget-hdr">' +
      '<div>' +
      '<h2 class="dash-widget-title"><i class="ti ' +
      esc(opts.icon) +
      '"></i> ' +
      esc(opts.title) +
      '</h2>' +
      (opts.sub ? '<p class="dash-widget-sub">' + opts.sub + '</p>' : '') +
      '</div>' +
      (opts.badge || '') +
      '</header>' +
      '<div class="dash-widget-body" id="' +
      esc(opts.bodyId) +
      '">' +
      (opts.body || '<div class="dash-muted">' + esc(t('Loading…', 'جاري التحميل…')) + '</div>') +
      '</div></article>'
    );
  }

  function errBox(msg, retryAttr) {
    return (
      '<div class="dash-local-err">' +
      '<p>' +
      esc(msg || t('Unable to load this information.', 'مش قادرين نحمّل المعلومات دي.')) +
      '</p>' +
      (retryAttr
        ? '<button type="button" class="dash-btn" data-retry="' +
          esc(retryAttr) +
          '">' +
          esc(t('Retry', 'إعادة المحاولة')) +
          '</button>'
        : '') +
      '</div>'
    );
  }

  function linkRow(href, label) {
    return (
      '<a class="dash-link" href="' + esc(href) + '">' + esc(label) + ' →</a>'
    );
  }

  // ── Permission helpers ─────────────────────────────────────────
  var canMembers = function () {
    return can('members.view');
  };
  var canFinance = function () {
    return can('reports.financial.view');
  };
  var canSales = function () {
    return can('sales.sell');
  };
  var canCheckin = function () {
    return can('checkin.manual');
  };
  var canInventory = function () {
    return can('inventory.view');
  };
  var canShift = function () {
    return can('shift.open');
  };
  var canCreateMember = function () {
    return can('members.create');
  };
  var canOrders = function () {
    return (
      canSales() ||
      can('orders.view') ||
      can('orders.fulfill') ||
      can('memberorders.view') ||
      can('memberorders.manage')
    );
  };

  // ── Data loaders ───────────────────────────────────────────────
  async function loadOverview() {
    if (!canFinance()) return;
    var r = await apiGet('/analytics/overview');
    state.overview = r.ok ? r.data : { __err: true };
  }

  async function loadMembersStatus() {
    if (!canMembers()) return;
    var r = await apiGet('/analytics/members-status');
    state.membersStatus = r.ok ? r.data : { __err: true };
  }

  async function loadCheckinsToday() {
    if (!canMembers()) return;
    var r = await apiGet('/attendance/today?filter=all');
    if (!r.ok) {
      state.checkinsToday = { __err: true };
      return;
    }
    state.checkinsToday = { count: unwrapList(r.data).length };
  }

  async function loadAttendanceWeek() {
    if (!canMembers()) return;
    var to = new Date();
    var from = new Date();
    from.setDate(from.getDate() - 6);
    var r = await apiGet(
      '/reports/attendance-summary?from=' + fmtDateOnly(from) + '&to=' + fmtDateOnly(to)
    );
    state.attendanceWeek = r.ok ? unwrapList(r.data) : { __err: true };
  }

  async function loadDebtors() {
    if (canFinance()) {
      var s = await apiGet('/debtors/summary');
      state.debtorsSummary = s.ok ? s.data : { __err: true };
    }
    if (canSales()) {
      var l = await apiGet('/debtors?page=1&pageSize=3');
      if (l.ok) {
        state.debtorsPreview = {
          items: unwrapList(l.data),
          totalCount: pagedTotal(l.data)
        };
      } else {
        state.debtorsPreview = { __err: true };
      }
    }
  }

  async function loadExpiring() {
    if (!canSales()) return;
    var r = await apiGet('/call-sheet/expiring?days=7');
    state.expiring = r.ok ? unwrapList(r.data) : { __err: true };
  }

  async function loadInventory() {
    if (!canInventory()) return;
    var r = await apiGet('/inventory/reports/summary');
    state.inventory = r.ok ? r.data : { __err: true };
  }

  async function loadZReport() {
    if (!canFinance()) return;
    var r = await apiGet('/reports/z/' + fmtDateOnly(new Date()));
    if (r.ok && r.data) state.zReport = r.data;
    else if (r.status === 404) state.zReport = null; // not generated yet — omit, don't error
    else state.zReport = { __err: true };
  }

  async function loadOrders() {
    if (!canOrders()) return;
    var Mo = global.GfpMemberOrdersApi;
    async function countStatus(status) {
      var path = Mo && Mo.paths ? Mo.paths.list({ page: 1, pageSize: 1, status: status }) : '/member-orders?page=1&pageSize=1&status=' + encodeURIComponent(status);
      var r = await apiGet(path);
      if (!r.ok) return { __err: true };
      return { count: pagedTotal(r.data) };
    }
    var pending = await countStatus('Pending');
    var ready = await countStatus('Ready');
    state.ordersPending = pending;
    state.ordersReady = ready;
  }

  async function loadShift() {
    if (!canShift()) return;
    var r = await apiGet('/shifts/current');
    if (r.ok) state.shift = r.data || null;
    else state.shift = { __err: true };
  }

  async function loadRevenueChartData(months) {
    if (!canFinance()) return;
    var r = await apiGet('/analytics/revenue?months=' + (months || 6));
    state.revenueChart = r.ok ? r.data : { __err: true };
  }

  // ── Derived KPI values ─────────────────────────────────────────
  function activeMembersValue() {
    if (state.overview && !state.overview.__err && state.overview.activeMembers != null)
      return Number(state.overview.activeMembers);
    if (state.membersStatus && !state.membersStatus.__err && state.membersStatus.active != null)
      return Number(state.membersStatus.active);
    return null;
  }

  function checkinsTodayValue() {
    if (state.checkinsToday && !state.checkinsToday.__err) return state.checkinsToday.count;
    if (state.overview && !state.overview.__err && state.overview.checkinsToday != null)
      return Number(state.overview.checkinsToday);
    return null;
  }

  function todaySalesCount() {
    if (state.zReport && !state.zReport.__err && Array.isArray(state.zReport.methodTotals)) {
      return state.zReport.methodTotals.reduce(function (a, m) {
        return a + (Number(m.count) || 0);
      }, 0);
    }
    if (state.inventory && !state.inventory.__err && state.inventory.todayRetailUnits != null)
      return Number(state.inventory.todayRetailUnits);
    return null;
  }

  function todayRevenueValue() {
    if (state.zReport && !state.zReport.__err) {
      var methods = state.zReport.methodTotals || [];
      var sum = methods.reduce(function (a, m) {
        return a + (Number(m.total) || 0);
      }, 0);
      if (methods.length) return sum;
    }
    if (
      state.inventory &&
      !state.inventory.__err &&
      state.inventory.todayRetailSalesEgp != null &&
      canFinance()
    ) {
      return Number(state.inventory.todayRetailSalesEgp);
    }
    return null;
  }

  function monthRevenueValue() {
    if (state.overview && !state.overview.__err && state.overview.revenueThisMonth != null)
      return Number(state.overview.revenueThisMonth);
    return null;
  }

  function debtorsCount() {
    if (state.debtorsSummary && !state.debtorsSummary.__err)
      return Number(state.debtorsSummary.debtorCount || 0);
    if (state.debtorsPreview && !state.debtorsPreview.__err)
      return Number(state.debtorsPreview.totalCount || 0);
    return null;
  }

  function debtorsOutstanding() {
    if (state.debtorsSummary && !state.debtorsSummary.__err)
      return Number(state.debtorsSummary.totalOutstanding || 0);
    return null;
  }

  function refundsToday() {
    if (state.zReport && !state.zReport.__err && state.zReport.refundsTotal != null)
      return Number(state.zReport.refundsTotal);
    return null;
  }

  // ── Render: KPI row ────────────────────────────────────────────
  function renderKpis(el) {
    if (!el) return;
    var cards = [];

    var am = activeMembersValue();
    if (am != null) {
      var sub = '';
      if (state.overview && !state.overview.__err && state.overview.newMembersThisMonth != null) {
        sub =
          '+' +
          num(state.overview.newMembersThisMonth) +
          ' ' +
          t('this month', 'هذا الشهر');
      }
      cards.push(kpiCard(t('Active Members', 'الأعضاء النشطون'), num(am), sub));
    }

    var ci = checkinsTodayValue();
    if (ci != null) {
      cards.push(kpiCard(t("Today's Check-ins", 'حضور اليوم'), num(ci), ''));
    }

    var sales = todaySalesCount();
    if (sales != null && (canFinance() || canInventory() || canSales())) {
      cards.push(kpiCard(t("Today's Sales", 'مبيعات اليوم'), num(sales), ''));
    }

    var revToday = todayRevenueValue();
    var revMonth = monthRevenueValue();
    if (canFinance()) {
      if (revToday != null) {
        cards.push(kpiCard(t("Today's Revenue", 'إيراد اليوم'), money(revToday), ''));
      } else if (revMonth != null) {
        cards.push(
          kpiCard(
            t('Revenue this month', 'إيراد هذا الشهر'),
            money(revMonth),
            t('Snapshot', 'لقطة')
          )
        );
      }
    }

    var dc = debtorsCount();
    if (dc != null && (canFinance() || canSales())) {
      var dout = debtorsOutstanding();
      var dsub = dout != null ? money(dout) : '';
      cards.push(
        kpiCard(t('Outstanding', 'مستحقات'), num(dc) + ' ' + t('members', 'أعضاء'), dsub)
      );
    }

    if (!cards.length) {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No KPIs available for your role.', 'مفيش مؤشرات متاحة لدورك.')) +
        '</p>';
      return;
    }
    el.innerHTML = '<div class="dash-kpi-row">' + cards.join('') + '</div>';
  }

  /** Display-only KPI tile — never a link/button. */
  function kpiCard(label, value, sub) {
    return (
      '<div class="dash-kpi">' +
      '<span class="lbl">' +
      esc(label) +
      '</span>' +
      '<strong>' +
      esc(value) +
      '</strong>' +
      (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
      '</div>'
    );
  }

  // ── Quick Actions ──────────────────────────────────────────────
  function renderQuickActions(el) {
    if (!el) return;
    var actions = [];
    if (canCreateMember()) {
      actions.push({
        href: '/dashboard/members/',
        icon: 'ti-user-plus',
        en: '+ New Member',
        ar: '+ عضو جديد'
      });
    }
    if (canCheckin() || canMembers()) {
      actions.push({
        href: '/dashboard/attendance/',
        icon: 'ti-door-enter',
        en: 'Check-in',
        ar: 'تسجيل حضور'
      });
    }
    if (canSales()) {
      actions.push({
        href: '/dashboard/pos/?mode=retail',
        icon: 'ti-shopping-cart',
        en: 'New Sale',
        ar: 'بيع جديد'
      });
    }
    if (canOrders()) {
      actions.push({
        href: '/dashboard/member-orders/',
        icon: 'ti-shopping-bag',
        en: 'Member Orders',
        ar: 'طلبات الأعضاء'
      });
    }
    if (canSales()) {
      actions.push({
        href: '/dashboard/debtors/',
        icon: 'ti-cash',
        en: 'Collect Payment',
        ar: 'تحصيل'
      });
    }

    if (!actions.length) {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No quick actions for this account.', 'مفيش إجراءات سريعة للحساب ده.')) +
        '</p>';
      return;
    }

    el.innerHTML =
      '<div class="dash-quick">' +
      actions
        .map(function (a) {
          return (
            '<a class="dash-quick-item" href="' +
            esc(a.href) +
            '"><i class="ti ' +
            esc(a.icon) +
            '"></i><span>' +
            esc(t(a.en, a.ar)) +
            '</span></a>'
          );
        })
        .join('') +
      '</div>';
  }

  // ── Attendance widget ──────────────────────────────────────────
  function renderAttendance(el) {
    if (!el) return;
    if (!canMembers()) {
      el.innerHTML = '';
      return;
    }
    if (
      (state.checkinsToday && state.checkinsToday.__err) &&
      (!state.overview || state.overview.__err)
    ) {
      el.innerHTML = errBox(null, 'attendance');
      return;
    }
    var ci = checkinsTodayValue();
    var am = activeMembersValue();
    var ratio =
      ci != null && am != null && am > 0
        ? '<span class="dash-muted">' + esc(num(ci) + ' / ' + num(am)) + '</span>'
        : '';

    el.innerHTML =
      '<div class="dash-kpi-row compact">' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t("Today's check-ins", 'حضور اليوم')) +
      '</span><strong>' +
      esc(ci != null ? num(ci) : '—') +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Active members', 'الأعضاء النشطون')) +
      '</span><strong>' +
      esc(am != null ? num(am) : '—') +
      '</strong>' +
      (ratio ? '<span class="sub">' + ratio + '</span>' : '') +
      '</div>' +
      '</div>' +
      '<div class="dash-chart-wrap"><canvas id="dashAttChart" height="120"></canvas></div>' +
      linkRow('/dashboard/attendance/', t('View attendance', 'عرض الحضور'));

    paintAttendanceChart();
  }

  async function paintAttendanceChart() {
    var canvas = global.document.getElementById('dashAttChart');
    if (!canvas) return;
    if (!Array.isArray(state.attendanceWeek) || !state.attendanceWeek.length) {
      canvas.parentNode.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No attendance trend for the last 7 days.', 'مفيش اتجاه حضور لآخر 7 أيام.')) +
        '</p>';
      return;
    }
    var ok = await ensureChartJs();
    if (!ok || !global.Chart) return;
    var labels = state.attendanceWeek.map(function (r) {
      return r.date ? String(r.date).slice(5) : '';
    });
    var values = state.attendanceWeek.map(function (r) {
      return Number(r.checkinCount) || 0;
    });
    if (charts.attendance) charts.attendance.destroy();
    charts.attendance = new global.Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            data: values,
            backgroundColor: 'rgba(122,204,0,.45)',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { font: { size: 10 } } },
          x: { ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  // ── Finance widget ─────────────────────────────────────────────
  function renderFinance(el) {
    if (!el) return;
    if (!canFinance()) {
      el.innerHTML = '';
      return;
    }
    var revToday = todayRevenueValue();
    var revMonth = monthRevenueValue();
    var sales = todaySalesCount();
    var dout = debtorsOutstanding();
    var ref = refundsToday();

    el.innerHTML =
      '<div class="dash-kpi-row compact">' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(revToday != null ? t("Today's Revenue", 'إيراد اليوم') : t('Revenue this month', 'إيراد هذا الشهر')) +
      '</span><strong>' +
      esc(money(revToday != null ? revToday : revMonth || 0)) +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Sales', 'المبيعات')) +
      '</span><strong>' +
      esc(sales != null ? num(sales) : '—') +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Outstanding', 'مستحقات')) +
      '</span><strong>' +
      esc(dout != null ? money(dout) : '—') +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Refunds today', 'مرتجعات اليوم')) +
      '</span><strong>' +
      esc(ref != null ? money(ref) : '—') +
      '</strong></div>' +
      '</div>' +
      '<div class="dash-chart-hdr">' +
      '<span>' +
      esc(t('Revenue trend', 'اتجاه الإيراد')) +
      '</span>' +
      '<div class="dash-seg" id="revMonthsSeg">' +
      '<button type="button" class="dash-seg-btn' +
      (state.revenueMonths === 3 ? ' act' : '') +
      '" data-months="3">3</button>' +
      '<button type="button" class="dash-seg-btn' +
      (state.revenueMonths === 6 ? ' act' : '') +
      '" data-months="6">6</button>' +
      '</div>' +
      '<span class="dash-muted" style="font-size:11px">' +
      esc(t('months', 'شهور')) +
      '</span>' +
      '</div>' +
      '<div class="dash-chart-wrap"><canvas id="dashRevChart" height="140"></canvas></div>' +
      '<p class="dash-muted" style="margin-top:6px;font-size:11px">' +
      esc(
        t(
          'Monthly series from analytics (daily 7/30-day trend not available).',
          'سلسلة شهرية من التحليلات (مفيش اتجاه يومي لـ 7/30 يوم).'
        )
      ) +
      '</p>' +
      linkRow('/dashboard/reports/', t('View reports', 'عرض التقارير'));

    var seg = el.querySelector('#revMonthsSeg');
    if (seg) {
      seg.querySelectorAll('[data-months]').forEach(function (btn) {
        btn.onclick = async function () {
          state.revenueMonths = Number(btn.getAttribute('data-months')) || 6;
          await loadRevenueChartData(state.revenueMonths);
          renderFinance(el);
        };
      });
    }
    paintRevenueChart();
  }

  async function paintRevenueChart() {
    var canvas = global.document.getElementById('dashRevChart');
    if (!canvas) return;
    if (!state.revenueChart || state.revenueChart.__err) {
      canvas.parentNode.innerHTML = errBox(
        t('Unable to load revenue chart.', 'مش قادرين نحمّل مخطط الإيراد.'),
        'revenue-chart'
      );
      return;
    }
    var labels = state.revenueChart.labels || [];
    var values = state.revenueChart.values || [];
    if (!labels.length) {
      canvas.parentNode.innerHTML =
        '<p class="dash-muted">' + esc(t('No revenue data yet.', 'مفيش بيانات إيراد لسه.')) + '</p>';
      return;
    }
    var ok = await ensureChartJs();
    if (!ok || !global.Chart) return;
    if (charts.revenue) charts.revenue.destroy();
    charts.revenue = new global.Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            data: values,
            borderColor: '#7ACC00',
            backgroundColor: 'rgba(122,204,0,.15)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { font: { size: 10 } } },
          x: { ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  // ── Expiring memberships ───────────────────────────────────────
  function renderExpiring(el) {
    if (!el) return;
    if (!canSales()) {
      el.innerHTML = '';
      return;
    }
    if (state.expiring && state.expiring.__err) {
      el.innerHTML = errBox(null, 'expiring');
      return;
    }
    var rows = Array.isArray(state.expiring) ? state.expiring : [];
    if (!rows.length) {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No memberships expiring soon.', 'مفيش عضويات قاربت تنتهي.')) +
        '</p>' +
        linkRow('/dashboard/call-sheet/', t('View call sheet', 'عرض ورقة المتابعة'));
      return;
    }
    el.innerHTML =
      '<ul class="dash-list">' +
      rows
        .slice(0, 5)
        .map(function (e) {
          var dLeft = daysUntil(e.endDate);
          var daysLabel =
            dLeft == null
              ? esc(e.endDate || '—')
              : dLeft <= 0
                ? t('today', 'اليوم')
                : dLeft === 1
                  ? t('1 day', 'يوم واحد')
                  : dLeft + ' ' + t('days', 'أيام');
          var href = e.memberId
            ? '/dashboard/members/' + encodeURIComponent(e.memberId) + '/'
            : '/dashboard/call-sheet/';
          return (
            '<li>' +
            '<span class="dash-list-main">' +
            esc(e.fullName || t('Member', 'عضو')) +
            '</span>' +
            '<span class="dash-list-meta">' +
            esc(daysLabel) +
            '</span>' +
            '<a class="dash-btn" href="' +
            esc(href) +
            '">' +
            esc(t('Renew', 'تجديد')) +
            '</a>' +
            '</li>'
          );
        })
        .join('') +
      '</ul>' +
      linkRow('/dashboard/call-sheet/', t('View all', 'عرض الكل'));
  }

  // ── Member Orders summary ──────────────────────────────────────
  function renderOrders(el) {
    if (!el) return;
    if (!canOrders()) {
      el.innerHTML = '';
      return;
    }
    if (
      (state.ordersPending && state.ordersPending.__err) ||
      (state.ordersReady && state.ordersReady.__err)
    ) {
      el.innerHTML = errBox(null, 'orders');
      return;
    }
    var p = state.ordersPending ? Number(state.ordersPending.count || 0) : 0;
    var r = state.ordersReady ? Number(state.ordersReady.count || 0) : 0;
    if (!p && !r) {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No pending member orders.', 'مفيش طلبات أعضاء معلّقة.')) +
        '</p>' +
        linkRow('/dashboard/member-orders/', t('Open orders', 'فتح الطلبات'));
      return;
    }
    el.innerHTML =
      '<div class="dash-kpi-row compact">' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Pending', 'معلّق')) +
      '</span><strong>' +
      p +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Ready', 'جاهز')) +
      '</span><strong>' +
      r +
      '</strong></div>' +
      '</div>' +
      linkRow('/dashboard/member-orders/', t('Open orders', 'فتح الطلبات'));
  }

  // ── Debtors summary ────────────────────────────────────────────
  function renderDebtors(el) {
    if (!el) return;
    if (!canFinance() && !canSales()) {
      el.innerHTML = '';
      return;
    }
    if (
      (canFinance() && state.debtorsSummary && state.debtorsSummary.__err) ||
      (!canFinance() && state.debtorsPreview && state.debtorsPreview.__err)
    ) {
      el.innerHTML = errBox(null, 'debtors');
      return;
    }
    var count = debtorsCount();
    var outstanding = debtorsOutstanding();
    var preview =
      state.debtorsPreview && !state.debtorsPreview.__err ? state.debtorsPreview.items || [] : [];

    if (!count) {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No outstanding balances.', 'مفيش أرصدة مستحقة.')) +
        '</p>' +
        linkRow('/dashboard/debtors/', t('View debtors', 'عرض المدينين'));
      return;
    }

    var list = '';
    if (preview.length) {
      list =
        '<ul class="dash-list">' +
        preview
          .slice(0, 3)
          .map(function (d) {
            return (
              '<li><span class="dash-list-main">' +
              esc(d.fullName || t('Member', 'عضو')) +
              '</span><span class="dash-list-meta">' +
              esc(money(d.totalDue)) +
              '</span></li>'
            );
          })
          .join('') +
        '</ul>';
    }

    el.innerHTML =
      '<div class="dash-kpi-row compact">' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Debtors', 'المدينون')) +
      '</span><strong>' +
      esc(num(count)) +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Outstanding', 'المستحق')) +
      '</span><strong>' +
      esc(outstanding != null ? money(outstanding) : '—') +
      '</strong></div>' +
      '</div>' +
      list +
      linkRow('/dashboard/debtors/', t('View debtors', 'عرض المدينين'));
  }

  // ── Inventory alerts ───────────────────────────────────────────
  function renderInventory(el) {
    if (!el) return;
    if (!canInventory()) {
      el.innerHTML = '';
      return;
    }
    if (state.inventory && state.inventory.__err) {
      el.innerHTML = errBox(null, 'inventory');
      return;
    }
    var inv = state.inventory || {};
    var low = Number(inv.lowStockCount || 0);
    var out = Number(inv.outOfStockCount || 0);
    var expN = 0;
    if (Array.isArray(inv.expiringSoon)) {
      expN = inv.expiringSoon.reduce(function (a, w) {
        return a + (Number(w.batchCount) || 0);
      }, 0);
    }
    if (!low && !out && !expN) {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('Inventory looks good.', 'المخزون تمام.')) +
        '</p>' +
        linkRow('/dashboard/inventory/', t('View inventory', 'عرض المخزون'));
      return;
    }
    el.innerHTML =
      '<div class="dash-kpi-row compact">' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Low stock', 'مخزون منخفض')) +
      '</span><strong>' +
      low +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Out of stock', 'نفد المخزون')) +
      '</span><strong>' +
      out +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Expiring soon', 'قارب ينتهي')) +
      '</span><strong>' +
      expN +
      '</strong></div>' +
      '</div>' +
      linkRow('/dashboard/inventory/', t('View inventory', 'عرض المخزون'));
  }

  // ── Shift (compact, keep — operational) ────────────────────────
  function renderShift(el) {
    if (!el) return;
    if (!canShift()) {
      el.innerHTML = '';
      return;
    }
    if (state.shift && state.shift.__err) {
      el.innerHTML = errBox(null, 'shift');
      return;
    }
    var shift = state.shift;
    if (!shift || shift.status !== 'open') {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No open shift.', 'مفيش وردية مفتوحة.')) +
        '</p>' +
        '<div class="dash-actions">' +
        '<button type="button" class="dash-btn primary" data-shift-open>' +
        esc(t('Open shift', 'فتح وردية')) +
        '</button>' +
        '<a class="dash-btn ghost" href="/dashboard/shifts/">' +
        esc(t('Shift desk', 'شاشة الورديات')) +
        '</a></div>';
      var btn = el.querySelector('[data-shift-open]');
      if (btn) {
        btn.onclick = async function () {
          var raw = global.prompt(t('Opening float (EGP)', 'عهدة الافتتاح (ج.م)'), '0');
          if (raw == null) return;
          var openingFloat = Number(raw);
          if (Number.isNaN(openingFloat) || openingFloat < 0) {
            global.alert(t('Enter a non-negative amount.', 'ادخل مبلغ غير سالب.'));
            return;
          }
          btn.disabled = true;
          var res = await apiPost('/shifts/open', { openingFloat: openingFloat });
          if (!res.ok) {
            global.alert((res.data && (res.data.title || res.data.detail)) || t('Could not open shift', 'مش قادرين نفتح الوردية'));
            btn.disabled = false;
            return;
          }
          state.shift = res.data;
          renderShift(el);
        };
      }
      return;
    }
    el.innerHTML =
      '<div class="dash-kpi-row compact">' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Status', 'الحالة')) +
      '</span><strong class="ok">' +
      esc(t('Open', 'مفتوحة')) +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Opening float', 'عهدة الافتتاح')) +
      '</span><strong>' +
      esc(money(shift.openingFloat)) +
      '</strong></div>' +
      '</div>' +
      '<div class="dash-actions">' +
      (can('shift.close')
        ? '<a class="dash-btn primary" href="/dashboard/shifts/">' +
          esc(t('Close shift', 'قفل الوردية')) +
          '</a>'
        : '') +
      '<a class="dash-btn ghost" href="/dashboard/shifts/">' +
      esc(t('Manage', 'إدارة')) +
      '</a></div>';
  }

  // ── Shell / boot ───────────────────────────────────────────────
  function buildLayout(host) {
    var parts = [];

    // 1) Today / KPI (display-only)
    parts.push(
      widgetShell({
        id: 'kpis',
        icon: 'ti-layout-dashboard',
        title: t('Today', 'اليوم'),
        sub: t('What is happening in the gym right now', 'إيه اللي بيحصل في الجيم دلوقتي'),
        bodyId: 'wKpis',
        span: 12
      })
    );

    // 2) Quick Actions
    parts.push(
      widgetShell({
        id: 'quick-actions',
        icon: 'ti-bolt',
        title: t('Quick Actions', 'إجراءات سريعة'),
        sub: t('Common daily operations', 'عمليات يومية شائعة'),
        bodyId: 'wQuick',
        span: 12
      })
    );

    // 3) Memberships Expiring Soon + Member Orders
    if (canSales()) {
      parts.push(
        widgetShell({
          id: 'expiring',
          icon: 'ti-calendar-event',
          title: t('Memberships Expiring Soon', 'عضويات قاربت تنتهي'),
          bodyId: 'wExpiring',
          span: 6
        })
      );
    }
    if (canOrders()) {
      parts.push(
        widgetShell({
          id: 'orders',
          icon: 'ti-shopping-bag',
          title: t('Member Orders', 'طلبات الأعضاء'),
          bodyId: 'wOrders',
          span: 6
        })
      );
    }

    // 4) Debtors + Inventory Alerts
    if (canFinance() || canSales()) {
      parts.push(
        widgetShell({
          id: 'debtors',
          icon: 'ti-cash-off',
          title: t('Debtors', 'المدينون'),
          bodyId: 'wDebtors',
          span: 6
        })
      );
    }
    if (canInventory()) {
      parts.push(
        widgetShell({
          id: 'inventory',
          icon: 'ti-package',
          title: t('Inventory Alerts', 'تنبيهات المخزون'),
          bodyId: 'wInventory',
          span: 6
        })
      );
    }

    // 5–6) Today's Attendance + Financial Summary (includes revenue trend)
    if (canMembers()) {
      parts.push(
        widgetShell({
          id: 'attendance',
          icon: 'ti-door-enter',
          title: t("Today's Attendance", 'حضور اليوم'),
          bodyId: 'wAttendance',
          span: 6
        })
      );
    }
    if (canFinance()) {
      parts.push(
        widgetShell({
          id: 'finance',
          icon: 'ti-currency-dollar',
          title: t('Financial summary', 'ملخص مالي'),
          bodyId: 'wFinance',
          span: 6
        })
      );
    }

    if (canShift()) {
      parts.push(
        widgetShell({
          id: 'shift',
          icon: 'ti-cash',
          title: t('My open shift', 'ورديتي المفتوحة'),
          bodyId: 'wShift',
          span: 6
        })
      );
    }

    host.innerHTML = parts.join('');
  }

  function wireRetries(host) {
    host.addEventListener('click', async function (ev) {
      var btn = ev.target.closest('[data-retry]');
      if (!btn) return;
      var key = btn.getAttribute('data-retry');
      btn.disabled = true;
      if (key === 'attendance') {
        await Promise.all([loadCheckinsToday(), loadAttendanceWeek(), loadMembersStatus()]);
        renderAttendance(global.document.getElementById('wAttendance'));
      } else if (key === 'revenue-chart') {
        await loadRevenueChartData(state.revenueMonths);
        renderFinance(global.document.getElementById('wFinance'));
      } else if (key === 'expiring') {
        await loadExpiring();
        renderExpiring(global.document.getElementById('wExpiring'));
      } else if (key === 'orders') {
        await loadOrders();
        renderOrders(global.document.getElementById('wOrders'));
      } else if (key === 'debtors') {
        await loadDebtors();
        renderDebtors(global.document.getElementById('wDebtors'));
      } else if (key === 'inventory') {
        await loadInventory();
        renderInventory(global.document.getElementById('wInventory'));
      } else if (key === 'shift') {
        await loadShift();
        renderShift(global.document.getElementById('wShift'));
      }
      btn.disabled = false;
    });
  }

  async function bootWidgets() {
    var host = global.document.getElementById('widgetGrid');
    if (!host) return;

    buildLayout(host);
    wireRetries(host);

    // Independent loads — each widget paints when its data is ready
    var jobs = [
      loadOverview().then(function () {
        renderKpis(global.document.getElementById('wKpis'));
        if (canFinance()) renderFinance(global.document.getElementById('wFinance'));
        renderAttendance(global.document.getElementById('wAttendance'));
      }),
      loadMembersStatus().then(function () {
        renderKpis(global.document.getElementById('wKpis'));
        renderAttendance(global.document.getElementById('wAttendance'));
      }),
      loadCheckinsToday().then(function () {
        renderKpis(global.document.getElementById('wKpis'));
        renderAttendance(global.document.getElementById('wAttendance'));
      }),
      loadAttendanceWeek().then(function () {
        renderAttendance(global.document.getElementById('wAttendance'));
      }),
      loadDebtors().then(function () {
        renderKpis(global.document.getElementById('wKpis'));
        renderDebtors(global.document.getElementById('wDebtors'));
        if (canFinance()) renderFinance(global.document.getElementById('wFinance'));
      }),
      loadExpiring().then(function () {
        renderExpiring(global.document.getElementById('wExpiring'));
      }),
      loadInventory().then(function () {
        renderKpis(global.document.getElementById('wKpis'));
        renderInventory(global.document.getElementById('wInventory'));
        if (canFinance()) renderFinance(global.document.getElementById('wFinance'));
      }),
      loadZReport().then(function () {
        renderKpis(global.document.getElementById('wKpis'));
        if (canFinance()) renderFinance(global.document.getElementById('wFinance'));
      }),
      loadOrders().then(function () {
        renderOrders(global.document.getElementById('wOrders'));
      }),
      loadShift().then(function () {
        renderShift(global.document.getElementById('wShift'));
      }),
      loadRevenueChartData(state.revenueMonths).then(function () {
        if (canFinance()) renderFinance(global.document.getElementById('wFinance'));
      })
    ];

    renderQuickActions(global.document.getElementById('wQuick'));

    await Promise.all(jobs.map(function (p) {
      return p.catch(function () { /* widget-local errors */ });
    }));
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
<<<<<<< Updated upstream
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
=======
    var r = await apiGet('/settings');
>>>>>>> Stashed changes
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
    if (global.GfpI18n && global.GfpI18n.applyDocumentLocale) {
      global.GfpI18n.applyDocumentLocale();
    }
    await bootWidgets();
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.GfpDashboardHome = { refresh: bootWidgets };
})(typeof window !== 'undefined' ? window : globalThis);
