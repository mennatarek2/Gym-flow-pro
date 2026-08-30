/**
 * GymFlowPro — sidebar/topbar shell (Prompt 2B).
 * Consumes useVisibleNav(): grouped collapsible categories, RTL-aware, active route,
 * claim-driven default landing, empty-nav friendly state.
 */
(function (global) {
  'use strict';

  var COLLAPSE_KEY = 'gfp_nav_collapse_v1';
  var lastRegistry = null;
  var bootDone = false;
  /** @type {Record<string, boolean>} categoryKey → collapsed */
  var collapsedState = loadCollapseState();

  function navApi() {
    return global.GfpNav || null;
  }

  function getNavItems() {
    var Nav = navApi();
    return (Nav && Nav.NAV_ITEMS) || [];
  }

  function loadCollapseState() {
    try {
      var raw = global.sessionStorage.getItem(COLLAPSE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveCollapseState() {
    try {
      global.sessionStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedState));
    } catch (e) { /* ignore */ }
  }

  function isCollapsed(key) {
    return !!collapsedState[key];
  }

  function setCollapsed(key, value) {
    if (value) collapsedState[key] = true;
    else delete collapsedState[key];
    saveCollapseState();
  }

  function normalizePath(href) {
    try {
      var u = new URL(href, global.location.origin);
      var p = u.pathname.replace(/\/+$/, '') || '/';
      return p.endsWith('/') ? p : p + '/';
    } catch (e) {
      return String(href || '');
    }
  }

  function findNavConfig(pathname) {
    var p = normalizePath(pathname);
    // Stock Management hub owns legacy On Hand / Move / Count + Buy/Fix deep links
    var stockHubRoots = [
      '/dashboard/inventory/stock-management/',
      '/dashboard/inventory/stock/',
      '/dashboard/inventory/transfers/',
      '/dashboard/inventory/counts/',
      '/dashboard/inventory/adjustments/'
    ];
    var i;
    for (i = 0; i < stockHubRoots.length; i++) {
      var root = normalizePath(stockHubRoots[i]);
      if (p === root || p.indexOf(root) === 0) {
        var hub = null;
        getNavItems().forEach(function (item) {
          if (item.key === 'inv-stock-hub') hub = item;
        });
        if (hub) return hub;
        break;
      }
    }
    // Legacy Promo Codes desk highlights Offers & Promotions nav item
    if (p === '/dashboard/promo-codes/' || p.indexOf('/dashboard/promo-codes/') === 0) {
      var offersNav = null;
      getNavItems().forEach(function (item) {
        if (item.key === 'offers') offersNav = item;
      });
      if (offersNav) return offersNav;
    }
    var best = null;
    getNavItems().forEach(function (item) {
      var ip = normalizePath(item.path);
      if (p === ip || (ip !== '/dashboard/' && p.indexOf(ip) === 0)) {
        if (!best || ip.length > normalizePath(best.path).length) best = item;
      }
    });
    return best;
  }

  function isNavItemVisible(item, registry) {
    var Nav = navApi();
    if (Nav && Nav.isNavItemVisible) return Nav.isNavItemVisible(item, registry);
    return true;
  }

  function useVisibleNav(registry) {
    var Nav = navApi();
    if (Nav && Nav.useVisibleNav) {
      return Nav.useVisibleNav(registry !== undefined ? registry : lastRegistry);
    }
    // GfpNav missing (stale server inject / hard-cache) — never dump an authenticated
    // staff user into an empty shell; expose Overview at minimum.
    if (global.console && console.warn) {
      console.warn('[GfpShell] GfpNav missing — /shared/nav.js not loaded. Restart apps/web.');
    }
    if (global.GfpAuthz && global.GfpAuthz.useCanRole('AnyStaff')) {
      return [
        {
          key: 'overview',
          label: 'Overview',
          labelAr: 'نظرة عامة',
          items: [
            {
              key: 'dashboard',
              label: 'Dashboard',
              labelAr: 'لوحة التحكم',
              path: '/dashboard/',
              icon: 'ti-layout-dashboard',
              access: { kind: 'any' }
            }
          ]
        }
      ];
    }
    return [];
  }

  function getDefaultLandingPath(registry) {
    var Nav = navApi();
    var cats = useVisibleNav(registry !== undefined ? registry : lastRegistry);
    if (Nav && Nav.getDefaultLandingPath) return Nav.getDefaultLandingPath(cats);
    if (!cats.length || !cats[0].items.length) return null;
    return cats[0].items[0].path;
  }

  function getLocale() {
    return (global.GfpI18n && global.GfpI18n.getLocale()) || 'en';
  }

  function isRtl() {
    return getLocale() === 'ar' || (global.document.documentElement && global.document.documentElement.dir === 'rtl');
  }

  function tLabel(en, ar) {
    if (global.GfpI18n) return global.GfpI18n.tLabel(en, ar, getLocale());
    return getLocale() === 'ar' ? ar || en : en;
  }

  function ensureShellStyles() {
    if (global.document.getElementById('gfp-shell-css')) return;
    var css = global.document.createElement('style');
    css.id = 'gfp-shell-css';
    css.textContent = [
      '.gfp-lang-toggle{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--ls3,#E8E8E8);background:var(--ls1,#fff);border-radius:999px;font-size:var(--gfp-fs-sm,13px);font-weight:700;cursor:pointer;color:var(--lts,#4A4A4A);flex-shrink:0}',
      '.gfp-lang-toggle:hover{border-color:var(--l500,#7ACC00);color:var(--l600,#5EAF00)}',
      '.gfp-appear-toggle{display:inline-flex;align-items:center;padding:2px;border:1px solid var(--ls3,#E8E8E8);background:var(--ls2,#F5F5F5);border-radius:999px;flex-shrink:0;gap:2px}',
      '.gfp-appear-toggle button{height:26px;min-width:30px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:var(--lts,#4A4A4A);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px}',
      '.gfp-appear-toggle button.act{background:var(--l500,#7ACC00);color:#0D0D0D}',
      '.gfp-appear-toggle button:focus-visible{outline:2px solid var(--l400,#A0E040);outline-offset:1px}',
      'html[dir=rtl] .sidebar{left:auto;right:0}',
      'html[dir=rtl] .main{margin-left:0;margin-right:var(--sidebar-w,220px)}',
      '.gfp-sb-nav{display:flex;flex-direction:column;gap:4px;padding:8px 0}',
      'html[dir=rtl] .gfp-sb-nav{direction:rtl}',
      '.gfp-nav-cat{display:flex;flex-direction:column;gap:2px}',
      '.gfp-nav-cat-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:8px 14px 6px;border:0;background:transparent;cursor:pointer;color:var(--c400,#9CA3AF);font-size:var(--gfp-fs-xs,12px);font-weight:700;text-transform:uppercase;letter-spacing:.6px;text-align:start}',
      '.gfp-nav-cat-hdr:hover{color:var(--lts,#4A4A4A)}',
      '.gfp-nav-cat-hdr .gfp-chev{font-size:15px;transition:transform .15s ease;flex-shrink:0}',
      '.gfp-nav-cat.collapsed .gfp-nav-items{display:none}',
      '.gfp-nav-items{display:flex;flex-direction:column;gap:1px;padding:0 6px 6px}',
      'html[dir=rtl] .gfp-nav-items{direction:rtl}',
      '.gfp-nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;color:var(--c200,#E5E7EB);text-decoration:none;font-size:var(--gfp-fs-md,14px);font-weight:600;border-inline-start:3px solid transparent}',
      '.gfp-nav-item:hover{background:rgba(255,255,255,.06);color:#fff}',
      '.gfp-nav-item.act{background:rgba(122,204,0,.12);color:var(--l400,#A0E040);border-inline-start-color:var(--l500,#7ACC00)}',
      '.gfp-nav-item i{font-size:19px;opacity:.9;flex-shrink:0}',
      '.gfp-nav-empty{padding:20px 16px;text-align:center;color:var(--c400,#9CA3AF);font-size:var(--gfp-fs-md,14px);line-height:1.5}',
      '.gfp-nav-empty i{font-size:28px;display:block;margin-bottom:10px;opacity:.7}',
      '.gfp-nav-empty .ar{font-family:var(--fa,"IBM Plex Sans Arabic"),sans-serif;direction:rtl;margin-top:8px;font-size:var(--gfp-fs-sm,13px)}',
      '.gfp-shell-empty-main{display:flex;align-items:center;justify-content:center;min-height:50vh;padding:40px 24px;text-align:center}',
      '.gfp-shell-empty-main .card{max-width:420px;padding:32px;border-radius:16px;background:var(--ls1,#fff);border:1px solid var(--ls3,#E8E8E8);box-shadow:var(--sh2,0 4px 16px rgba(0,0,0,.06))}',
      '.gfp-shell-empty-main i{font-size:40px;color:var(--l500,#7ACC00);margin-bottom:12px;display:block}',
      '.sb-item[hidden],.sb-item.gfp-nav-hidden{display:none!important;pointer-events:none!important}'
    ].join('\n');
    global.document.head.appendChild(css);
  }

  function injectLangToggle() {
    if (global.document.getElementById('gfpLangToggle')) return;
    var I18n = global.GfpI18n;
    if (!I18n) return;
    var host =
      global.document.querySelector('.tb-right') ||
      global.document.querySelector('.topbar') ||
      global.document.querySelector('.sb-ft');
    if (!host) return;
    var btn = global.document.createElement('button');
    btn.type = 'button';
    btn.id = 'gfpLangToggle';
    btn.className = 'gfp-lang-toggle';
    btn.title = 'Toggle Arabic / English';
    function paint() {
      btn.textContent = I18n.getLocale() === 'ar' ? 'EN' : 'عربي';
    }
    paint();
    btn.addEventListener('click', function () {
      I18n.toggleLocale();
      paint();
      renderShellNav(lastRegistry);
    });
    if (host.classList.contains('tb-right') || host.classList.contains('topbar')) {
      host.insertBefore(btn, host.firstChild);
    } else {
      host.appendChild(btn);
    }
  }

  function injectAppearanceToggle() {
    if (global.document.getElementById('gfpAppearToggle')) return;
    var Theme = global.GfpTheme;
    if (!Theme || !Theme.setPref) return;
    var host =
      global.document.querySelector('.tb-right') ||
      global.document.querySelector('.topbar') ||
      global.document.querySelector('.sb-ft');
    if (!host) return;
    var wrap = global.document.createElement('div');
    wrap.id = 'gfpAppearToggle';
    wrap.className = 'gfp-appear-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Appearance');
    var opts = [
      { id: 'light', icon: 'ti-sun', title: 'Light' },
      { id: 'dark', icon: 'ti-moon', title: 'Dark' },
      { id: 'system', icon: 'ti-device-desktop', title: 'System' }
    ];
    function paint() {
      var pref = Theme.getPref();
      wrap.querySelectorAll('[data-appearance]').forEach(function (btn) {
        btn.classList.toggle('act', btn.getAttribute('data-appearance') === pref);
      });
    }
    opts.forEach(function (opt) {
      var btn = global.document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-appearance', opt.id);
      btn.title = opt.title;
      btn.setAttribute('aria-label', opt.title);
      btn.innerHTML = '<i class="ti ' + opt.icon + '"></i>';
      btn.addEventListener('click', function () {
        Theme.setPref(opt.id);
        paint();
      });
      wrap.appendChild(btn);
    });
    paint();
    if (host.classList.contains('tb-right') || host.classList.contains('topbar')) {
      host.insertBefore(wrap, host.firstChild);
    } else {
      host.appendChild(wrap);
    }
  }

  function pathIsActive(itemPath, currentPath) {
    var itemUrl;
    var curUrl;
    try {
      itemUrl = new URL(itemPath, global.location.origin);
      curUrl = new URL(currentPath, global.location.origin);
    } catch (e) {
      var ip0 = normalizePath(itemPath);
      var cp0 = normalizePath(currentPath);
      if (cp0 === ip0) return true;
      if (ip0 === normalizePath('/dashboard/')) return cp0 === ip0;
      return cp0.indexOf(ip0) === 0;
    }
    var ip = normalizePath(itemUrl.pathname);
    var cp = normalizePath(curUrl.pathname);
    // Dashboard root: only exact match so /dashboard/members/ isn't "Dashboard"
    if (ip === normalizePath('/dashboard/')) return cp === ip;
    // POS vs Sell retail share pathname — distinguish by ?mode=retail
    if (ip === normalizePath('/dashboard/pos/')) {
      if (cp !== ip) return false;
      var itemRetail = itemUrl.searchParams.get('mode') === 'retail';
      var curRetail = curUrl.searchParams.get('mode') === 'retail';
      return itemRetail === curRetail;
    }
    // Inventory overview is exact-only (do not steal On Hand / nested routes)
    if (ip === normalizePath('/dashboard/inventory/')) {
      return cp === ip;
    }
    // Stock Management hub — active for hub + legacy stock/move/count + Buy/Fix deep links
    if (ip === normalizePath('/dashboard/inventory/stock-management/')) {
      if (cp === ip) return true;
      if (cp.indexOf(normalizePath('/dashboard/inventory/stock')) === 0) return true;
      if (cp.indexOf(normalizePath('/dashboard/inventory/transfers')) === 0) return true;
      if (cp.indexOf(normalizePath('/dashboard/inventory/counts')) === 0) return true;
      if (cp.indexOf(normalizePath('/dashboard/inventory/adjustments')) === 0) return true;
      return false;
    }
    // Legacy On Hand path (redirects to hub) — keep Buy/Fix highlight
    if (ip === normalizePath('/dashboard/inventory/stock/')) {
      if (cp === ip) return true;
      if (cp.indexOf(normalizePath('/dashboard/inventory/adjustments')) === 0) return true;
      return false;
    }
    if (cp === ip) return true;
    return cp.indexOf(ip) === 0;
  }

  function getSbNavHost() {
    var existing = global.document.querySelector('.sb-nav');
    if (existing) return existing;
    var sidebar = global.document.querySelector('.sidebar') || global.document.getElementById('sidebar');
    if (!sidebar) return null;
    var nav = global.document.createElement('nav');
    nav.className = 'sb-nav gfp-sb-nav';
    var hdr = sidebar.querySelector('.sb-hdr');
    if (hdr && hdr.nextSibling) sidebar.insertBefore(nav, hdr.nextSibling);
    else sidebar.insertBefore(nav, sidebar.firstChild);
    return nav;
  }

  function chevronIcon(collapsed) {
    // RTL: expanded → chevron points "end"; flip for collapse
    var rtl = isRtl();
    if (collapsed) return rtl ? 'ti-chevron-left' : 'ti-chevron-right';
    return 'ti-chevron-down';
  }

  function renderEmptyNav(host) {
    host.innerHTML =
      '<div class="gfp-nav-empty" role="status">' +
      '<i class="ti ti-lock-access"></i>' +
      '<div><strong>No accessible sections</strong></div>' +
      '<div style="margin-top:6px">Contact your gym owner to grant permissions.</div>' +
      '<div class="ar">لا توجد أقسام متاحة — تواصل مع مالك الصالة لمنح الصلاحيات</div>' +
      '</div>';
  }

  function showEmptyMainIfNeeded(cats) {
    var main = global.document.querySelector('.main .content') || global.document.querySelector('.main');
    if (!main) return;

    if (cats.length) {
      var mainEmpty = global.document.getElementById('gfpShellEmptyMain');
      if (mainEmpty) mainEmpty.remove();
      Array.prototype.forEach.call(main.children, function (ch) {
        if (ch.getAttribute && ch.getAttribute('data-gfp-shell-hidden') === '1') {
          ch.style.removeProperty('display');
          ch.removeAttribute('data-gfp-shell-hidden');
        }
      });
      return;
    }

    // Blank shell on any dashboard route when zero categories
    if (global.document.getElementById('gfpShellEmptyMain')) return;
    var wrap = global.document.createElement('div');
    wrap.id = 'gfpShellEmptyMain';
    wrap.className = 'gfp-shell-empty-main';
    wrap.innerHTML =
      '<div class="card">' +
      '<i class="ti ti-shield-off"></i>' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:8px">' +
      tLabel('No accessible sections', 'لا توجد أقسام متاحة') +
      '</div>' +
      '<div style="font-size:14px;color:var(--ltt,#888)">' +
      tLabel(
        'This staff account has no permitted screens. Contact your gym owner.',
        'هذا الحساب لا يملك صلاحيات للوصول. تواصل مع مالك الصالة.'
      ) +
      '</div></div>';
    // Hide noisy page content
    Array.prototype.forEach.call(main.children, function (ch) {
      if (ch.id !== 'gfpShellEmptyMain') {
        ch.setAttribute('data-gfp-shell-hidden', '1');
        ch.style.display = 'none';
      }
    });
    main.appendChild(wrap);
  }

  function renderShellNav(registry) {
    if (registry !== undefined) lastRegistry = registry;
    var host = getSbNavHost();
    if (!host) return;

    // Hide legacy flat links that pages still include in markup
    host.querySelectorAll(':scope > a.sb-item').forEach(function (a) {
      a.classList.add('gfp-nav-hidden');
      a.hidden = true;
      a.removeAttribute('href');
    });

    var cats = useVisibleNav(registry);
    host.classList.add('gfp-sb-nav');

    if (!cats.length) {
      renderEmptyNav(host);
      showEmptyMainIfNeeded(cats);
      return;
    }
    showEmptyMainIfNeeded(cats);

    var current = global.location.pathname + global.location.search;
    var rtl = isRtl();
    var html = '';

    // Category order follows registry; DOM dir=rtl mirrors start/end (chevron + border)
    cats.forEach(function (cat) {
      var collapsed = isCollapsed(cat.key);
      var catLabel = tLabel(cat.label, cat.labelAr);
      html +=
        '<div class="gfp-nav-cat' +
        (collapsed ? ' collapsed' : '') +
        '" data-cat="' +
        cat.key +
        '">' +
        '<button type="button" class="gfp-nav-cat-hdr" data-cat-toggle="' +
        cat.key +
        '" aria-expanded="' +
        (!collapsed) +
        '">' +
        '<span>' +
        catLabel +
        '</span>' +
        '<i class="ti ' +
        chevronIcon(collapsed) +
        ' gfp-chev" aria-hidden="true"></i>' +
        '</button>' +
        '<div class="gfp-nav-items">';

      cat.items.forEach(function (item) {
        var active = pathIsActive(item.path, current);
        html +=
          '<a class="gfp-nav-item sb-item' +
          (active ? ' act' : '') +
          '" href="' +
          item.path +
          '" data-gfp-href="' +
          item.path +
          '" data-nav-key="' +
          item.key +
          '">' +
          '<i class="ti ' +
          (item.icon || 'ti-circle') +
          '"></i>' +
          '<span>' +
          tLabel(item.label, item.labelAr) +
          '</span>' +
          (item.key === 'notifications'
            ? '<span class="gfp-notif-badge" hidden></span>'
            : '') +
          '</a>';
      });

      html += '</div></div>';
    });

    host.innerHTML = html;

    host.querySelectorAll('[data-cat-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = this.getAttribute('data-cat-toggle');
        setCollapsed(key, !isCollapsed(key));
        renderShellNav(lastRegistry);
      });
    });
  }

  function enforceRouteAccess(registry) {
    var path = normalizePath(global.location.pathname);
    if (path.indexOf('/dashboard') !== 0) return;

    var cats = useVisibleNav(registry);
    if (!cats.length) {
      // Stay put — empty shell UI handles messaging
      return;
    }

    var cfg = findNavConfig(path);
    // Wait for feature probes before kicking off feature-gated routes
    if (cfg && (cfg.featureFlag || cfg.featureModule) && registry == null) return;

    var allowed = cfg && isNavItemVisible(cfg, registry);
    if (allowed) return;

    var land = getDefaultLandingPath(registry) || '/dashboard/';
    if (normalizePath(land) !== path) {
      global.location.replace(land);
    }
  }

  function clearInlineOwnerOnlyHacks() {
    var staff = global.document.getElementById('navStaff');
    if (staff && staff.style) staff.style.removeProperty('display');
  }

  /**
   * Post-login / session restore landing — first visible item (fail-open modules if needed).
   * @returns {Promise<string>}
   */
  async function resolveLandingPath() {
    var registry = null;
    if (global.GfpFeatures) {
      try {
        registry = await global.GfpFeatures.probeAllModules(false);
      } catch (e) {
        registry = {};
        (global.GfpFeatures.FEATURE_MODULES || []).forEach(function (k) {
          // stock_management is packaging — never fail-open onto Pro hub
          registry[k] = k !== 'stock_management';
        });
      }
    } else {
      registry = {};
    }
    lastRegistry = registry;
    return getDefaultLandingPath(registry) || '/dashboard/';
  }

  function shopUxShouldRedirect(pathname, search) {
    var Features = global.GfpFeatures;
    if (!Features || !Features.SHOP_OWNER_UX) return false;
    if (search && String(search).indexOf('embed=1') !== -1) return false;
    var p = normalizePath(pathname);
    if (p === '/dashboard/inventory/') return true;
    var blocked = [
      '/dashboard/inventory/stock-management/',
      '/dashboard/inventory/stock/',
      '/dashboard/inventory/transfers/',
      '/dashboard/inventory/counts/',
      '/dashboard/inventory/warehouses/',
      '/dashboard/inventory/reports/',
      '/dashboard/inventory/adjustments/'
    ];
    var i;
    for (i = 0; i < blocked.length; i++) {
      var root = normalizePath(blocked[i]);
      if (p === root || p.indexOf(root) === 0) return true;
    }
    return false;
  }

  function maybeShopUxRedirect() {
    if (!global.location || !shopUxShouldRedirect(global.location.pathname, global.location.search)) return;
    global.location.replace('/dashboard/inventory/products/');
  }

  async function boot() {
    if (bootDone) return;
    maybeShopUxRedirect();
    if (!/\/dashboard(\/|$)/.test(global.location.pathname)) return;
    if (!global.GfpAuthz) return;

    var token = global.GfpAuthz.getAccessToken();
    if (!token || !global.GfpAuthz.useCanRole('AnyStaff')) {
      global.location.href = '/auth/login/';
      return;
    }

    bootDone = true;
    ensureShellStyles();
    injectLangToggle();
    injectAppearanceToggle();
    clearInlineOwnerOnlyHacks();
    if (global.GfpI18n && global.GfpI18n.applyDocumentLocale) {
      global.GfpI18n.applyDocumentLocale();
    }

    if (global.GfpBranding && typeof global.GfpBranding.load === 'function') {
      try {
        await global.GfpBranding.load();
      } catch (e) { /* branding is non-blocking */ }
    }

    var cached = (global.GfpFeatures && global.GfpFeatures.readCache()) || null;
    renderShellNav(cached);
    enforceRouteAccess(cached);

    if (global.GfpBranding && typeof global.GfpBranding.reapply === 'function') {
      try {
        await global.GfpBranding.reapply();
      } catch (e) { /* ignore */ }
    }

    if (global.GfpFeatures) {
      try {
        var registry = await global.GfpFeatures.probeAllModules(false);
        renderShellNav(registry);
        enforceRouteAccess(registry);
        if (global.GfpBranding && global.GfpBranding.reapply) {
          await global.GfpBranding.reapply();
        }
      } catch (e) {
        var open = {};
        (global.GfpFeatures.FEATURE_MODULES || []).forEach(function (k) {
          open[k] = k !== 'stock_management';
        });
        renderShellNav(open);
        enforceRouteAccess(open);
      }
    } else {
      renderShellNav({});
      enforceRouteAccess({});
    }

    global.addEventListener('gfp:locale', function () {
      if (global.GfpI18n && global.GfpI18n.applyDocumentLocale) {
        global.GfpI18n.applyDocumentLocale();
      }
      renderShellNav(lastRegistry);
    });
  }

  if (global.GfpApi && global.GfpApi.logout) {
    var prevLogout = global.GfpApi.logout.bind(global.GfpApi);
    global.GfpApi.logout = function () {
      if (global.GfpFeatures) global.GfpFeatures.clearCache();
      if (global.GfpBranding && global.GfpBranding.clear) global.GfpBranding.clear();
      return prevLogout();
    };
  }

  global.GfpShell = {
    get NAV_ITEMS() {
      return getNavItems();
    },
    get NAV_CATEGORIES() {
      var Nav = navApi();
      return (Nav && Nav.NAV_CATEGORIES) || [];
    },
    isNavItemVisible: isNavItemVisible,
    findNavConfig: findNavConfig,
    useVisibleNav: useVisibleNav,
    getDefaultLandingPath: getDefaultLandingPath,
    resolveLandingPath: resolveLandingPath,
    renderShellNav: renderShellNav,
    applyNavVisibility: renderShellNav,
    enforceRouteAccess: enforceRouteAccess,
    shopUxShouldRedirect: shopUxShouldRedirect,
    boot: boot
  };
  global.useVisibleNav = useVisibleNav;

  function start() {
    boot();
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
