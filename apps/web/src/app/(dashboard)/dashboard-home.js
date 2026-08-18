/**
 * Dashboard Overview — operational control center.
 *
 * Hierarchy: KPIs → Quick Actions → follow-ups → attendance/finance → inventory (below fold).
 * Real APIs only. Per-widget permission gates.
 *
 * Data sources (no single consolidated dashboard endpoint in contracts — primary wave + lazy secondary):
 *   GET /analytics/overview          reports.financial.view
 *   GET /analytics/members-status    members.view
 *   GET /analytics/revenue           reports.financial.view (monthly trend)
 *   GET /attendance/today            members.view
 *   GET /attendance/occupancy        members.view (open visits vs gym_max_capacity)
 *   GET /reports/attendance-summary  members.view
 *   GET /debtors/summary             reports.financial.view (outstanding total; not a Debtors module)
 *   GET /debtors?page=1&pageSize=5   sales.sell (unpaid-sale buyers → Member 360)
 *   GET /call-sheet/expiring         sales.sell  (ingest: 1 row per membershipId)
 *   GET /inventory/reports/summary   inventory.view
 *   GET /reports/z/{date}            reports.financial.view (optional)
 *   GET /shifts/current              shift.open
 *   GET/PUT /settings/quick-actions  AnyStaff read / ManagerOrAbove write (tenant shortcut keys)
 */
(function (global) {
  'use strict';

  var CACHE_TTL_MS = 45000;
  var CACHE_PREFIX = 'gfp_dash_v1:';

  var state = {
    overview: null,
    membersStatus: null,
    checkinsToday: null,
    occupancy: null,
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
    revenueMonths: 6,
    chartsReady: { attendance: false, revenue: false },
    quickActionKeys: null,
    quickSaving: false
  };

  var charts = { attendance: null, revenue: null };
  var chartJsLoading = null;

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

  function cacheGet(key) {
    try {
      var raw = global.sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.at == null) return null;
      if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      global.sessionStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ at: Date.now(), data: data })
      );
    } catch (e) { /* ignore quota */ }
  }

  /**
   * Root fix for Nora-style duplicates at ingest (not render):
   * GET /call-sheet/expiring must be unique by membershipId.
   * Same membershipId repeated = backend join bug → collapse here + warn.
   * Same memberId / different membershipIds = legitimate multi-plan → keep.
   */
  function normalizeExpiringEntries(raw) {
    var list = unwrapList(raw);
    var byId = Object.create(null);
    var collapsed = 0;
    list.forEach(function (e) {
      if (!e) return;
      var key =
        e.membershipId != null && String(e.membershipId)
          ? String(e.membershipId)
          : [e.memberId, e.endDate, e.planName].join('|');
      if (byId[key]) {
        collapsed += 1;
        return;
      }
      byId[key] = e;
    });
    if (collapsed > 0 && global.console && console.warn) {
      console.warn(
        '[dashboard] Collapsed ' +
          collapsed +
          ' duplicate membershipId row(s) from GET /call-sheet/expiring. ' +
          'Backend CallSheetService should DISTINCT/GroupBy Membership.Id (likely join to payments/invoices/outcomes).'
      );
    }
    var out = Object.keys(byId).map(function (k) {
      return byId[k];
    });
    out.sort(function (a, b) {
      return String(a.endDate || '').localeCompare(String(b.endDate || ''));
    });
    return out;
  }

  function fmtShortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      var p = String(iso).split('-');
      if (p.length === 3) d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function phoneHint(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 4) return '';
    return '··' + digits.slice(-4);
  }

  function expiryPhrase(iso) {
    var dLeft = daysUntil(iso);
    var dateStr = fmtShortDate(iso);
    if (dLeft == null) return dateStr || '—';
    if (dLeft < 0) {
      return t('Expired', 'منتهي') + (dateStr ? ' · ' + dateStr : '');
    }
    if (dLeft === 0) {
      return t('Ends today', 'تنتهي اليوم') + (dateStr ? ' · ' + dateStr : '');
    }
    if (dLeft === 1) {
      return t('Ends tomorrow', 'تنتهي بكرة') + (dateStr ? ' · ' + dateStr : '');
    }
    return (
      t('In', 'خلال') +
      ' ' +
      dLeft +
      ' ' +
      t('days', 'أيام') +
      (dateStr ? ' · ' + dateStr : '')
    );
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

  async function apiGetCached(cacheKey, path) {
    var hit = cacheGet(cacheKey);
    if (hit !== null) return { ok: true, status: 200, data: hit, cached: true };
    var r = await apiGet(path);
    if (r.ok) cacheSet(cacheKey, r.data);
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
    if (global.Chart) return Promise.resolve(true);
    if (chartJsLoading) return chartJsLoading;
    chartJsLoading = new Promise(function (resolve) {
      var s = global.document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
      s.async = true;
      s.onload = function () {
        resolve(!!global.Chart);
      };
      s.onerror = function () {
        chartJsLoading = null;
        resolve(false);
      };
      global.document.head.appendChild(s);
    });
    return chartJsLoading;
  }

  function chartSkeleton() {
    return (
      '<div class="dash-chart-skel" aria-busy="true" aria-label="' +
      esc(t('Loading chart…', 'جاري تحميل المخطط…')) +
      '">' +
      '<div class="dash-skel-bar" style="height:70%"></div>' +
      '<div class="dash-skel-bar" style="height:45%"></div>' +
      '<div class="dash-skel-bar" style="height:85%"></div>' +
      '<div class="dash-skel-bar" style="height:55%"></div>' +
      '<div class="dash-skel-bar" style="height:65%"></div>' +
      '</div>'
    );
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
  var canInventory = function () {
    return can('inventory.view');
  };
  var canShift = function () {
    return can('shift.open');
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

  // ── Data loaders (short-lived cache on summary GETs) ───────────
  async function loadOverview() {
    if (!canFinance()) return;
    var r = await apiGetCached('overview', '/analytics/overview');
    state.overview = r.ok ? r.data : { __err: true };
  }

  async function loadMembersStatus() {
    if (!canMembers()) return;
    // Skip when overview already supplies activeMembers (avoid duplicate source)
    if (state.overview && !state.overview.__err && state.overview.activeMembers != null) return;
    var r = await apiGetCached('members-status', '/analytics/members-status');
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

  async function loadOccupancy() {
    if (!canMembers()) return;
    var r = await apiGet('/attendance/occupancy');
    state.occupancy = r.ok && r.data ? r.data : { __err: true };
  }

  async function loadAttendanceWeek() {
    if (!canMembers()) return;
    var to = new Date();
    var from = new Date();
    from.setDate(from.getDate() - 6);
    var path =
      '/reports/attendance-summary?from=' + fmtDateOnly(from) + '&to=' + fmtDateOnly(to);
    var r = await apiGetCached('att-week:' + fmtDateOnly(from), path);
    state.attendanceWeek = r.ok ? unwrapList(r.data) : { __err: true };
  }

  async function loadDebtors() {
    if (canFinance()) {
      var s = await apiGetCached('debtors-summary', '/debtors/summary');
      state.debtorsSummary = s.ok ? s.data : { __err: true };
    }
    if (canSales()) {
      var p = await apiGetCached('outstanding-preview', '/debtors?page=1&pageSize=5');
      state.debtorsPreview = p.ok ? p.data : { __err: true };
    }
  }

  async function loadExpiring() {
    if (!canSales()) return;
    var r = await apiGetCached('expiring-7', '/call-sheet/expiring?days=7');
    if (!r.ok) {
      state.expiring = { __err: true };
      return;
    }
    // Replace (never append). Normalize at ingest — root of Nora duplicates when API repeats membershipId.
    state.expiring = normalizeExpiringEntries(r.data);
  }

  async function loadInventory() {
    if (!canInventory()) return;
    var r = await apiGetCached('inv-summary', '/inventory/reports/summary');
    state.inventory = r.ok ? r.data : { __err: true };
  }

  async function loadZReport() {
    if (!canFinance()) return;
    var r = await apiGet('/reports/z/' + fmtDateOnly(new Date()));
    if (r.ok && r.data) state.zReport = r.data;
    else if (r.status === 404) state.zReport = null;
    else state.zReport = { __err: true };
  }

  async function loadOrders() {
    if (!canOrders()) return;
    var Mo = global.GfpMemberOrdersApi;
    async function countStatus(status) {
      var path =
        Mo && Mo.paths
          ? Mo.paths.list({ page: 1, pageSize: 1, status: status })
          : '/member-orders?page=1&pageSize=1&status=' + encodeURIComponent(status);
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
    var m = months || 6;
    var r = await apiGetCached('revenue:' + m, '/analytics/revenue?months=' + m);
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

  // ── Render: KPI row (ops only — money lives in Financial summary) ─
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
      cards.push(
        kpiCard(t("Today's Sales (count)", 'مبيعات اليوم (عدد)'), num(sales), '')
      );
    } else if (canFinance() || canInventory() || canSales()) {
      cards.push(kpiCard(t("Today's Sales (count)", 'مبيعات اليوم (عدد)'), '—', ''));
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
  function qaApi() {
    return global.GfpQuickActions || null;
  }

  function qaCanEdit() {
    if (global.GfpAuthz && global.GfpAuthz.useCanRole) {
      return global.GfpAuthz.useCanRole('ManagerOrAbove');
    }
    var qa = qaApi();
    return qa ? qa.canEdit() : false;
  }

  function qaFallbackDefs() {
    return [
      {
        key: 'new_member',
        en: 'New Member',
        ar: 'عضو جديد',
        icon: 'ti-user-plus',
        accent: 'qa-member',
        href: '/dashboard/members/?action=new'
      },
      {
        key: 'checkin',
        en: 'Check-in',
        ar: 'تسجيل حضور',
        icon: 'ti-door-enter',
        accent: 'qa-checkin',
        href: '/dashboard/attendance/'
      },
      {
        key: 'new_sale',
        en: 'New Sale',
        ar: 'بيع جديد',
        icon: 'ti-shopping-cart',
        accent: 'qa-sale',
        href: '/dashboard/pos/?mode=retail'
      },
      {
        key: 'collect_payment',
        en: 'Collect Payment',
        ar: 'تحصيل',
        icon: 'ti-cash',
        accent: 'qa-collect',
        href: '/dashboard/members/'
      }
    ];
  }

  function configuredKeys() {
    var qa = qaApi();
    if (Array.isArray(state.quickActionKeys) && state.quickActionKeys.length) {
      return state.quickActionKeys.slice();
    }
    return qa ? qa.defaultKeys() : ['new_member', 'checkin', 'new_sale', 'collect_payment'];
  }

  function visibleActionDefs() {
    var qa = qaApi();
    var fallback = qaFallbackDefs();
    var keys = configuredKeys();
    var out = [];
    keys.forEach(function (key) {
      var def = qa && qa.byKey ? qa.byKey(key) : null;
      if (!def) {
        for (var i = 0; i < fallback.length; i++) {
          if (fallback[i].key === key) {
            def = fallback[i];
            break;
          }
        }
      }
      if (!def) return;
      if (qa && qa.isTenantEnabled && !qa.isTenantEnabled(def)) return;
      out.push(def);
    });
    if (!out.length) return fallback.slice();
    return out.slice(0, qaMax());
  }

  function qaMax() {
    var qa = qaApi();
    return qa && qa.MAX_TILES ? qa.MAX_TILES : 6;
  }

  function qaToast(msg, type) {
    var el = global.document.getElementById('dashToast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'dash-toast show ' + (type === 'err' ? 'err' : 'ok');
    global.clearTimeout(qaToast._t);
    qaToast._t = global.setTimeout(function () {
      el.classList.remove('show');
    }, 3500);
  }

  function pickerCandidates() {
    var qa = qaApi();
    if (!qa) return [];
    var have = Object.create(null);
    configuredKeys().forEach(function (k) {
      have[k] = true;
    });
    return qa.WHITELIST.filter(function (def) {
      if (have[def.key]) return false;
      return qa.isTenantEnabled(def);
    });
  }

  function renderQuickActions(el) {
    if (!el) return;
    var edit = qaCanEdit();
    var defs = visibleActionDefs();
    var keys = configuredKeys();
    var atCap = keys.length >= qaMax();
    var busy = !!state.quickSaving;

    var tiles = defs
      .map(function (a) {
        var remove =
          edit && !busy
            ? '<button type="button" class="dash-qa-remove" data-qa-remove="' +
              esc(a.key) +
              '" aria-label="' +
              esc(t('Remove', 'إزالة')) +
              '"><i class="ti ti-x"></i></button>'
            : '';
        return (
          '<div class="dash-qa-tile">' +
          '<a class="dash-quick-item ' +
          esc(a.accent) +
          '" href="' +
          esc(a.href) +
          '"><span class="dash-quick-ico"><i class="ti ' +
          esc(a.icon) +
          '"></i></span><span>' +
          esc(t(a.en, a.ar)) +
          '</span></a>' +
          remove +
          '</div>'
        );
      })
      .join('');

    if (edit && !atCap) {
      tiles +=
        '<button type="button" class="dash-quick-item qa-add" data-qa-add>' +
        '<span class="dash-quick-ico"><i class="ti ti-plus"></i></span>' +
        '<span>' +
        esc(t('Add', 'إضافة')) +
        '</span></button>';
    }

    if (!defs.length && !edit) {
      el.innerHTML =
        '<p class="dash-muted">' +
        esc(t('No quick actions for this account.', 'مفيش إجراءات سريعة للحساب ده.')) +
        '</p>';
      return;
    }

    var manage =
      edit && atCap
        ? '<button type="button" class="dash-qa-manage-link dash-qa-manage-below" data-qa-manage>' +
          esc(t('Manage quick actions', 'إدارة الإجراءات السريعة')) +
          '</button>'
        : '';

    el.innerHTML =
      '<div class="dash-quick' +
      (busy ? ' is-saving' : '') +
      '" aria-busy="' +
      (busy ? 'true' : 'false') +
      '">' +
      tiles +
      '</div>' +
      manage;
  }

  function refreshQuickHeader() {
    var article = global.document.querySelector('[data-widget="quick-actions"]');
    if (!article) return;
    var hdr = article.querySelector('.dash-widget-hdr');
    if (!hdr) return;
    var existing = hdr.querySelector('[data-qa-manage]');
    if (existing) existing.remove();
    if (!qaCanEdit()) return;
    var btn = global.document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-qa-manage-link';
    btn.setAttribute('data-qa-manage', '');
    btn.textContent = t('Manage', 'إدارة');
    hdr.appendChild(btn);
  }

  function ensureQaModals() {
    if (global.document.getElementById('dashQaPicker')) return;
    var wrap = global.document.createElement('div');
    wrap.innerHTML =
      '<div class="dash-modal-overlay" id="dashQaPicker" hidden>' +
      '<div class="dash-modal" role="dialog" aria-modal="true" aria-labelledby="dashQaPickerTitle">' +
      '<header class="dash-modal-hdr">' +
      '<h3 id="dashQaPickerTitle"></h3>' +
      '<button type="button" class="dash-modal-close" data-qa-close aria-label="Close"><i class="ti ti-x"></i></button>' +
      '</header>' +
      '<div class="dash-modal-body" id="dashQaPickerBody"></div>' +
      '</div></div>' +
      '<div class="dash-modal-overlay" id="dashQaManage" hidden>' +
      '<div class="dash-modal dash-modal-wide" role="dialog" aria-modal="true" aria-labelledby="dashQaManageTitle">' +
      '<header class="dash-modal-hdr">' +
      '<h3 id="dashQaManageTitle"></h3>' +
      '<button type="button" class="dash-modal-close" data-qa-close aria-label="Close"><i class="ti ti-x"></i></button>' +
      '</header>' +
      '<div class="dash-modal-body" id="dashQaManageBody"></div>' +
      '</div></div>' +
      '<div class="dash-toast" id="dashToast" role="status"></div>';
    while (wrap.firstChild) global.document.body.appendChild(wrap.firstChild);
  }

  function closeQaModals() {
    ['dashQaPicker', 'dashQaManage'].forEach(function (id) {
      var el = global.document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  function openQaPicker() {
    ensureQaModals();
    var overlay = global.document.getElementById('dashQaPicker');
    var title = global.document.getElementById('dashQaPickerTitle');
    var body = global.document.getElementById('dashQaPickerBody');
    if (!overlay || !body) return;
    if (title) title.textContent = t('Add quick action', 'إضافة إجراء سريع');
    var candidates = pickerCandidates();
    if (!candidates.length) {
      body.innerHTML =
        '<p class="dash-muted">' +
        esc(t('All available actions are already added.', 'كل الإجراءات المتاحة متضافة بالفعل.')) +
        '</p>';
    } else {
      body.innerHTML =
        '<div class="dash-qa-pick-list">' +
        candidates
          .map(function (a) {
            return (
              '<button type="button" class="dash-qa-pick" data-qa-pick="' +
              esc(a.key) +
              '"><span class="dash-quick-ico ' +
              esc(a.accent) +
              '"><i class="ti ' +
              esc(a.icon) +
              '"></i></span><span>' +
              esc(t(a.en, a.ar)) +
              '</span></button>'
            );
          })
          .join('') +
        '</div>';
    }
    overlay.hidden = false;
  }

  function openQaManage() {
    ensureQaModals();
    var overlay = global.document.getElementById('dashQaManage');
    var title = global.document.getElementById('dashQaManageTitle');
    var body = global.document.getElementById('dashQaManageBody');
    if (!overlay || !body) return;
    if (title) title.textContent = t('Manage quick actions', 'إدارة الإجراءات السريعة');
    var qa = qaApi();
    var keys = configuredKeys();
    var atCap = keys.length >= qaMax();
    var rows = keys
      .map(function (key, i) {
        var def = qa && qa.byKey(key);
        if (!def) return '';
        return (
          '<li class="dash-qa-row">' +
          '<span class="dash-quick-ico ' +
          esc(def.accent) +
          '"><i class="ti ' +
          esc(def.icon) +
          '"></i></span>' +
          '<span class="dash-qa-row-label">' +
          esc(t(def.en, def.ar)) +
          '</span>' +
          '<span class="dash-qa-row-actions">' +
          '<button type="button" class="dash-btn" data-qa-up="' +
          i +
          '" ' +
          (i === 0 ? 'disabled' : '') +
          ' aria-label="' +
          esc(t('Move up', 'تحريك لأعلى')) +
          '"><i class="ti ti-arrow-up"></i></button>' +
          '<button type="button" class="dash-btn" data-qa-down="' +
          i +
          '" ' +
          (i === keys.length - 1 ? 'disabled' : '') +
          ' aria-label="' +
          esc(t('Move down', 'تحريك لأسفل')) +
          '"><i class="ti ti-arrow-down"></i></button>' +
          '<button type="button" class="dash-btn" data-qa-remove="' +
          esc(key) +
          '" aria-label="' +
          esc(t('Remove', 'إزالة')) +
          '"><i class="ti ti-x"></i></button>' +
          '</span></li>'
        );
      })
      .join('');

    var addSection = '';
    if (atCap) {
      addSection =
        '<p class="dash-muted">' +
        esc(
          t(
            'Maximum shortcuts reached. Remove one to add another.',
            'وصلت للحد الأقصى. شيل واحد عشان تضيف غيره.'
          )
        ) +
        '</p>';
    } else {
      var candidates = pickerCandidates();
      addSection =
        '<h4 class="dash-qa-section">' +
        esc(t('Add from list', 'أضف من القائمة')) +
        '</h4>' +
        (candidates.length
          ? '<div class="dash-qa-pick-list">' +
            candidates
              .map(function (a) {
                return (
                  '<button type="button" class="dash-qa-pick" data-qa-pick="' +
                  esc(a.key) +
                  '"><span class="dash-quick-ico ' +
                  esc(a.accent) +
                  '"><i class="ti ' +
                  esc(a.icon) +
                  '"></i></span><span>' +
                  esc(t(a.en, a.ar)) +
                  '</span></button>'
                );
              })
              .join('') +
            '</div>'
          : '<p class="dash-muted">' +
            esc(
              t('All available actions are already added.', 'كل الإجراءات المتاحة متضافة بالفعل.')
            ) +
            '</p>');
    }

    body.innerHTML =
      '<h4 class="dash-qa-section">' +
      esc(t('Current shortcuts', 'الاختصارات الحالية')) +
      '</h4>' +
      (rows
        ? '<ol class="dash-qa-rows">' + rows + '</ol>'
        : '<p class="dash-muted">' +
          esc(t('No shortcuts yet. Add one below.', 'مفيش اختصارات. ضيف من تحت.')) +
          '</p>') +
      addSection;
    overlay.hidden = false;
  }

  function paintQuickActions() {
    renderQuickActions(global.document.getElementById('wQuick'));
    refreshQuickHeader();
    var manage = global.document.getElementById('dashQaManage');
    if (manage && !manage.hidden) openQaManage();
    var picker = global.document.getElementById('dashQaPicker');
    if (picker && !picker.hidden) openQaPicker();
  }

  async function persistQuickKeys(nextKeys) {
    var qa = qaApi();
    if (!qa || !qaCanEdit()) return;
    var prev = configuredKeys();
    var next = qa.normalizeKeys(nextKeys).slice(0, qaMax());
    state.quickActionKeys = next;
    state.quickSaving = true;
    paintQuickActions();
    var r = await qa.save(next);
    state.quickSaving = false;
    if (!r.ok) {
      state.quickActionKeys = prev;
      paintQuickActions();
      qaToast(
        r.missingEndpoint
          ? t(
              'Cannot save yet — PUT /api/settings/quick-actions is not on the server.',
              'الحفظ مش متاح دلوقتي — الـ API لسه مش موجود على السيرفر.'
            )
          : r.error || t('Could not save quick actions.', 'مش قادرين نحفظ الإجراءات السريعة.'),
        'err'
      );
      return;
    }
    var picker = global.document.getElementById('dashQaPicker');
    if (picker) picker.hidden = true;
    paintQuickActions();
  }

  async function loadQuickActions() {
    var qa = qaApi();
    if (!qa) {
      state.quickActionKeys = ['new_member', 'checkin', 'new_sale', 'collect_payment'];
      paintQuickActions();
      return;
    }
    state.quickActionKeys = await qa.load();
    paintQuickActions();
  }

  function moveQuickKey(index, delta) {
    var keys = configuredKeys();
    var j = index + delta;
    if (j < 0 || j >= keys.length) return;
    var tmp = keys[index];
    keys[index] = keys[j];
    keys[j] = tmp;
    persistQuickKeys(keys);
  }

  function wireQuickActions() {
    if (wireQuickActions._done) return;
    wireQuickActions._done = true;
    ensureQaModals();
    global.document.addEventListener('click', function (ev) {
      var tEl = ev.target;
      if (!tEl || !tEl.closest) return;
      var addBtn = tEl.closest('[data-qa-add]');
      if (addBtn) {
        ev.preventDefault();
        openQaPicker();
        return;
      }
      var manageBtn = tEl.closest('[data-qa-manage]');
      if (manageBtn) {
        ev.preventDefault();
        openQaManage();
        return;
      }
      var pickBtn = tEl.closest('[data-qa-pick]');
      if (pickBtn) {
        ev.preventDefault();
        persistQuickKeys(configuredKeys().concat([pickBtn.getAttribute('data-qa-pick')]));
        return;
      }
      var removeBtn = tEl.closest('[data-qa-remove]');
      if (removeBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        var rm = removeBtn.getAttribute('data-qa-remove');
        persistQuickKeys(
          configuredKeys().filter(function (k) {
            return k !== rm;
          })
        );
        return;
      }
      var upBtn = tEl.closest('[data-qa-up]');
      if (upBtn) {
        ev.preventDefault();
        moveQuickKey(Number(upBtn.getAttribute('data-qa-up')), -1);
        return;
      }
      var downBtn = tEl.closest('[data-qa-down]');
      if (downBtn) {
        ev.preventDefault();
        moveQuickKey(Number(downBtn.getAttribute('data-qa-down')), 1);
        return;
      }
      var closeBtn = tEl.closest('[data-qa-close]');
      if (closeBtn) {
        ev.preventDefault();
        closeQaModals();
        return;
      }
      if (tEl.classList && tEl.classList.contains('dash-modal-overlay')) {
        closeQaModals();
      }
    });
    global.document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeQaModals();
    });
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
      '<div class="dash-chart-hdr"><span>' +
      esc(t('Last 7 days', 'آخر 7 أيام')) +
      '</span></div>' +
      '<div class="dash-chart-wrap" id="dashAttChartHost">' +
      chartSkeleton() +
      '</div>' +
      linkRow('/dashboard/attendance/', t('View attendance', 'عرض الحضور'));

    paintAttendanceChart();
  }

  function occupancyTone(max, inside, gymActive) {
    if (gymActive === false) return 'inactive';
    if (max == null || max === '') return 'unset';
    var n = Number(inside);
    if (!Number.isFinite(n)) return 'nodata';
    if (n === 0) return 'empty';
    var pct = (n / Number(max)) * 100;
    if (n > Number(max)) return 'over';
    if (pct >= 100) return 'full';
    if (pct >= 80) return 'busy';
    return 'available';
  }

  function occupancyCopy(tone) {
    if (tone === 'inactive' || tone === 'nodata')
      return { cls: 'mute', title: t('Occupancy temporarily unavailable', 'الإشغال غير متاح مؤقتاً') };
    if (tone === 'unset') return { cls: 'mute', title: t('Capacity not configured', 'السعة غير مضبوطة') };
    if (tone === 'empty') return { cls: 'ok', title: t('Gym is Empty', 'الجيم فاضي') };
    if (tone === 'available') return { cls: 'ok', title: t('Gym is Available', 'الجيم متاح') };
    if (tone === 'busy') return { cls: 'busy', title: t('Gym is Getting Busy', 'الجيم بيزحم') };
    if (tone === 'full') return { cls: 'full', title: t('Gym is Full', 'الجيم ممتلئ') };
    return { cls: 'over', title: t('Capacity Exceeded', 'السعة اتجاوزت') };
  }

  function occupancyRing(cls, pct) {
    var C = 301.593;
    var shown = pct == null ? 0 : Math.max(0, Math.min(100, pct));
    var offset = C - (shown / 100) * C;
    var center =
      pct == null
        ? '<div class="occ-pct">—</div><div class="occ-pct-lbl">' + esc(t('No data', 'لا بيانات')) + '</div>'
        : '<div class="occ-pct">' + pct + '<small>%</small></div><div class="occ-pct-lbl">' + esc(t('Occupied', 'مشغول')) + '</div>';
    return (
      '<div class="occ-gauge ' +
      cls +
      '"><svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle class="track" cx="60" cy="60" r="48"></circle>' +
      '<circle class="fill" cx="60" cy="60" r="48" style="stroke-dashoffset:' +
      offset +
      '"></circle></svg>' +
      '<div class="occ-center">' +
      center +
      '</div></div>'
    );
  }

  function renderOccupancy(el) {
    if (!el) return;
    if (!canMembers()) {
      el.innerHTML = '';
      return;
    }
    if (!state.occupancy || state.occupancy.__err) {
      el.innerHTML =
        '<div class="occ-row">' +
        occupancyRing('mute', null) +
        '<div class="occ-copy"><div class="occ-status"><span class="occ-dot mute"></span><strong>' +
        esc(t('Occupancy temporarily unavailable', 'الإشغال غير متاح مؤقتاً')) +
        '</strong></div>' +
        '<p class="dash-muted">' +
        esc(t('Attendance did not load. Do not invent a percentage.', 'الحضور ما تحملش. منغير أرقام وهمية.')) +
        '</p></div></div>';
      return;
    }
    var d = state.occupancy;
    var max = d.maxCapacity != null ? d.maxCapacity : d.MaxCapacity;
    var inside = d.currentlyInside != null ? d.currentlyInside : d.CurrentlyInside;
    var avail = d.available != null ? d.available : d.Available;
    var pct = d.occupancyPercent != null ? d.occupancyPercent : d.OccupancyPercent;
    var gymActive = d.gymActive != null ? d.gymActive : d.GymActive;
    var gymName = d.gymName || d.GymName || '';
    var tone = occupancyTone(max, inside, gymActive);
    var copy = occupancyCopy(tone);
    var gCls = copy.cls === 'ok' ? 'ok' : copy.cls;
    var barCls = tone === 'busy' ? 'busy' : tone === 'full' || tone === 'over' ? tone : '';
    var width = pct == null ? 0 : Math.min(100, Number(pct));

    if (tone === 'unset') {
      el.innerHTML =
        '<div class="occ-row">' +
        occupancyRing('mute', null) +
        '<div class="occ-copy"><div class="occ-status"><span class="occ-dot mute"></span><strong>' +
        esc(copy.title) +
        '</strong></div>' +
        '<p class="dash-muted">' +
        esc(t('Set the maximum people inside so the desk and the Member App can show how full you are.', 'حدد أقصى عدد جوه عشان الديسك والتطبيق يبينوا الزحمة.')) +
        '</p>' +
        linkRow('/dashboard/settings/', t('Configure capacity', 'ضبط السعة')) +
        '</div></div>';
      return;
    }
    if (tone === 'inactive' || tone === 'nodata') {
      el.innerHTML =
        '<div class="occ-row">' +
        occupancyRing('mute', null) +
        '<div class="occ-copy"><div class="occ-status"><span class="occ-dot mute"></span><strong>' +
        esc(copy.title) +
        '</strong></div></div></div>';
      return;
    }

    var meta =
      tone === 'over'
        ? t('Over by', 'زيادة') + ' ' + (Number(inside) - Number(max))
        : avail + ' ' + t('spots available', 'أماكن فاضية');
    el.innerHTML =
      '<div class="occ-row">' +
      occupancyRing(gCls, Number(pct)) +
      '<div class="occ-copy"><div class="occ-status"><span class="occ-dot ' +
      gCls +
      '"></span><strong>' +
      esc(copy.title) +
      '</strong></div>' +
      '<p class="dash-muted">' +
      esc(String(inside)) +
      ' / ' +
      esc(String(max)) +
      ' ' +
      esc(t('currently inside', 'جوه دلوقتي')) +
      (gymName ? ' · ' + esc(gymName) : '') +
      '<br>' +
      esc(String(meta)) +
      '</p>' +
      '<div class="occ-bar ' +
      barCls +
      '"><i style="width:' +
      width +
      '%"></i></div></div></div>';
  }

  async function paintAttendanceChart() {
    var host = global.document.getElementById('dashAttChartHost');
    if (!host) return;

    if (state.attendanceWeek && state.attendanceWeek.__err) {
      host.innerHTML = errBox(null, 'attendance');
      return;
    }

    if (!Array.isArray(state.attendanceWeek)) {
      host.innerHTML = chartSkeleton();
      return;
    }

    if (!state.attendanceWeek.length) {
      host.innerHTML =
        '<p class="dash-muted dash-chart-empty">' +
        esc(t('No check-ins recorded in the last 7 days.', 'مفيش حضور مسجّل في آخر 7 أيام.')) +
        '</p>';
      return;
    }

    host.innerHTML = '<canvas id="dashAttChart" height="120"></canvas>';
    var canvas = global.document.getElementById('dashAttChart');
    if (!canvas) return;

    var ok = await ensureChartJs();
    if (!ok || !global.Chart) {
      host.innerHTML =
        '<p class="dash-muted">' +
        esc(t('Chart library failed to load.', 'مكتبة المخططات فشلت في التحميل.')) +
        '</p>';
      return;
    }
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

  // ── Finance widget (money metrics — not duplicated in Today KPIs) ─
  function renderFinance(el) {
    if (!el) return;
    if (!canFinance()) {
      el.innerHTML = '';
      return;
    }
    var revToday = todayRevenueValue();
    var revMonth = monthRevenueValue();
    var dout = debtorsOutstanding();
    var ref = refundsToday();
    var showOutstanding = dout != null && dout > 0;
    var preview =
      state.debtorsPreview && !state.debtorsPreview.__err
        ? state.debtorsPreview.items || []
        : [];
    var outstandingList = '';
    if (showOutstanding && preview.length) {
      outstandingList =
        '<ul class="dash-list" style="margin-top:10px">' +
        preview
          .slice(0, 5)
          .map(function (d) {
            var id = d.memberId || '';
            var name = d.fullName || t('Member', 'عضو');
            return (
              '<li><a class="dash-list-main" href="/dashboard/members/' +
              encodeURIComponent(id) +
              '/">' +
              esc(name) +
              '</a><span class="dash-list-meta">' +
              esc(money(d.totalDue)) +
              '</span></li>'
            );
          })
          .join('') +
        '</ul>';
    }

    // Prefer today's revenue; fall back to month with clear label (no silent double of Today strip)
    var revLabel =
      revToday != null
        ? t('Revenue today (EGP)', 'إيراد اليوم (ج.م)')
        : t('Revenue this month (EGP)', 'إيراد هذا الشهر (ج.م)');
    var revVal = revToday != null ? revToday : revMonth;

    el.innerHTML =
      '<div class="dash-kpi-row compact">' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(revLabel) +
      '</span><strong>' +
      esc(revVal != null ? money(revVal) : '—') +
      '</strong></div>' +
      '<div class="dash-kpi"><span class="lbl">' +
      esc(t('Refunds today (EGP)', 'مرتجعات اليوم (ج.م)')) +
      '</span><strong>' +
      esc(ref != null ? money(ref) : '—') +
      '</strong></div>' +
      (showOutstanding
        ? '<div class="dash-kpi"><span class="lbl">' +
          esc(t('Outstanding (EGP)', 'مستحقات (ج.م)')) +
          '</span><strong>' +
          esc(money(dout)) +
          '</strong></div>'
        : '') +
      '</div>' +
      outstandingList +
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
      '<div class="dash-chart-wrap" id="dashRevChartHost">' +
      chartSkeleton() +
      '</div>' +
      '<p class="dash-muted" style="margin-top:6px;font-size:11px">' +
      esc(t('Month-by-month totals for the gym.', 'إجمالي كل شهر للنادي.')) +
      '</p>' +
      linkRow('/dashboard/reports/', t('View reports', 'عرض التقارير'));

    var seg = el.querySelector('#revMonthsSeg');
    if (seg) {
      seg.querySelectorAll('[data-months]').forEach(function (btn) {
        btn.onclick = async function () {
          state.revenueMonths = Number(btn.getAttribute('data-months')) || 6;
          var host = global.document.getElementById('dashRevChartHost');
          if (host) host.innerHTML = chartSkeleton();
          await loadRevenueChartData(state.revenueMonths);
          renderFinance(el);
        };
      });
    }
    paintRevenueChart();
  }

  async function paintRevenueChart() {
    var host = global.document.getElementById('dashRevChartHost');
    if (!host) return;

    if (!state.revenueChart) {
      host.innerHTML = chartSkeleton();
      return;
    }

    if (state.revenueChart.__err) {
      host.innerHTML = errBox(
        t('Unable to load revenue chart.', 'مش قادرين نحمّل مخطط الإيراد.'),
        'revenue-chart'
      );
      return;
    }

    var labels = state.revenueChart.labels || [];
    var values = state.revenueChart.values || [];
    if (!labels.length) {
      host.innerHTML =
        '<p class="dash-muted dash-chart-empty">' +
        esc(t('No revenue recorded for this period yet.', 'مفيش إيراد مسجّل للفترة دي لسه.')) +
        '</p>';
      return;
    }

    host.innerHTML = '<canvas id="dashRevChart" height="140"></canvas>';
    var canvas = global.document.getElementById('dashRevChart');
    if (!canvas) return;

    var ok = await ensureChartJs();
    if (!ok || !global.Chart) {
      host.innerHTML =
        '<p class="dash-muted">' +
        esc(t('Chart library failed to load.', 'مكتبة المخططات فشلت في التحميل.')) +
        '</p>';
      return;
    }
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
          var memberHref = e.memberId
            ? '/dashboard/members/' + encodeURIComponent(e.memberId) + '/'
            : '/dashboard/call-sheet/';
          var hintParts = [];
          if (e.planName) hintParts.push(e.planName);
          var ph = phoneHint(e.phoneNumber);
          if (ph) hintParts.push(ph);
          return (
            '<li class="dash-exp-row">' +
            '<div class="dash-exp-main">' +
            '<span class="dash-list-main">' +
            esc(e.fullName || t('Member', 'عضو')) +
            '</span>' +
            (hintParts.length
              ? '<span class="dash-exp-sub">' + esc(hintParts.join(' · ')) + '</span>'
              : '') +
            '</div>' +
            '<span class="dash-list-meta">' +
            esc(expiryPhrase(e.endDate)) +
            '</span>' +
            '<div class="dash-exp-actions">' +
            '<a class="dash-btn primary" href="' +
            esc(memberHref) +
            '">' +
            esc(t('Renew', 'تجديد')) +
            '</a>' +
            '<a class="dash-btn secondary" href="' +
            esc(memberHref) +
            '">' +
            esc(t('View', 'عرض')) +
            '</a>' +
            '</div>' +
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

    // Above the fold: Today + Quick Actions
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

    // Primary follow-ups
    if (canSales()) {
      parts.push(
        widgetShell({
          id: 'expiring',
          icon: 'ti-calendar-event',
          title: t('Memberships Expiring Soon', 'عضويات قاربت تنتهي'),
          bodyId: 'wExpiring',
          span: 12
        })
      );
    }

    if (canMembers()) {
      parts.push(
        widgetShell({
          id: 'occupancy',
          icon: 'ti-users-group',
          title: t('Gym capacity', 'سعة الجيم'),
          sub: t('Live from Attendance In Gym', 'مباشر من حضور الجيم'),
          bodyId: 'wOccupancy',
          span: 6
        })
      );
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

    // Below the fold: Inventory Alerts
    if (canInventory()) {
      parts.push(
        widgetShell({
          id: 'inventory',
          icon: 'ti-package',
          title: t('Inventory Alerts', 'تنبيهات المخزون'),
          bodyId: 'wInventory',
          span: 12,
          body:
            '<div class="dash-muted">' +
            esc(t('Loading inventory…', 'جاري تحميل المخزون…')) +
            '</div>'
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
      } else if (key === 'occupancy') {
        await loadOccupancy();
        renderOccupancy(global.document.getElementById('wOccupancy'));
      } else if (key === 'revenue-chart') {
        await loadRevenueChartData(state.revenueMonths);
        renderFinance(global.document.getElementById('wFinance'));
      } else if (key === 'expiring') {
        try {
          global.sessionStorage.removeItem(CACHE_PREFIX + 'expiring-7');
        } catch (e) { /* ignore */ }
        await loadExpiring();
        renderExpiring(global.document.getElementById('wExpiring'));
      } else if (key === 'inventory') {
        try {
          global.sessionStorage.removeItem(CACHE_PREFIX + 'inv-summary');
        } catch (e) { /* ignore */ }
        await loadInventory();
        renderInventory(global.document.getElementById('wInventory'));
        renderKpis(global.document.getElementById('wKpis'));
      }
      btn.disabled = false;
    });
  }

  function whenIdle(fn) {
    if (typeof global.requestIdleCallback === 'function') {
      global.requestIdleCallback(function () {
        fn();
      }, { timeout: 1200 });
    } else {
      global.setTimeout(fn, 200);
    }
  }

  async function bootWidgets() {
    var host = global.document.getElementById('widgetGrid');
    if (!host) return;

    buildLayout(host);
    wireRetries(host);
    wireQuickActions();
    paintQuickActions();
    loadQuickActions();

    // ── Primary wave (above the fold) ────────────────────────────
    var primary = [];
    if (canFinance()) {
      primary.push(
        loadOverview().then(function () {
          renderKpis(global.document.getElementById('wKpis'));
          renderFinance(global.document.getElementById('wFinance'));
          renderAttendance(global.document.getElementById('wAttendance'));
        })
      );
    } else if (canMembers()) {
      primary.push(
        loadMembersStatus().then(function () {
          renderKpis(global.document.getElementById('wKpis'));
          renderAttendance(global.document.getElementById('wAttendance'));
        })
      );
    }
    if (canMembers()) {
      primary.push(
        loadCheckinsToday().then(function () {
          renderKpis(global.document.getElementById('wKpis'));
          renderAttendance(global.document.getElementById('wAttendance'));
        })
      );
      primary.push(
        loadOccupancy().then(function () {
          renderOccupancy(global.document.getElementById('wOccupancy'));
        })
      );
    }
    if (canSales()) {
      primary.push(
        loadExpiring().then(function () {
          renderExpiring(global.document.getElementById('wExpiring'));
        })
      );
    }

    await Promise.all(
      primary.map(function (p) {
        return p.catch(function () { /* widget-local */ });
      })
    );

    // Members-status only if overview didn't cover active count
    if (canMembers() && canFinance()) {
      await loadMembersStatus().catch(function () {});
      renderKpis(global.document.getElementById('wKpis'));
      renderAttendance(global.document.getElementById('wAttendance'));
    }

    // ── Secondary / below-the-fold (lazy) ─────────────────────────
    whenIdle(function () {
      var secondary = [];
      if (canMembers()) {
        secondary.push(
          loadAttendanceWeek().then(function () {
            paintAttendanceChart();
          })
        );
      }
      if (canFinance()) {
        secondary.push(
          loadRevenueChartData(state.revenueMonths).then(function () {
            paintRevenueChart();
          })
        );
        secondary.push(
          loadDebtors().then(function () {
            renderFinance(global.document.getElementById('wFinance'));
          })
        );
        secondary.push(
          loadZReport().then(function () {
            renderKpis(global.document.getElementById('wKpis'));
            renderFinance(global.document.getElementById('wFinance'));
          })
        );
      }
      if (canInventory()) {
        secondary.push(
          loadInventory().then(function () {
            renderInventory(global.document.getElementById('wInventory'));
            renderKpis(global.document.getElementById('wKpis'));
            if (canFinance()) renderFinance(global.document.getElementById('wFinance'));
          })
        );
      }
      Promise.all(
        secondary.map(function (p) {
          return p.catch(function () {});
        })
      );
    });
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
