/**
 * Prompt 2 self-check (node). Run: node src/app/shared/shell.selftest.js
 * Covers Receptionist plans/settings hide, FEATURE_DISABLED, pending-probe hide,
 * JWT perm decode, bilingual message/messageAr.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok —', msg);
}

function loadIife(file, sandbox) {
  var code = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: file });
  return sandbox;
}

var sharedDir = __dirname;

// ── mock browser globals ──
var storage = {};
function makeStore() {
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function (k, v) { storage[k] = String(v); },
    removeItem: function (k) { delete storage[k]; }
  };
}

function btoaNode(s) {
  return Buffer.from(s, 'binary').toString('base64');
}

function fakeJwt(payload) {
  var enc = btoaNode(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'hdr.' + enc + '.sig';
}

var sandbox = {
  console: console,
  atob: function (b64) { return Buffer.from(b64, 'base64').toString('binary'); },
  localStorage: makeStore(),
  sessionStorage: makeStore(),
  document: {
    readyState: 'complete',
    documentElement: {
      lang: 'en',
      dir: 'ltr',
      setAttribute: function (k, v) {
        this[k] = v;
      },
      getAttribute: function (k) {
        return this[k];
      }
    },
    body: { classList: { toggle: function () {} } },
    addEventListener: function () {},
    getElementById: function () { return null; },
    createElement: function () { return { style: {}, classList: { toggle: function () {} }, addEventListener: function () {} }; },
    head: { appendChild: function () {} },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  },
  location: { pathname: '/dashboard/', href: '', origin: 'http://localhost:3000', replace: function () {} },
  CustomEvent: function () {},
  dispatchEvent: function () {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

loadIife(path.join(sharedDir, 'authz.js'), sandbox);
loadIife(path.join(sharedDir, 'features.js'), sandbox);
loadIife(path.join(sharedDir, 'i18n.js'), sandbox);
loadIife(path.join(sharedDir, 'nav.js'), sandbox);
loadIife(path.join(sharedDir, 'shell.js'), sandbox);

var Authz = sandbox.GfpAuthz;
var Features = sandbox.GfpFeatures;
var I18n = sandbox.GfpI18n;
var Shell = sandbox.GfpShell;

assert(!!Authz && !!Features && !!I18n && !!Shell, 'shared modules attached');

// ── Receptionist JWT (no plans.manage / settings.manage) ──
var receptionistPerms = [
  'members.view', 'members.create', 'members.edit', 'checkin.manual',
  'sales.sell', 'sales.discount.apply', 'payments.cash.accept', 'payments.refund.request',
  'shift.open', 'shift.close', 'inventory.view'
];
storage.gfp_access_token = fakeJwt({
  sub: 'r1',
  role: 'Receptionist',
  perm: receptionistPerms
});
storage.gfp_user = JSON.stringify({ role: 'Receptionist', fullName: 'R' });

assert(Authz.useCan('sales.sell'), 'Receptionist can sales.sell');
assert(Authz.useCan('inventory.view'), 'Receptionist can inventory.view');
assert(!Authz.useCan('inventory.adjust'), 'Receptionist cannot inventory.adjust');
assert(!Authz.useCan('plans.manage'), 'Receptionist cannot plans.manage');
assert(!Authz.useCan('settings.manage'), 'Receptionist cannot settings.manage');
assert(Authz.useCanRole('AnyStaff'), 'Receptionist matches AnyStaff');
assert(!Authz.useCanRole('OwnerOnly'), 'Receptionist is not OwnerOnly');

var plans = Shell.NAV_ITEMS.find(function (n) { return n.key === 'plans'; });
var activities = Shell.NAV_ITEMS.find(function (n) { return n.key === 'activities'; });
var classes = Shell.NAV_ITEMS.find(function (n) { return n.key === 'classes'; });
var settings = Shell.NAV_ITEMS.find(function (n) { return n.key === 'settings'; });
var pos = Shell.NAV_ITEMS.find(function (n) { return n.key === 'pos'; });
var call = Shell.NAV_ITEMS.find(function (n) { return n.key === 'call-sheet'; });
var staff = Shell.NAV_ITEMS.find(function (n) { return n.key === 'staff'; });
var roles = Shell.NAV_ITEMS.find(function (n) { return n.key === 'roles'; });
var invHome = Shell.NAV_ITEMS.find(function (n) { return n.key === 'inv-home'; });
var invStock = Shell.NAV_ITEMS.find(function (n) { return n.key === 'inv-stock-hub'; });
var invProducts = Shell.NAV_ITEMS.find(function (n) { return n.key === 'inv-products'; });
var invAdjust = Shell.NAV_ITEMS.find(function (n) { return n.key === 'inv-adjustments'; });

var allOn = {
  sales: true, shifts: true, trials: true, refunds: true, debtors: true, imports: true,
  inventory: true, stock_management: true
};

assert(!!plans && !!activities && !!classes && !!pos && !!invHome && !!invStock && !!invProducts, 'nav items resolved by key');
assert(!invAdjust, 'Adjustments stay removed from Inventory nav registry');
assert(!Shell.isNavItemVisible(plans, allOn), 'Receptionist hides Plans');
assert(!Shell.isNavItemVisible(activities, allOn), 'Receptionist hides Activities catalog');
assert(Shell.isNavItemVisible(classes, allOn), 'Receptionist sees Classes');
assert(!Shell.isNavItemVisible(settings, allOn), 'Receptionist hides Settings');
assert(!Shell.isNavItemVisible(staff, allOn), 'Receptionist hides Staff');
assert(!!roles, 'Roles nav item is registered');
assert(!Shell.isNavItemVisible(roles, allOn), 'Receptionist hides Roles');
assert(Shell.isNavItemVisible(pos, allOn), 'Receptionist sees POS when sales enabled');
assert(Shell.isNavItemVisible(call, allOn), 'Receptionist sees Call sheet (no feature flag)');
assert(!Shell.isNavItemVisible(invHome, allOn), 'Shop UX hides Inventory Overview');
assert(!Shell.isNavItemVisible(invStock, allOn), 'Shop UX hides Stock Management hub');
assert(!Shell.isNavItemVisible(invProducts, allOn), 'Receptionist hides Inventory Products (no manage/purchase)');

// FEATURE_DISABLED
var salesOff = Object.assign({}, allOn, { sales: false });
assert(!Shell.isNavItemVisible(pos, salesOff), 'FEATURE_DISABLED hides POS');
assert(Shell.isNavItemVisible(call, salesOff), 'Call sheet stays when sales flag off');

var invOff = Object.assign({}, allOn, { inventory: false });
assert(!Shell.isNavItemVisible(invStock, invOff), 'FEATURE_DISABLED inventory hides Stock Management');

var stockMgmtOff = Object.assign({}, allOn, { stock_management: false });
assert(!Shell.isNavItemVisible(invStock, stockMgmtOff), 'stock_management off hides hub');
assert(!Shell.isNavItemVisible(invHome, stockMgmtOff), 'stock_management off hides Overview');

assert(Features.PHASE_HIDE_STOCK_MANAGEMENT, 'shop UX phase-hides Stock Management');
assert(Features.SHOP_OWNER_UX, 'SHOP_OWNER_UX is on');
assert(!Features.isModuleAvailable('stock_management', allOn), 'stock_management gated off in shop UX');

// Pending probe (null registry) — feature modules must NOT be clickable
assert(!Shell.isNavItemVisible(pos, null), 'Pending probe hides feature-gated POS');
assert(Shell.isNavItemVisible(call, null), 'Call sheet visible while probes pending');
assert(!Features.isModuleAvailable('sales', null), 'isModuleAvailable(null) is unavailable');
assert(Features.isModuleAvailable('sales', allOn), 'isModuleAvailable true when enabled');
assert(!Features.isModuleAvailable('sales', salesOff), 'isModuleAvailable false when disabled');
assert(Features.FEATURE_MODULES.indexOf('inventory') !== -1, 'FEATURE_MODULES lists inventory');
assert(Features.FEATURE_MODULES.indexOf('stock_management') !== -1, 'FEATURE_MODULES lists stock_management');

// ── Owner sees plans/settings / inventory adjust ──
storage.gfp_access_token = fakeJwt({
  role: 'Owner',
  perm: receptionistPerms.concat([
    'plans.manage', 'settings.manage', 'reports.financial.view',
    'inventory.manage', 'inventory.adjust', 'inventory.purchase', 'inventory.transfer'
  ])
});
storage.gfp_user = JSON.stringify({ role: 'Owner' });
assert(Shell.isNavItemVisible(plans, allOn), 'Owner sees Plans');
assert(Shell.isNavItemVisible(activities, allOn), 'Owner sees Activities');
assert(Shell.isNavItemVisible(settings, allOn), 'Owner sees Settings');
assert(Shell.isNavItemVisible(staff, allOn), 'Owner sees Staff');
assert(Shell.isNavItemVisible(roles, allOn), 'Owner sees Roles');
assert(!Shell.isNavItemVisible(invStock, allOn), 'Owner shop UX hides Stock Management hub');
assert(Shell.isNavItemVisible(invProducts, stockMgmtOff), 'Owner Growth packaging keeps Products');

// ── Manager: no plans.manage, not Owner ──
storage.gfp_access_token = fakeJwt({
  role: 'Manager',
  perm: receptionistPerms.concat([
    'reports.financial.view', 'payments.refund.approve', 'memberships.freeze',
    'inventory.manage', 'inventory.adjust', 'inventory.purchase', 'inventory.transfer'
  ])
});
storage.gfp_user = JSON.stringify({ role: 'Manager' });
assert(!Shell.isNavItemVisible(plans, allOn), 'Manager hides Plans (no plans.manage)');
assert(!Shell.isNavItemVisible(activities, allOn), 'Manager hides Activities (no plans.manage)');
assert(!Shell.isNavItemVisible(settings, allOn), 'Manager hides Settings (not Owner)');
assert(!Shell.isNavItemVisible(staff, allOn), 'Manager hides Staff');
assert(!Shell.isNavItemVisible(roles, allOn), 'Manager hides Roles');
assert(!Shell.isNavItemVisible(invStock, allOn), 'Manager shop UX hides Stock Management hub');
// ── Bilingual ──
assert(I18n.pickBilingual('Hello', 'مرحبا', 'ar') === 'مرحبا', 'pickBilingual prefers ar');
assert(I18n.displayBilingualText({ message: 'Open shift', messageAr: 'افتح الوردية' }, 'ar').indexOf('افتح') === 0, 'message/messageAr');
assert(I18n.displayBilingualText('English / العربية', 'ar') === 'العربية', 'slash split');
assert(I18n.displayApiError({ error: { message: 'A / ب' } }, 'ar') === 'ب', 'displayApiError');

// ── Sidebar layout clamp (Task 2) ──
assert(Shell.isDrawerViewport(767) === true, 'drawer below 768');
assert(Shell.isDrawerViewport(768) === false, 'persistent at 768');
assert(Shell.clampSidebarWidth(100, 1400) === 180, 'sidebar min 180');
assert(Shell.clampSidebarWidth(500, 1400) === 360, 'sidebar max 360');
assert(Shell.clampSidebarWidth(220, 1400) === 220, 'default 220 stays');
assert(Shell.clampSidebarWidth(400, 800) === 320, 'max leaves 480px for main');
assert(Shell.getSidebarMaxForViewport(1024) === 360, 'desktop max 360');
assert(Shell.getSidebarMaxForViewport(768) === 288, 'tablet max vw-480');
assert(Shell.canResizeSidebar(800) === true, 'resize when persistent and room');
assert(Shell.canResizeSidebar(700) === false, 'no resize in drawer viewport');

// ── Header CSS (Task 3) ──
var hdrCss = fs.readFileSync(path.join(sharedDir, 'shell-header.css'), 'utf8');
assert(hdrCss.indexOf('@media (min-width: 1024px)') !== -1, 'header keeps desktop row');
assert(hdrCss.indexOf('@media (max-width: 1023px)') !== -1, 'header tablet query');
assert(hdrCss.indexOf('@media (max-width: 767.98px)') !== -1, 'header mobile query');
assert(hdrCss.indexOf('@media (max-width: 479.98px)') !== -1, 'header compact-phone query');
assert(hdrCss.indexOf('.gfp-sb-toggle') !== -1, 'header keeps menu trigger unshrunk');
assert(hdrCss.indexOf('flex: 1 0 100%') !== -1, 'mobile actions move to second row');
assert(typeof Shell.wrapTopbarGym === 'function', 'wrapTopbarGym exported');
assert(typeof Shell.initHeaderLayout === 'function', 'initHeaderLayout exported');

(function () {
  var gymEn = { id: 'gymName', className: 'gym-name', parentNode: null };
  var gymAr = { id: 'gymNameAr', className: 'gym-name-ar', parentNode: null };
  var wrapCreated = null;
  var right = {
    querySelector: function (sel) {
      if (String(sel).indexOf('gfp-tb-gym') !== -1) return wrapCreated;
      if (sel === '#gymName' || sel === '.tb-gym-name' || sel === '.gym-name') return gymEn;
      if (sel === '#gymNameAr' || sel === '.tb-gym-name-ar' || sel === '.gym-name-ar') return gymAr;
      return null;
    },
    children: [gymEn, gymAr],
    insertBefore: function (node) {
      node.parentNode = this;
      this.children.unshift(node);
      wrapCreated = node;
      return node;
    }
  };
  gymEn.parentNode = right;
  gymAr.parentNode = right;
  var origQS = sandbox.document.querySelector;
  sandbox.document.querySelector = function (sel) {
    if (sel === '.topbar .tb-right' || sel === '.topbar') return right;
    return origQS.apply(sandbox.document, arguments);
  };
  sandbox.document.createElement = function () {
    return {
      className: '',
      children: [],
      appendChild: function (ch) {
        ch.parentNode = this;
        this.children.push(ch);
        return ch;
      }
    };
  };
  Shell.wrapTopbarGym();
  assert(!!wrapCreated && wrapCreated.className === 'gfp-tb-gym', 'wraps sibling gym names');
  assert(wrapCreated.children.indexOf(gymEn) !== -1 && wrapCreated.children.indexOf(gymAr) !== -1, 'gym names moved into wrap');
})();

console.log('All Prompt 2 self-tests passed.');
