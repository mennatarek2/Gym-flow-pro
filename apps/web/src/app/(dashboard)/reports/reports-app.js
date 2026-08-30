(function () {
  'use strict';

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
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

  const user = JSON.parse(
    localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user') || '{}',
  );
  if (!user || !user.role) {
    location.href = '/auth/login/';
    return;
  }
  const role = user.role || '';
  const perms = getPerms();
  const canFinance = perms.has('reports.financial.view') || /Owner|Manager/i.test(role);
  const canMembers = perms.has('members.view') || /Owner|Manager|Trainer|Receptionist/i.test(role);

  const TABS = {
    sales: {
      finance: true,
      title: 'Sales',
      pageTitle: 'Sales Report',
      hint: 'Track sales and revenue performance.',
    },
    refunds: {
      finance: true,
      title: 'Refunds',
      pageTitle: 'Refunds',
      hint: 'Review refunded transactions and their impact.',
    },
    memberships: {
      finance: false,
      title: 'Memberships',
      pageTitle: 'Memberships',
      hint: 'Track new memberships and renewals.',
    },
    products: {
      finance: true,
      title: 'Products',
      pageTitle: 'Products',
      hint: 'See which products are selling and generating revenue.',
    },
    staff: {
      finance: true,
      title: 'Staff & Shifts',
      pageTitle: 'Staff & Shifts',
      hint: 'Review sales and shift activity by staff.',
    },
  };

  const CARDS = [
    {
      key: 'sales',
      icon: 'ti-receipt',
      title: 'Sales',
      desc: 'Money taken in this period, after cash refunds.',
    },
    {
      key: 'refunds',
      icon: 'ti-arrow-back-up',
      title: 'Refunds',
      desc: 'Executed cash and credit refunds. Cancel membership is not a refund.',
    },
    {
      key: 'memberships',
      icon: 'ti-id',
      title: 'Memberships',
      desc: 'New memberships and renewals that started in this period.',
    },
    {
      key: 'products',
      icon: 'ti-shopping-bag',
      title: 'Products',
      desc: 'See which products are selling and generating revenue.',
    },
    {
      key: 'staff',
      icon: 'ti-users',
      title: 'Staff & Shifts',
      desc: 'Who handled the sales and shifts.',
    },
  ];

  const params = new URLSearchParams(location.search);
  let activeTab = params.get('tab') || '';
  if (activeTab && !TABS[activeTab]) activeTab = '';
  if (activeTab && TABS[activeTab].finance && !canFinance) activeTab = canMembers ? 'memberships' : '';

  let methodFilter = params.get('method') || '';
  let staffFilter = params.get('staffId') || '';
  let typeFilter = params.get('type') || '';
  let buyerFilter = params.get('buyer') || '';
  let planFilter = params.get('planId') || '';
  let productFilter = params.get('productId') || '';
  let shiftFilter = params.get('shiftId') || '';
  let catalogMethods = [];
  let lastRows = [];
  let lastKpiRows = [];
  let lastPlanOpts = [];
  let lastProductOpts = [];
  let lastShiftOpts = [];
  let hubSummary = [];
  let rangePreset = 'last7';
  const PAGE_SIZE = 25;
  let tablePage = 1;
  let tableRowHtmls = [];
  let tableHeaders = [];

  const EMPTY = {
    sales: {
      title: 'No sales for this period',
      body: 'No successful payments in this date range. Try another period or take a sale.',
      href: '/dashboard/pos/',
      cta: 'Open Sale',
    },
    refunds: {
      title: 'No refunds for this period',
      body: 'No executed refunds in this date range. Try another period.',
      href: '',
      cta: '',
    },
    memberships: {
      title: 'No membership activity',
      body: 'No memberships started in this period. Try another period or open a member.',
      href: '/dashboard/members/',
      cta: 'Open Members',
    },
    products: {
      title: 'No product sales',
      body: 'No retail products sold in this period. Try another period or take a sale.',
      href: '/dashboard/pos/',
      cta: 'Open Sale',
    },
    staff: {
      title: 'No staff activity',
      body: 'No payments, refunds, or shifts opened in this period. Open Current Shift to start a drawer.',
      href: '/dashboard/shifts/',
      cta: 'Current Shift',
    },
  };

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function parseYmd(s) {
    const p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function fmtShort(s) {
    const d = parseYmd(s);
    if (!d) return s || '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  const today = new Date();
  const fromEl = document.getElementById('dateFrom');
  const toEl = document.getElementById('dateTo');
  if (params.get('from') && params.get('to')) {
    fromEl.value = params.get('from');
    toEl.value = params.get('to');
    rangePreset = 'custom';
  } else {
    const fromD = new Date(today);
    fromD.setDate(fromD.getDate() - 6);
    toEl.value = ymd(today);
    fromEl.value = ymd(fromD);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(n) {
    const x = Number(n) || 0;
    const neg = x < 0;
    const abs = Math.abs(x);
    const whole = abs % 1 === 0;
    const body = abs.toLocaleString('en-EG', {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
    return (neg ? '- ' : '') + 'EGP ' + body;
  }
  function typeLabel(t) {
    return { membership: 'Membership', product: 'Product', mixed: 'Mixed', other: 'Other', unknown: '—' }[t] || t || '—';
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
    el.className = 'toast show ' + (type === 'err' ? 'err' : '');
    el.textContent = msg;
    setTimeout(() => el.classList.remove('show'), 3200);
  }
  function dateRange() {
    return { from: fromEl.value, to: toEl.value };
  }
  function canSee(key) {
    const meta = TABS[key];
    if (!meta) return false;
    return meta.finance ? canFinance : canMembers;
  }

  async function apiGet(path) {
    if (window.GfpApi && window.GfpApi.get) {
      const r = await window.GfpApi.get(path);
      if (r.status === 401) {
        location.href = '/auth/login/';
        return null;
      }
      if (!r.ok) throw { status: r.status, data: r.data };
      return r.data;
    }
    const API_BASE = window.API_BASE || 'https://reach-lullaby-tighten.ngrok-free.dev/api';
    const t = getToken();
    const r = await fetch(API_BASE + path, {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        ...(t ? { Authorization: 'Bearer ' + t } : {}),
      },
    });
    if (r.status === 401) {
      location.href = '/auth/login/';
      return null;
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw { status: r.status, data: e };
    }
    return r.json();
  }

  function setRangeLabel() {
    const { from, to } = dateRange();
    let text = fmtShort(from) + ' – ' + fmtShort(to);
    if (rangePreset === 'last7') text = 'Last 7 days';
    else if (rangePreset === 'last30') text = 'Last 30 days';
    else if (rangePreset === 'thisMonth') text = 'This month';
    document.getElementById('rangeLabel').textContent = text;
    document.querySelectorAll('#rangePop .range-opt').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === rangePreset);
    });
  }

  function applyPreset(preset) {
    const now = new Date();
    rangePreset = preset;
    if (preset === 'last7') {
      const fromD = new Date(now);
      fromD.setDate(fromD.getDate() - 6);
      fromEl.value = ymd(fromD);
      toEl.value = ymd(now);
    } else if (preset === 'last30') {
      const fromD = new Date(now);
      fromD.setDate(fromD.getDate() - 29);
      fromEl.value = ymd(fromD);
      toEl.value = ymd(now);
    } else if (preset === 'thisMonth') {
      fromEl.value = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
      toEl.value = ymd(now);
    }
    setRangeLabel();
  }

  function syncUrl() {
    const url = new URL(location.href);
    const { from, to } = dateRange();
    if (activeTab) url.searchParams.set('tab', activeTab);
    else url.searchParams.delete('tab');
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    if (activeTab === 'sales' && ['membership', 'product', 'mixed'].indexOf(typeFilter) >= 0)
      url.searchParams.set('type', typeFilter);
    else if (activeTab === 'memberships' && ['new', 'renewal'].indexOf(typeFilter) >= 0)
      url.searchParams.set('type', typeFilter);
    else url.searchParams.delete('type');
    if (activeTab === 'refunds' && buyerFilter) url.searchParams.set('buyer', buyerFilter);
    else url.searchParams.delete('buyer');
    if (activeTab === 'sales' || activeTab === 'refunds' || activeTab === 'memberships' || activeTab === 'products' || activeTab === 'staff') {
      if (staffFilter) url.searchParams.set('staffId', staffFilter);
      else url.searchParams.delete('staffId');
    } else {
      url.searchParams.delete('staffId');
    }
    if (activeTab === 'sales' || activeTab === 'refunds' || activeTab === 'products') {
      if (methodFilter) url.searchParams.set('method', methodFilter);
      else url.searchParams.delete('method');
    } else {
      url.searchParams.delete('method');
    }
    if (activeTab === 'memberships' && planFilter) url.searchParams.set('planId', planFilter);
    else url.searchParams.delete('planId');
    if (activeTab === 'products' && productFilter) url.searchParams.set('productId', productFilter);
    else url.searchParams.delete('productId');
    if (activeTab === 'staff' && shiftFilter) url.searchParams.set('shiftId', shiftFilter);
    else url.searchParams.delete('shiftId');
    history.replaceState({}, '', url);
  }

  function setCrumb() {
    const crumb = document.getElementById('crumb');
    const sub = document.getElementById('pageSub');
    const title = document.querySelector('.page-title');
    if (!activeTab) {
      crumb.innerHTML = '<span>Money</span><span class="sep">/</span><span class="current">Reports</span>';
      title.textContent = 'Reports';
      sub.textContent = 'Understand sales, members, products and staff activity.';
      return;
    }
    crumb.innerHTML =
      '<span>Money</span><span class="sep">/</span><a href="/dashboard/reports/">Reports</a><span class="sep">/</span><span class="current">' +
      esc(TABS[activeTab].title) +
      '</span>';
    title.textContent = TABS[activeTab].pageTitle || TABS[activeTab].title;
    sub.textContent = TABS[activeTab].hint;
  }

  function closePops() {
    ['rangePop', 'staffPop', 'methodPop', 'planPop', 'productPop', 'shiftFilterPop', 'morePop'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    ['btnRange', 'btnStaff', 'btnMethod', 'btnPlan', 'btnProduct', 'btnShift', 'btnMore'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-expanded', 'false');
    });
  }

  function setRangeOpen(open) {
    if (open) {
      closePops();
      document.getElementById('rangePop').hidden = false;
      document.getElementById('btnRange').setAttribute('aria-expanded', 'true');
    } else {
      closePops();
    }
  }

  function togglePop(btnId, popId) {
    const pop = document.getElementById(popId);
    const willOpen = pop.hidden;
    closePops();
    if (willOpen) {
      pop.hidden = false;
      document.getElementById(btnId).setAttribute('aria-expanded', 'true');
    }
  }

  function kpi(label, value) {
    return '<div class="kpi"><div class="v">' + value + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  function isMoneyHeader(h) {
    return /amount|sales|refunds|revenue|total|cash|net|gross|difference/i.test(String(h || ''));
  }

  function stampColLabels(sel) {
    const table = document.querySelector(sel);
    if (!table) return;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        td.setAttribute('data-col', headers[i] || '');
      });
    });
  }

  function showDetailError(show) {
    const box = document.getElementById('detailError');
    if (!box) return;
    box.hidden = !show;
    if (show) {
      document.getElementById('detailEmpty').hidden = true;
      document.getElementById('tableWrap').hidden = true;
      document.getElementById('tablePager').hidden = true;
    }
  }

  function showDetailEmpty(show) {
    const box = document.getElementById('detailEmpty');
    box.hidden = !show;
    document.getElementById('tableWrap').hidden = !!show;
    document.getElementById('tablePager').hidden = true;
    if (!show) return;
    const meta = EMPTY[activeTab] || EMPTY.sales;
    document.getElementById('emptyTitle').textContent = meta.title;
    document.getElementById('emptyBody').textContent = meta.body;
    const cta = document.getElementById('emptyCta');
    if (meta.href) {
      cta.hidden = false;
      cta.href = meta.href;
      cta.textContent = meta.cta;
    } else {
      cta.hidden = true;
    }
  }

  function showTableSkeleton(cols) {
    showDetailError(false);
    document.getElementById('detailEmpty').hidden = true;
    document.getElementById('tableWrap').hidden = false;
    document.getElementById('tablePager').hidden = true;
    const n = cols || 6;
    document.getElementById('thead').innerHTML =
      '<tr>' + Array.from({ length: n }, () => '<th><div class="sk-block"></div></th>').join('') + '</tr>';
    document.getElementById('tbody').innerHTML = Array.from({ length: 6 }, () => {
      return '<tr>' + Array.from({ length: n }, () => '<td><div class="sk-block"></div></td>').join('') + '</tr>';
    }).join('');
  }

  function fillKpiSkeleton(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = [0, 1, 2, 3]
      .map(
        () =>
          '<div class="sales-kpi"><div class="l"><div class="sk-block"></div></div><div class="v"><div class="sk-block lg"></div></div></div>',
      )
      .join('');
  }

  function bindRowClicks() {
    document.querySelectorAll('#tbody tr[data-href]').forEach((tr) => {
      tr.onclick = () => {
        location.href = tr.getAttribute('data-href');
      };
    });
    document.querySelectorAll('#tbody a[href]').forEach((a) => {
      a.addEventListener('click', (ev) => ev.stopPropagation());
    });
    document.querySelectorAll('#tbody tr[data-staff]').forEach((tr) => {
      tr.onclick = () => {
        const id = tr.getAttribute('data-staff') || '';
        staffFilter = staffFilter === id ? '' : id;
        closePops();
        loadDetail();
      };
    });
    document.querySelectorAll('#tbody tr[data-shift]').forEach((tr) => {
      tr.onclick = () => {
        const id = tr.getAttribute('data-shift') || '';
        shiftFilter = shiftFilter === id ? '' : id;
        closePops();
        loadDetail();
      };
    });
  }

  function paintPager(total) {
    const el = document.getElementById('tablePager');
    if (!el) return;
    if (total <= PAGE_SIZE) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    const pages = Math.ceil(total / PAGE_SIZE);
    const from = (tablePage - 1) * PAGE_SIZE + 1;
    const to = Math.min(total, tablePage * PAGE_SIZE);
    el.innerHTML =
      '<span class="pager-meta">' +
      from +
      '–' +
      to +
      ' of ' +
      total +
      '</span>' +
      '<button type="button" class="btn secondary" id="pgPrev"' +
      (tablePage <= 1 ? ' disabled' : '') +
      '>Prev</button>' +
      '<button type="button" class="btn secondary" id="pgNext"' +
      (tablePage >= pages ? ' disabled' : '') +
      '>Next</button>';
    document.getElementById('pgPrev').onclick = () => {
      tablePage -= 1;
      paintTablePage();
    };
    document.getElementById('pgNext').onclick = () => {
      tablePage += 1;
      paintTablePage();
    };
  }

  function paintTablePage() {
    document.getElementById('thead').innerHTML =
      '<tr>' +
      tableHeaders
        .map((h) => '<th' + (isMoneyHeader(h) ? ' class="amt"' : '') + '>' + esc(h) + '</th>')
        .join('') +
      '</tr>';
    const total = tableRowHtmls.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    if (tablePage > pages) tablePage = pages;
    const start = (tablePage - 1) * PAGE_SIZE;
    document.getElementById('tbody').innerHTML = tableRowHtmls.slice(start, start + PAGE_SIZE).join('');
    stampColLabels('#tableWrap table');
    bindRowClicks();
    paintPager(total);
  }

  function renderTable(headers, rowsHtml, empty) {
    showDetailError(false);
    tableHeaders = headers || [];
    tableRowHtmls = Array.isArray(rowsHtml) ? rowsHtml : rowsHtml ? [rowsHtml] : [];
    tablePage = 1;
    if (empty) {
      showDetailEmpty(true);
      return;
    }
    showDetailEmpty(false);
    paintTablePage();
  }

  function moreFilterCount() {
    let n = 0;
    if (activeTab === 'sales' && typeFilter) n += 1;
    if (activeTab === 'refunds' && buyerFilter) n += 1;
    if (activeTab === 'memberships') {
      if (typeFilter) n += 1;
      if (planFilter) n += 1;
    }
    if (activeTab === 'products' && productFilter) n += 1;
    if (activeTab === 'staff' && shiftFilter) n += 1;
    return n;
  }

  function paintMoreLabel() {
    const n = moreFilterCount();
    document.getElementById('btnMore').innerHTML =
      (n ? 'More Filters · ' + n : 'More Filters') + ' <i class="ti ti-chevron-down"></i>';
  }

  function methodLabel(m) {
    const map = {
      cash: 'Cash',
      card_paymob: 'Paymob',
      fawry: 'Fawry',
      vodafone: 'Vodafone',
      instapay: 'Instapay',
      account_credit: 'Credit',
      credit: 'Credit',
      gateway: 'Gateway',
    };
    return map[m] || m || '—';
  }

  function paymentCount(data) {
    const methods = data.methods || [];
    if (methods.length) return methods.reduce((s, m) => s + Number(m.count || 0), 0);
    return (data.payments || []).length;
  }

  function setTabChrome() {
    const isSales = activeTab === 'sales';
    const isRefunds = activeTab === 'refunds';
    const isMemberships = activeTab === 'memberships';
    const isProducts = activeTab === 'products';
    const isStaff = activeTab === 'staff';
    const useFilters = isSales || isRefunds || isMemberships || isProducts || isStaff;
    if (isSales && typeFilter && ['membership', 'product', 'mixed'].indexOf(typeFilter) < 0) typeFilter = '';
    if (isMemberships && typeFilter && ['new', 'renewal'].indexOf(typeFilter) < 0) typeFilter = '';
    document.getElementById('hubTabs').hidden = useFilters;
    document.getElementById('tabHint').hidden = useFilters;
    document.getElementById('salesFilters').hidden = !useFilters;
    document.getElementById('methodWrap').hidden = !isSales && !isRefunds && !isProducts;
    document.getElementById('planWrap').hidden = true;
    document.getElementById('productWrap').hidden = true;
    document.getElementById('shiftFilterWrap').hidden = true;
    document.getElementById('moreWrap').hidden = !useFilters;
    document.getElementById('salesBoard').hidden = !isSales;
    document.getElementById('refundsBoard').hidden = !isRefunds;
    document.getElementById('membershipsBoard').hidden = !isMemberships;
    document.getElementById('productsBoard').hidden = !isProducts;
    document.getElementById('staffBoard').hidden = !isStaff;
    document.getElementById('kpiRow').hidden = useFilters;
    document.querySelectorAll('#hubTabs .hub-tab').forEach((btn) => {
      const key = btn.getAttribute('data-tab');
      btn.hidden = !canSee(key);
      btn.classList.toggle('active', key === activeTab);
    });
    if (!useFilters) document.getElementById('tabHint').textContent = (TABS[activeTab] && TABS[activeTab].hint) || '';
    paintMorePop();
    syncUrl();
    setCrumb();
  }

  function paintStaffPop(staff) {
    const pop = document.getElementById('staffPop');
    const items = [{ userId: '', name: 'All staff' }].concat(
      (staff || []).filter((s) => s.userId),
    );
    pop.innerHTML = items
      .map((s) => {
        const id = s.userId || '';
        const act = id === staffFilter ? ' active' : '';
        return (
          '<button type="button" class="range-opt' +
          act +
          '" data-staff="' +
          esc(id) +
          '">' +
          esc(s.name || 'Unassigned') +
          '</button>'
        );
      })
      .join('');
    pop.querySelectorAll('[data-staff]').forEach((btn) => {
      btn.onclick = () => {
        staffFilter = btn.getAttribute('data-staff') || '';
        closePops();
        loadDetail();
      };
    });
    const cur = items.find((s) => (s.userId || '') === staffFilter);
    document.getElementById('staffLabel').textContent = staffFilter ? cur && cur.name ? cur.name : 'Staff' : 'Staff';
  }

  function paintPlanPop(plans) {
    lastPlanOpts = plans || [];
    const pop = document.getElementById('planPop');
    const items = [{ planId: '', name: 'All plans' }].concat(plans || []);
    pop.innerHTML = items
      .map((p) => {
        const id = p.planId || '';
        const act = id === planFilter ? ' active' : '';
        return (
          '<button type="button" class="range-opt' +
          act +
          '" data-plan="' +
          esc(id) +
          '">' +
          esc(p.name || 'Plan') +
          '</button>'
        );
      })
      .join('');
    pop.querySelectorAll('[data-plan]').forEach((btn) => {
      btn.onclick = () => {
        planFilter = btn.getAttribute('data-plan') || '';
        closePops();
        loadDetail();
      };
    });
    const cur = items.find((p) => (p.planId || '') === planFilter);
    document.getElementById('planLabel').textContent = planFilter
      ? cur && cur.name
        ? cur.name
        : 'Plan'
      : 'Plan';
  }

  function paintProductPop(products) {
    lastProductOpts = products || [];
    const pop = document.getElementById('productPop');
    const items = [{ productId: '', name: 'All products' }].concat(products || []);
    pop.innerHTML = items
      .map((p) => {
        const id = p.productId || '';
        const act = id === productFilter ? ' active' : '';
        return (
          '<button type="button" class="range-opt' +
          act +
          '" data-product="' +
          esc(id) +
          '">' +
          esc(p.name || 'Product') +
          '</button>'
        );
      })
      .join('');
    pop.querySelectorAll('[data-product]').forEach((btn) => {
      btn.onclick = () => {
        productFilter = btn.getAttribute('data-product') || '';
        closePops();
        loadDetail();
      };
    });
    const cur = items.find((p) => (p.productId || '') === productFilter);
    document.getElementById('productLabel').textContent = productFilter
      ? cur && cur.name
        ? cur.name
        : 'Product'
      : 'Product';
  }

  function paintShiftPop(shifts) {
    lastShiftOpts = shifts || [];
    const pop = document.getElementById('shiftFilterPop');
    const items = [{ shiftId: '', name: 'All shifts' }].concat(shifts || []);
    pop.innerHTML = items
      .map((s) => {
        const id = s.shiftId || '';
        const act = id === shiftFilter ? ' active' : '';
        return (
          '<button type="button" class="range-opt' +
          act +
          '" data-shift="' +
          esc(id) +
          '">' +
          esc(s.name || 'Shift') +
          '</button>'
        );
      })
      .join('');
    pop.querySelectorAll('[data-shift]').forEach((btn) => {
      btn.onclick = () => {
        shiftFilter = btn.getAttribute('data-shift') || '';
        closePops();
        loadDetail();
      };
    });
    const cur = items.find((s) => (s.shiftId || '') === shiftFilter);
    document.getElementById('shiftLabel').textContent = shiftFilter
      ? cur && cur.name
        ? cur.name
        : 'Shift'
      : 'Shift';
  }

  function paintMethodPop(methods, methodOptions) {
    const pop = document.getElementById('methodPop');
    const used = (methodOptions && methodOptions.length
      ? methodOptions
      : (methods || []).map((m) => m.method)
    ).filter(Boolean);
    if (methodFilter && used.indexOf(methodFilter) < 0) used.unshift(methodFilter);
    const keys = [''].concat(used);
    pop.innerHTML = keys
      .map((m) => {
        const act = m === methodFilter ? ' active' : '';
        return (
          '<button type="button" class="range-opt' +
          act +
          '" data-m="' +
          esc(m) +
          '">' +
          esc(m ? methodLabel(m) : 'All methods') +
          '</button>'
        );
      })
      .join('');
    pop.querySelectorAll('[data-m]').forEach((btn) => {
      btn.onclick = () => {
        methodFilter = btn.getAttribute('data-m') || '';
        closePops();
        loadDetail();
      };
    });
    document.getElementById('methodLabel').textContent = methodFilter
      ? methodLabel(methodFilter)
      : 'Payment';
  }

  function paintMorePop() {
    const pop = document.getElementById('morePop');
    if (activeTab === 'sales') {
      const opts = [
        ['', 'All types'],
        ['membership', 'Membership'],
        ['product', 'Product'],
        ['mixed', 'Mixed'],
      ];
      pop.innerHTML =
        '<p class="range-pop-label">Type</p>' +
        opts
          .map(
            ([v, label]) =>
              '<button type="button" class="range-opt' +
              (v === typeFilter ? ' active' : '') +
              '" data-type="' +
              v +
              '">' +
              label +
              '</button>',
          )
          .join('');
      pop.querySelectorAll('[data-type]').forEach((btn) => {
        btn.onclick = () => {
          typeFilter = btn.getAttribute('data-type') || '';
          closePops();
          loadDetail();
        };
      });
      paintMoreLabel();
      return;
    }
    if (activeTab === 'refunds') {
      const opts = [
        ['', 'Everyone'],
        ['member', 'Members'],
        ['walkin', 'Walk-in'],
      ];
      pop.innerHTML =
        '<p class="range-pop-label">Who</p>' +
        opts
          .map(
            ([v, label]) =>
              '<button type="button" class="range-opt' +
              (v === buyerFilter ? ' active' : '') +
              '" data-buyer="' +
              v +
              '">' +
              label +
              '</button>',
          )
          .join('');
      pop.querySelectorAll('[data-buyer]').forEach((btn) => {
        btn.onclick = () => {
          buyerFilter = btn.getAttribute('data-buyer') || '';
          closePops();
          loadDetail();
        };
      });
      paintMoreLabel();
      return;
    }
    if (activeTab === 'memberships') {
      const opts = [
        ['', 'All types'],
        ['new', 'New'],
        ['renewal', 'Renewals'],
      ];
      const plans = [{ planId: '', name: 'All plans' }].concat(lastPlanOpts);
      pop.innerHTML =
        '<p class="range-pop-label">Type</p>' +
        opts
          .map(
            ([v, label]) =>
              '<button type="button" class="range-opt' +
              (v === typeFilter ? ' active' : '') +
              '" data-type="' +
              v +
              '">' +
              label +
              '</button>',
          )
          .join('') +
        '<p class="range-pop-label">Plan</p>' +
        plans
          .map((p) => {
            const id = p.planId || '';
            return (
              '<button type="button" class="range-opt' +
              (id === planFilter ? ' active' : '') +
              '" data-plan="' +
              esc(id) +
              '">' +
              esc(p.name || 'Plan') +
              '</button>'
            );
          })
          .join('');
      pop.querySelectorAll('[data-type]').forEach((btn) => {
        btn.onclick = () => {
          typeFilter = btn.getAttribute('data-type') || '';
          closePops();
          loadDetail();
        };
      });
      pop.querySelectorAll('[data-plan]').forEach((btn) => {
        btn.onclick = () => {
          planFilter = btn.getAttribute('data-plan') || '';
          closePops();
          loadDetail();
        };
      });
      paintMoreLabel();
      return;
    }
    if (activeTab === 'products') {
      const items = [{ productId: '', name: 'All products' }].concat(lastProductOpts);
      pop.innerHTML =
        '<p class="range-pop-label">Product</p>' +
        items
          .map((p) => {
            const id = p.productId || '';
            return (
              '<button type="button" class="range-opt' +
              (id === productFilter ? ' active' : '') +
              '" data-product="' +
              esc(id) +
              '">' +
              esc(p.name || 'Product') +
              '</button>'
            );
          })
          .join('');
      pop.querySelectorAll('[data-product]').forEach((btn) => {
        btn.onclick = () => {
          productFilter = btn.getAttribute('data-product') || '';
          closePops();
          loadDetail();
        };
      });
      paintMoreLabel();
      return;
    }
    if (activeTab === 'staff') {
      const items = [{ shiftId: '', name: 'All shifts' }].concat(lastShiftOpts);
      pop.innerHTML =
        '<p class="range-pop-label">Shift</p>' +
        items
          .map((s) => {
            const id = s.shiftId || '';
            return (
              '<button type="button" class="range-opt' +
              (id === shiftFilter ? ' active' : '') +
              '" data-shift="' +
              esc(id) +
              '">' +
              esc(s.name || 'Shift') +
              '</button>'
            );
          })
          .join('');
      pop.querySelectorAll('[data-shift]').forEach((btn) => {
        btn.onclick = () => {
          shiftFilter = btn.getAttribute('data-shift') || '';
          closePops();
          loadDetail();
        };
      });
      paintMoreLabel();
      return;
    }
    pop.innerHTML = '';
    paintMoreLabel();
  }

  function paintMoreActive() {
    paintMorePop();
  }

  async function loadSales() {
    const { from, to } = dateRange();
    let q = '/reports/sales?from=' + from + '&to=' + to;
    if (methodFilter) q += '&method=' + encodeURIComponent(methodFilter);
    if (staffFilter) q += '&staffId=' + encodeURIComponent(staffFilter);
    if (typeFilter) q += '&type=' + encodeURIComponent(typeFilter);
    const data = await apiGet(q);
    if (!data) return;

    document.getElementById('rptToolbar').innerHTML = '';
    document.getElementById('kpiRow').innerHTML = '';
    lastKpiRows = [
      ['Net sales', money(data.netCashIn)],
      ['Transactions', String(data.transactionCount || 0)],
      ['Membership sales', money(data.membershipCashIn)],
      ['Product sales', money(data.productCashIn)],
      ['Gross sales', money(data.cashInTotal)],
      ['Refunds', money(data.cashRefundsTotal)],
    ];
    document.getElementById('salesKpis').innerHTML =
      '<div class="sales-kpi"><div class="l">Net sales</div><div class="v">' +
      money(data.netCashIn) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Transactions</div><div class="v">' +
      String(data.transactionCount || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Membership sales</div><div class="v">' +
      money(data.membershipCashIn) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Product sales</div><div class="v">' +
      money(data.productCashIn) +
      '</div></div>';

    const days = data.days || [];
    const max = Math.max.apply(null, days.map((d) => Number(d.cashIn) || 0).concat([0]));
    document.getElementById('salesTrend').innerHTML = days.length
      ? days
          .map((d) => {
            const v = Number(d.cashIn) || 0;
            const h = max > 0 ? Math.max(4, Math.round((v / max) * 116)) : 4;
            return (
              '<div class="sales-bar' +
              (v > 0 ? ' has' : '') +
              '" style="height:' +
              h +
              'px" title="' +
              esc(d.date) +
              ' · ' +
              money(v) +
              '"></div>'
            );
          })
          .join('')
      : '<p class="muted">No days in this range</p>';

    const methodsHtml = (data.methods || [])
      .map(
        (m) =>
          '<div class="break-row"><span>' +
          esc(methodLabel(m.method)) +
          '</span><span>' +
          money(m.cashIn) +
          '</span></div>',
      )
      .join('');
    document.getElementById('salesBreak').innerHTML =
      '<div class="break-row"><span>Gross sales</span><span>' +
      money(data.cashInTotal) +
      '</span></div>' +
      '<div class="break-row break-neg"><span>Refunds</span><span>' +
      money(-(Number(data.cashRefundsTotal) || 0)) +
      '</span></div>' +
      '<div class="break-row"><span>Discounts</span><span>' +
      money(data.discountTotal) +
      '</span></div>' +
      '<div class="break-row"><span>Net sales</span><span>' +
      money(data.netCashIn) +
      '</span></div>' +
      '<p class="break-note">Net = taken in − executed cash refunds. Discounts are already in the amount taken in.</p>' +
      (methodsHtml ? '<div class="break-methods">' + methodsHtml + '</div>' : '');

    paintStaffPop(data.staff);
    paintMethodPop(data.methods, data.methodOptions);
    paintMoreActive();

    const pays = data.payments || [];
    lastRows = pays.length
      ? [['Invoice', 'Member', 'Type', 'Staff', 'Payment', 'Date', 'Amount']].concat(
          pays.map((p) => [
            p.invoiceNumber || '',
            p.memberName,
            typeLabel(p.type),
            p.staffName,
            methodLabel(p.method),
            dt(p.paidAtUtc),
            (Number(p.amount) || 0).toFixed(2),
          ]),
        )
      : [];
    const rows = (data.payments || []).map((p) => {
      const href = p.invoiceId ? '/dashboard/invoices/?invoiceId=' + encodeURIComponent(p.invoiceId) : '';
      return (
        '<tr' +
        (href ? ' data-href="' + href + '"' : '') +
        '><td>' +
        esc(p.invoiceNumber || (href ? 'Invoice' : '—')) +
        '</td><td>' +
        esc(p.memberName) +
        '</td><td>' +
        esc(typeLabel(p.type)) +
        '</td><td>' +
        esc(p.staffName) +
        '</td><td><span class="st">' +
        esc(methodLabel(p.method)) +
        '</span></td><td>' +
        dt(p.paidAtUtc) +
        '</td><td class="amt">' +
        money(p.amount) +
        '</td></tr>'
      );
    });
    renderTable(
      ['Invoice', 'Member', 'Type', 'Staff', 'Payment', 'Date', 'Amount'],
      rows,
      !(data.payments || []).length,
    );
    document.getElementById('truncNote').hidden = !data.paymentsTruncated;
    document.getElementById('truncNote').textContent = data.paymentsTruncated
      ? 'Showing the latest 500 payments. Totals include the full filtered set. Narrow the dates.'
      : '';
  }

  async function loadRefunds() {
    const { from, to } = dateRange();
    let q = '/reports/refunds?from=' + from + '&to=' + to;
    if (methodFilter) q += '&method=' + encodeURIComponent(methodFilter);
    if (staffFilter) q += '&staffId=' + encodeURIComponent(staffFilter);
    if (buyerFilter) q += '&buyer=' + encodeURIComponent(buyerFilter);
    const data = await apiGet(q);
    if (!data) return;

    document.getElementById('rptToolbar').innerHTML = '';
    document.getElementById('kpiRow').innerHTML = '';
    lastKpiRows = [
      ['Total refunds', String(data.count || 0)],
      ['Refund amount', money(data.total)],
      ['Refunded transactions', String(data.saleCount || 0)],
      ['Average refund', money(data.average)],
    ];
    document.getElementById('refundsKpis').innerHTML =
      '<div class="sales-kpi"><div class="l">Total refunds</div><div class="v">' +
      String(data.count || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Refund amount</div><div class="v">' +
      money(data.total) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Refunded transactions</div><div class="v">' +
      String(data.saleCount || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Average refund</div><div class="v">' +
      money(data.average) +
      '</div></div>';

    paintStaffPop(data.staff);
    paintMethodPop(null, data.methodOptions);
    paintMorePop();

    const items = data.items || [];
    lastRows = items.length
      ? [['Refund', 'Original Invoice', 'Member', 'Reason', 'Staff', 'Payment', 'Date', 'Amount']].concat(
          items.map((r) => [
            r.creditNoteNumber || r.id,
            r.originalInvoiceNumber || '',
            r.memberName,
            r.reason || '',
            r.staffName,
            methodLabel(r.method),
            dt(r.executedAtUtc),
            (Number(r.amount) || 0).toFixed(2),
          ]),
        )
      : [];
    const rows = items.map((r) => {
      const origHref = r.originalInvoiceId
        ? '/dashboard/invoices/?invoiceId=' + encodeURIComponent(r.originalInvoiceId)
        : '';
      const cnHref = r.creditNoteId
        ? '/dashboard/invoices/?invoiceId=' + encodeURIComponent(r.creditNoteId)
        : origHref;
      const memHref = r.memberId ? '/dashboard/members/' + r.memberId + '/' : '';
      const refundLabel = r.creditNoteNumber || String(r.id || '').slice(0, 8);
      const invLabel = r.originalInvoiceNumber || (origHref ? 'Invoice' : '—');
      return (
        '<tr' +
        (origHref
          ? ' data-href="' + origHref + '"'
          : cnHref
            ? ' data-href="' + cnHref + '"'
            : memHref
              ? ' data-href="' + memHref + '"'
              : '') +
        '><td>' +
        (cnHref ? '<a href="' + cnHref + '">' + esc(refundLabel) + '</a>' : esc(refundLabel)) +
        '</td><td>' +
        (origHref ? '<a href="' + origHref + '">' + esc(invLabel) + '</a>' : esc(invLabel)) +
        '</td><td>' +
        (memHref ? '<a href="' + memHref + '">' + esc(r.memberName) + '</a>' : esc(r.memberName)) +
        '</td><td>' +
        esc(r.reason || '—') +
        '</td><td>' +
        esc(r.staffName) +
        '</td><td><span class="st">' +
        esc(methodLabel(r.method)) +
        '</span></td><td>' +
        dt(r.executedAtUtc) +
        '</td><td class="amt">' +
        money(r.amount) +
        '</td></tr>'
      );
    });
    renderTable(
      ['Refund', 'Original Invoice', 'Member', 'Reason', 'Staff', 'Payment', 'Date', 'Amount'],
      rows,
      !items.length,
    );
    document.getElementById('truncNote').hidden = !data.truncated;
    document.getElementById('truncNote').textContent = data.truncated
      ? 'Showing the latest 500 refunds. Totals include the full filtered set. Narrow the dates.'
      : '';
  }

  function membershipTypeLabel(t) {
    return t === 'renewal' ? 'Renewal' : t === 'new' ? 'New' : t || '—';
  }
  function membershipStatusLabel(s) {
    const map = {
      active: 'Active',
      pending: 'Pending',
      cancelled: 'Cancelled',
      expired: 'Expired',
      frozen: 'Frozen',
      scheduled: 'Scheduled',
      refunded: 'Refunded',
    };
    return map[s] || s || '—';
  }

  async function loadMemberships() {
    const { from, to } = dateRange();
    let q = '/reports/memberships?from=' + from + '&to=' + to;
    if (planFilter) q += '&planId=' + encodeURIComponent(planFilter);
    if (staffFilter) q += '&staffId=' + encodeURIComponent(staffFilter);
    if (typeFilter) q += '&type=' + encodeURIComponent(typeFilter);
    const data = await apiGet(q);
    if (!data) return;

    document.getElementById('rptToolbar').innerHTML = '';
    document.getElementById('kpiRow').innerHTML = '';
    const rev = canFinance ? money(data.revenue) : '—';
    lastKpiRows = [
      ['New Memberships', String(data.newCount || 0)],
      ['Renewals', String(data.renewalCount || 0)],
      ['Membership Revenue', rev],
      ['Refunded Memberships', String(data.refundedCount || 0)],
    ];
    document.getElementById('membershipsKpis').innerHTML =
      '<div class="sales-kpi"><div class="l">New Memberships</div><div class="v">' +
      String(data.newCount || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Renewals</div><div class="v">' +
      String(data.renewalCount || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Membership Revenue</div><div class="v">' +
      rev +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Refunded Memberships</div><div class="v">' +
      String(data.refundedCount || 0) +
      '</div></div>';

    document.getElementById('membershipsBreak').innerHTML =
      '<div class="break-row"><span>New</span><span>' +
      String(data.newCount || 0) +
      '</span></div>' +
      '<div class="break-row"><span>Renewals</span><span>' +
      String(data.renewalCount || 0) +
      '</span></div>';

    const byPlan = data.byPlan || [];
    document.getElementById('membershipsPlanPanel').hidden = !byPlan.length;
    document.getElementById('membershipsByPlan').innerHTML = byPlan
      .map((p) => {
        const n = Number(p.newCount || 0);
        const r = Number(p.renewalCount || 0);
        const extra = canFinance ? ' · ' + money(p.revenue) : '';
        return (
          '<div class="break-row"><span>' +
          esc(p.planName) +
          '</span><span>' +
          n +
          ' new · ' +
          r +
          ' renewals' +
          extra +
          '</span></div>'
        );
      })
      .join('');

    paintStaffPop(data.staff);
    paintPlanPop(data.plans);
    paintMoreActive();

    const items = data.startedRows || [];
    const headers = canFinance
      ? ['Date', 'Member', 'Plan', 'Type', 'Staff', 'Invoice', 'Amount', 'Status']
      : ['Date', 'Member', 'Plan', 'Type', 'Staff', 'Status'];
    lastRows = items.length
      ? [headers].concat(
          items.map((r) =>
            canFinance
              ? [
                  r.startDate,
                  r.memberName,
                  r.planName,
                  membershipTypeLabel(r.type),
                  r.staffName,
                  r.invoiceNumber || '',
                  (Number(r.amount) || 0).toFixed(2),
                  membershipStatusLabel(r.status),
                ]
              : [
                  r.startDate,
                  r.memberName,
                  r.planName,
                  membershipTypeLabel(r.type),
                  r.staffName,
                  membershipStatusLabel(r.status),
                ],
          ),
        )
      : [];
    const rows = items.map((r) => {
      const memHref = r.memberId ? '/dashboard/members/' + r.memberId + '/' : '';
      const invHref = r.invoiceId
        ? '/dashboard/invoices/?invoiceId=' + encodeURIComponent(r.invoiceId)
        : '';
      const href = invHref || memHref;
      const invLabel = r.invoiceNumber || (invHref ? 'Invoice' : '—');
      const moneyCell = canFinance
        ? '<td>' +
          (invHref ? '<a href="' + invHref + '">' + esc(invLabel) + '</a>' : esc(invLabel)) +
          '</td><td class="amt">' +
          money(r.amount) +
          '</td>'
        : '';
      return (
        '<tr' +
        (href ? ' data-href="' + href + '"' : '') +
        '><td>' +
        esc(r.startDate) +
        '</td><td>' +
        (memHref ? '<a href="' + memHref + '">' + esc(r.memberName) + '</a>' : esc(r.memberName)) +
        '</td><td>' +
        esc(r.planName) +
        '</td><td>' +
        esc(membershipTypeLabel(r.type)) +
        '</td><td>' +
        esc(r.staffName) +
        '</td>' +
        moneyCell +
        '<td><span class="st">' +
        esc(membershipStatusLabel(r.status)) +
        '</span></td></tr>'
      );
    });
    renderTable(headers, rows, !items.length);
    document.getElementById('truncNote').hidden = !data.truncated;
    document.getElementById('truncNote').textContent = data.truncated
      ? 'Showing the latest 500 memberships. Totals include the full filtered set. Narrow the dates.'
      : '';
  }

  async function loadProducts() {
    const { from, to } = dateRange();
    let q = '/reports/products?from=' + from + '&to=' + to;
    if (productFilter) q += '&productId=' + encodeURIComponent(productFilter);
    if (staffFilter) q += '&staffId=' + encodeURIComponent(staffFilter);
    if (methodFilter) q += '&method=' + encodeURIComponent(methodFilter);
    const data = await apiGet(q);
    if (!data) return;

    document.getElementById('rptToolbar').innerHTML = '';
    document.getElementById('kpiRow').innerHTML = '';
    catalogMethods = data.methodOptions || [];
    lastKpiRows = [
      ['Product Revenue', money(data.revenue)],
      ['Units Sold', String(data.unitsSold || 0)],
      ['Transactions', String(data.transactionCount || 0)],
      ['Top Product', data.topProductName || '—'],
    ];
    document.getElementById('productsKpis').innerHTML =
      '<div class="sales-kpi"><div class="l">Product Revenue</div><div class="v">' +
      money(data.revenue) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Units Sold</div><div class="v">' +
      String(data.unitsSold || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Transactions</div><div class="v">' +
      String(data.transactionCount || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Top Product</div><div class="v">' +
      esc(data.topProductName || '—') +
      '</div></div>';

    const ranked = data.topProducts || [];
    document.getElementById('productsRankPanel').hidden = !ranked.length;
    document.getElementById('productsRankBody').innerHTML = ranked
      .map(
        (r) =>
          '<tr><td>' +
          esc(r.name) +
          '</td><td>' +
          esc(r.unitsSold) +
          '</td><td class="amt">' +
          money(r.revenue) +
          '</td></tr>',
      )
      .join('');
    stampColLabels('#productsRankPanel table');

    paintStaffPop(data.staff);
    paintProductPop(data.products);
    paintMethodPop(null, data.methodOptions);
    paintMoreActive();

    const items = data.lines || [];
    const headers = ['Date', 'Invoice', 'Product', 'Quantity', 'Staff', 'Payment', 'Revenue'];
    lastRows = items.length
      ? [headers].concat(
          items.map((r) => [
            dt(r.soldAtUtc),
            r.invoiceNumber || '',
            r.productName,
            r.quantity,
            r.staffName,
            methodLabel(r.payment),
            (Number(r.revenue) || 0).toFixed(2),
          ]),
        )
      : [];
    const rows = items.map((r) => {
      const href = r.invoiceId
        ? '/dashboard/invoices/?invoiceId=' + encodeURIComponent(r.invoiceId)
        : '';
      const invLabel = r.invoiceNumber || (href ? 'Invoice' : '—');
      return (
        '<tr' +
        (href ? ' data-href="' + href + '"' : '') +
        '><td>' +
        dt(r.soldAtUtc) +
        '</td><td>' +
        (href ? '<a href="' + href + '">' + esc(invLabel) + '</a>' : esc(invLabel)) +
        '</td><td>' +
        esc(r.productName) +
        '</td><td>' +
        esc(r.quantity) +
        '</td><td>' +
        esc(r.staffName) +
        '</td><td><span class="st">' +
        esc(methodLabel(r.payment)) +
        '</span></td><td class="amt">' +
        money(r.revenue) +
        '</td></tr>'
      );
    });
    renderTable(headers, rows, !items.length);
    document.getElementById('truncNote').hidden = !data.truncated;
    document.getElementById('truncNote').textContent = data.truncated
      ? 'Showing the latest 500 product lines. Totals include the full filtered set. Narrow the dates.'
      : '';
  }

  async function loadStaff() {
    const { from, to } = dateRange();
    let q = '/reports/staff-shifts?from=' + from + '&to=' + to;
    if (staffFilter) q += '&staffId=' + encodeURIComponent(staffFilter);
    if (shiftFilter) q += '&shiftId=' + encodeURIComponent(shiftFilter);
    const data = await apiGet(q);
    if (!data) return;

    document.getElementById('rptToolbar').innerHTML = '';
    document.getElementById('kpiRow').innerHTML = '';
    lastKpiRows = [
      ['Total Sales', money(data.sales)],
      ['Transactions', String(data.transactionCount || 0)],
      ['Refunds', money(data.refunds)],
      ['Shifts', String(data.shiftCount || 0)],
    ];
    document.getElementById('staffKpis').innerHTML =
      '<div class="sales-kpi"><div class="l">Total Sales</div><div class="v">' +
      money(data.sales) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Transactions</div><div class="v">' +
      String(data.transactionCount || 0) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Refunds</div><div class="v">' +
      money(data.refunds) +
      '</div></div>' +
      '<div class="sales-kpi"><div class="l">Shifts</div><div class="v">' +
      String(data.shiftCount || 0) +
      '</div></div>';

    paintStaffPop(data.staffOptions);
    paintShiftPop(data.shiftOptions);
    paintMoreActive();

    const staff = data.staffCashIn || [];
    const shifts = data.shifts || [];
    const txs = data.transactions || [];
    const shiftOpts = data.shiftOptions || [];
    function shiftName(s) {
      const opt = shiftOpts.find((o) => (o.shiftId || '') === (s.shiftId || ''));
      return (opt && opt.name) || dt(s.openedAt);
    }
    const headers = ['Staff', 'Sales', 'Transactions', 'Refunds', 'Shifts'];
    lastRows = [headers].concat(
      staff.map((r) => [
        r.staffName,
        (Number(r.cashIn) || 0).toFixed(2),
        r.paymentCount,
        (Number(r.refunds) || 0).toFixed(2),
        r.shiftCount,
      ]),
    );
    if (shifts.length) {
      lastRows.push([]);
      lastRows.push(['Shift', 'Staff', 'Opened', 'Closed', 'Sales', 'Refunds', 'Status']);
      shifts.forEach((s) => {
        lastRows.push([
          shiftName(s),
          s.staffName,
          dt(s.openedAt),
          s.closedAt ? dt(s.closedAt) : 'Open',
          (Number(s.sales) || 0).toFixed(2),
          (Number(s.refunds) || 0).toFixed(2),
          s.status,
        ]);
      });
    }
    const staffRows = staff.map((r) => {
      const id = r.userId || '';
      return (
        '<tr data-staff="' +
        esc(id) +
        '"><td>' +
        esc(r.staffName) +
        '</td><td class="amt">' +
        money(r.cashIn) +
        '</td><td>' +
        esc(r.paymentCount) +
        '</td><td class="amt">' +
        money(r.refunds) +
        '</td><td>' +
        esc(r.shiftCount) +
        '</td></tr>'
      );
    });
    const empty = !staff.length && !shifts.length;
    renderTable(headers, staffRows, empty);

    const wrap = document.getElementById('shiftWrap');
    wrap.hidden = empty || !shifts.length;
    if (!wrap.hidden) {
      document.getElementById('shiftBody').innerHTML = shifts
        .map((s) => {
          const st = s.status === 'open' ? 'Open' : s.status === 'approved' ? 'Approved' : 'Closed';
          return (
            '<tr data-shift="' +
            esc(s.shiftId) +
            '"><td>' +
            esc(shiftName(s)) +
            '</td><td>' +
            esc(s.staffName) +
            '</td><td>' +
            dt(s.openedAt) +
            '</td><td>' +
            (s.closedAt ? dt(s.closedAt) : 'Open') +
            '</td><td class="amt">' +
            money(s.sales) +
            '</td><td class="amt">' +
            money(s.refunds) +
            '</td><td><span class="st">' +
            esc(st) +
            '</span></td></tr>'
          );
        })
        .join('');
      stampColLabels('#shiftWrap table');
      document.querySelectorAll('#shiftBody tr[data-shift]').forEach((tr) => {
        tr.onclick = () => {
          const id = tr.getAttribute('data-shift') || '';
          shiftFilter = shiftFilter === id ? '' : id;
          closePops();
          loadDetail();
        };
      });
    }

    const txWrap = document.getElementById('txWrap');
    const showTx = !empty && (staffFilter || shiftFilter) && txs.length;
    txWrap.hidden = !showTx;
    if (showTx) {
      document.getElementById('txBody').innerHTML = txs
        .map((t) => {
          const href = t.invoiceId
            ? '/dashboard/invoices/?invoiceId=' + encodeURIComponent(t.invoiceId)
            : '';
          const invLabel = t.invoiceNumber || (href ? 'Invoice' : '—');
          const kind = t.type === 'refund' ? 'Refund' : 'Sale';
          return (
            '<tr' +
            (href ? ' data-href="' + href + '"' : '') +
            '><td>' +
            dt(t.atUtc) +
            '</td><td>' +
            esc(kind) +
            '</td><td>' +
            (href ? '<a href="' + href + '">' + esc(invLabel) + '</a>' : esc(invLabel)) +
            '</td><td>' +
            esc(t.staffName) +
            '</td><td><span class="st">' +
            esc(methodLabel(t.method)) +
            '</span></td><td class="amt">' +
            money(t.amount) +
            '</td></tr>'
          );
        })
        .join('');
      stampColLabels('#txWrap table');
      document.querySelectorAll('#txBody tr[data-href]').forEach((tr) => {
        tr.onclick = () => {
          location.href = tr.getAttribute('data-href');
        };
      });
      document.querySelectorAll('#txBody a[href]').forEach((a) => {
        a.addEventListener('click', (ev) => ev.stopPropagation());
      });
    }
    document.getElementById('truncNote').hidden = !data.truncated;
    document.getElementById('truncNote').textContent = data.truncated
      ? 'Showing the latest 500 transactions. Totals include the full filtered set.'
      : '';
  }

  function errText() {
    return "We couldn't load this report.";
  }

  function cardHtml(def, state) {
    const loading = state.cls === 'is-load';
    const a = loading ? '<div class="sk-block"></div>' : state.a || '—';
    const b = loading ? '<div class="sk-block"></div>' : state.b || '—';
    return (
      '<button type="button" class="rpt-card' +
      (state.cls ? ' ' + state.cls : '') +
      '" data-tab="' +
      def.key +
      '">' +
      '<div class="rpt-card-ico"><i class="ti ' +
      def.icon +
      '"></i></div>' +
      '<h2>' +
      esc(def.title) +
      '</h2>' +
      '<dl><div><dt>' +
      esc(state.la) +
      '</dt><dd>' +
      a +
      '</dd></div><div><dt>' +
      esc(state.lb) +
      '</dt><dd>' +
      b +
      '</dd></div></dl>' +
      '<p class="rpt-card-desc">' +
      esc(state.desc || def.desc) +
      '</p>' +
      '<span class="rpt-card-go">View Report →</span>' +
      '</button>'
    );
  }

  function bindCards() {
    document.querySelectorAll('#cardGrid .rpt-card').forEach((btn) => {
      btn.onclick = () => openReport(btn.getAttribute('data-tab'));
    });
  }

  function paintCards(states) {
    const html = CARDS.filter((c) => canSee(c.key))
      .map((c) => cardHtml(c, states[c.key] || { la: '…', lb: '…', cls: 'is-load' }))
      .join('');
    document.getElementById('cardGrid').innerHTML = html;
    bindCards();
  }

  function summarizeCard(key, data) {
    if (key === 'sales') {
      const n = data.transactionCount != null ? data.transactionCount : paymentCount(data);
      return {
        la: 'Net sales',
        a: esc(money(data.netCashIn)),
        lb: 'Transactions',
        b: String(n),
        activity: n > 0 || Number(data.netCashIn) !== 0 || Number(data.bookedTotal) !== 0,
        export: ['Sales', money(data.netCashIn), String(n)],
      };
    }
    if (key === 'refunds') {
      const n = data.count != null ? data.count : (data.items || []).length;
      return {
        la: 'Refund amount',
        a: esc(money(data.total)),
        lb: 'Refunds',
        b: data.truncated ? String(n) + '+' : String(n),
        activity: n > 0 || Number(data.total) !== 0,
        export: ['Refunds', money(data.total), String(n)],
      };
    }
    if (key === 'memberships') {
      return {
        la: 'New',
        a: String(data.newCount != null ? data.newCount : data.started || 0),
        lb: 'Renewals',
        b: String(data.renewalCount || 0),
        activity: Number(data.newCount || data.started) > 0 || Number(data.renewalCount) > 0,
        export: ['Memberships', String(data.newCount || 0), String(data.renewalCount || 0)],
      };
    }
    if (key === 'products') {
      const qty = data.unitsSold != null ? Number(data.unitsSold) : 0;
      const rev = Number(data.revenue) || 0;
      return {
        la: 'Product revenue',
        a: esc(money(rev)),
        lb: 'Units sold',
        b: String(qty),
        activity: qty > 0 || rev !== 0,
        export: ['Products', money(rev), String(qty)],
      };
    }
    const take = data.sales != null ? Number(data.sales) : (data.staffCashIn || []).reduce((s, r) => s + Number(r.cashIn || 0), 0);
    const shifts = data.shiftCount != null ? data.shiftCount : (data.shifts || []).length;
    return {
      la: 'Total sales',
      a: esc(money(take)),
      lb: 'Shifts',
      b: String(shifts),
      activity: take !== 0 || Number(data.refunds) > 0 || shifts > 0 || (data.staffCashIn || []).length > 0,
      export: ['Staff & Shifts', money(take), String(shifts)],
    };
  }

  async function loadHub() {
    document.getElementById('viewHub').hidden = false;
    document.getElementById('viewDetail').hidden = true;
    document.getElementById('emptyState').hidden = true;
    document.getElementById('cardGrid').hidden = false;
    document.getElementById('salesFilters').hidden = true;
    document.getElementById('salesBoard').hidden = true;
    document.getElementById('refundsBoard').hidden = true;
    document.getElementById('membershipsBoard').hidden = true;
    document.getElementById('productsBoard').hidden = true;
    document.getElementById('staffBoard').hidden = true;
    document.getElementById('txWrap').hidden = true;
    lastRows = [];
    lastKpiRows = [];
    hubSummary = [];
    setCrumb();
    syncUrl();
    const visible = CARDS.filter((c) => canSee(c.key));
    const loading = {};
    visible.forEach((c) => {
      loading[c.key] = {
        la: c.key === 'sales' ? 'Net sales' : c.key === 'refunds' ? 'Refund amount' : c.key === 'memberships' ? 'New' : c.key === 'products' ? 'Product revenue' : 'Total sales',
        lb: c.key === 'sales' ? 'Transactions' : c.key === 'refunds' ? 'Refunds' : c.key === 'memberships' ? 'Renewals' : c.key === 'products' ? 'Units sold' : 'Shifts',
        a: '…',
        b: '…',
        cls: 'is-load',
      };
    });
    paintCards(loading);

    const { from, to } = dateRange();
    const q = '?from=' + from + '&to=' + to;
    const paths = {
      sales: '/reports/sales' + q,
      refunds: '/reports/refunds' + q,
      memberships: '/reports/memberships' + q,
      products: '/reports/products' + q,
      staff: '/reports/staff-shifts' + q,
    };
    const states = { ...loading };
    let anyActivity = false;
    let anyOk = false;
    await Promise.all(
      visible.map(async (c) => {
        try {
          const data = await apiGet(paths[c.key]);
          if (!data) return;
          const s = summarizeCard(c.key, data);
          states[c.key] = s;
          if (s.activity) anyActivity = true;
          anyOk = true;
          if (s.export) hubSummary.push(s.export);
        } catch (e) {
          states[c.key] = {
            la: loading[c.key].la,
            lb: loading[c.key].lb,
            a: '—',
            b: '—',
            cls: 'is-err',
            desc: errText(e),
          };
        }
      }),
    );
    paintCards(states);
    const showEmpty = anyOk && !anyActivity;
    document.getElementById('emptyState').hidden = !showEmpty;
    document.getElementById('cardGrid').hidden = showEmpty;
  }

  async function loadDetail() {
    if (!activeTab || !canSee(activeTab)) {
      activeTab = '';
      await loadHub();
      return;
    }
    document.getElementById('viewHub').hidden = true;
    document.getElementById('viewDetail').hidden = false;
    document.getElementById('shiftWrap').hidden = true;
    document.getElementById('txWrap').hidden = true;
    document.getElementById('detailEmpty').hidden = true;
    document.getElementById('detailError').hidden = true;
    document.getElementById('tableWrap').hidden = false;
    lastRows = [];
    lastKpiRows = [];
    setTabChrome();
    showTableSkeleton(activeTab === 'staff' ? 5 : 7);
    if (activeTab === 'sales') fillKpiSkeleton('salesKpis');
    else if (activeTab === 'refunds') fillKpiSkeleton('refundsKpis');
    else if (activeTab === 'memberships') fillKpiSkeleton('membershipsKpis');
    else if (activeTab === 'products') fillKpiSkeleton('productsKpis');
    else fillKpiSkeleton('staffKpis');
    try {
      if (activeTab === 'sales') await loadSales();
      else if (activeTab === 'refunds') await loadRefunds();
      else if (activeTab === 'memberships') await loadMemberships();
      else if (activeTab === 'products') await loadProducts();
      else await loadStaff();
    } catch (e) {
      document.getElementById('kpiRow').innerHTML = '';
      document.getElementById('rptToolbar').innerHTML = '';
      showDetailError(true);
    }
  }

  function openReport(key) {
    if (!canSee(key)) return;
    activeTab = key;
    loadDetail();
  }

  function goHub() {
    activeTab = '';
    loadHub();
  }

  document.querySelectorAll('#hubTabs .hub-tab').forEach((btn) => {
    btn.onclick = () => openReport(btn.getAttribute('data-tab'));
  });
  document.getElementById('btnBack').onclick = goHub;
  document.getElementById('crumb').addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    goHub();
  });

  document.getElementById('btnRange').onclick = () => {
    setRangeOpen(document.getElementById('rangePop').hidden);
  };
  document.querySelectorAll('#rangePop .range-opt').forEach((btn) => {
    btn.onclick = () => {
      applyPreset(btn.getAttribute('data-preset'));
      setRangeOpen(false);
      if (activeTab) loadDetail();
      else loadHub();
    };
  });
  document.getElementById('btnStaff').onclick = (ev) => {
    ev.stopPropagation();
    togglePop('btnStaff', 'staffPop');
  };
  document.getElementById('btnMethod').onclick = (ev) => {
    ev.stopPropagation();
    togglePop('btnMethod', 'methodPop');
  };
  document.getElementById('btnPlan').onclick = (ev) => {
    ev.stopPropagation();
    togglePop('btnPlan', 'planPop');
  };
  document.getElementById('btnProduct').onclick = (ev) => {
    ev.stopPropagation();
    togglePop('btnProduct', 'productPop');
  };
  document.getElementById('btnShift').onclick = (ev) => {
    ev.stopPropagation();
    togglePop('btnShift', 'shiftFilterPop');
  };
  document.getElementById('btnMore').onclick = (ev) => {
    ev.stopPropagation();
    togglePop('btnMore', 'morePop');
  };
  document.getElementById('btnApply').onclick = () => {
    rangePreset = 'custom';
    setRangeLabel();
    setRangeOpen(false);
    if (activeTab) loadDetail();
    else loadHub();
  };
  function openRange(ev) {
    if (ev) ev.stopPropagation();
    setRangeOpen(true);
  }
  document.getElementById('btnChangeDate').onclick = openRange;
  document.getElementById('btnChangeDateDetail').onclick = openRange;
  document.getElementById('btnRetry').onclick = () => {
    if (activeTab) loadDetail();
  };
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('.range-wrap')) return;
    closePops();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closePops();
  });

  function exportMeta() {
    const { from, to } = dateRange();
    const tab = activeTab ? TABS[activeTab] : null;
    const rows = [
      ['Report', tab ? tab.pageTitle || tab.title : 'Reports summary'],
      ['From', from],
      ['To', to],
    ];
    if (!activeTab) return rows;
    rows.push(['Staff', staffFilter ? document.getElementById('staffLabel').textContent : 'All staff']);
    if (activeTab === 'sales' || activeTab === 'refunds' || activeTab === 'products') {
      rows.push(['Payment', methodFilter ? methodLabel(methodFilter) : 'All methods']);
    }
    if (activeTab === 'sales' && typeFilter) rows.push(['Type', typeLabel(typeFilter)]);
    if (activeTab === 'refunds' && buyerFilter)
      rows.push(['Buyer', buyerFilter === 'walkin' ? 'Walk-in' : 'Members']);
    if (activeTab === 'memberships') {
      if (typeFilter) rows.push(['Type', typeFilter === 'renewal' ? 'Renewals' : 'New']);
      if (planFilter) rows.push(['Plan', document.getElementById('planLabel').textContent]);
    }
    if (activeTab === 'products' && productFilter)
      rows.push(['Product', document.getElementById('productLabel').textContent]);
    if (activeTab === 'staff' && shiftFilter)
      rows.push(['Shift', document.getElementById('shiftLabel').textContent]);
    return rows;
  }

  document.getElementById('btnExport').onclick = function () {
    let rows;
    if (activeTab) {
      rows = exportMeta()
        .concat([[]])
        .concat(lastKpiRows.length ? lastKpiRows.concat([[]]) : [])
        .concat(lastRows);
    } else {
      const { from, to } = dateRange();
      rows = [['Report', 'Reports summary'], ['From', from], ['To', to], []].concat(hubSummary);
    }
    if (!rows.length || (activeTab && !lastKpiRows.length && !lastRows.length && !hubSummary.length)) {
      toast('Nothing to export', 'err');
      return;
    }
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = activeTab ? 'report-' + activeTab + '.csv' : 'reports-summary.csv';
    a.click();
    toast('CSV exported');
  };

  setRangeLabel();
  if (activeTab) loadDetail();
  else loadHub();
})();
