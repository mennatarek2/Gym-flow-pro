/**
 * Four fixture JWTs → assert filtered NavCategory[] keys.
 * Run: node src/app/shared/nav.selftest.js
 * (from apps/web)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fixtureToken(role, perms) {
  return (
    b64url({ alg: 'none', typ: 'JWT' }) +
    '.' +
    b64url({ role: role, perm: perms }) +
    '.sig'
  );
}

const INV_VIEW = 'inventory.view';
const INV_MANAGE = 'inventory.manage';
const INV_ADJUST = 'inventory.adjust';
const INV_PURCHASE = 'inventory.purchase';
const INV_TRANSFER = 'inventory.transfer';

const ALL_PERMS = [
  'members.view',
  'members.create',
  'members.edit',
  'checkin.manual',
  'sales.sell',
  'sales.discount.apply',
  'sales.discount.override',
  'payments.cash.accept',
  'payments.refund.request',
  'payments.refund.approve',
  'shift.open',
  'shift.close',
  'shift.reconcile.approve',
  'memberships.freeze',
  'plans.manage',
  'reports.financial.view',
  'settings.manage',
  INV_VIEW,
  INV_MANAGE,
  INV_ADJUST,
  INV_PURCHASE,
  INV_TRANSFER,
  'member_orders.view',
  'member_orders.manage'
];

// Inventory IA: one Stock Management hub; Products lives under Catalog; advanced under Inventory.
const STOCK_MGMT_KEYS = ['inv-stock-hub'];
const INV_VIEW_KEYS = ['inv-home', 'inv-reports'];

const INV_ALL_KEYS = INV_VIEW_KEYS.concat(['inv-suppliers', 'inv-warehouses']).sort();

// Stable order as registered in nav.js
const INV_OWNER_KEYS = ['inv-home', 'inv-reports', 'inv-suppliers', 'inv-warehouses'];
const CATALOG_OWNER_KEYS = ['plans', 'inv-products', 'inv-suppliers', 'inv-purchase-orders'];
const CATALOG_MANAGER_KEYS = ['inv-products', 'inv-suppliers', 'inv-purchase-orders'];

const FIXTURES = {
  Owner: { role: 'Owner', perms: ALL_PERMS.slice() },
  Manager: {
    role: 'Manager',
    perms: ALL_PERMS.filter(function (p) {
      return p !== 'plans.manage' && p !== 'settings.manage';
    })
  },
  Trainer: { role: 'Trainer', perms: ['checkin.manual'] },
  Receptionist: {
    role: 'Receptionist',
    perms: [
      'members.view',
      'members.create',
      'members.edit',
      'checkin.manual',
      'sales.sell',
      'sales.discount.apply',
      'payments.cash.accept',
      'payments.refund.request',
      'shift.open',
      'shift.close',
      INV_VIEW,
      'member_orders.view',
      'member_orders.manage'
    ]
  }
};

function loadShared() {
  const dir = __dirname;
  const sandbox = {
    console: console,
    atob: function (s) {
      return Buffer.from(s, 'base64').toString('binary');
    },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    document: { readyState: 'complete', addEventListener: function () {} },
    location: { pathname: '/dashboard/', href: '', replace: function () {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  function run(file) {
    const code = fs.readFileSync(path.join(dir, file), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: file });
  }

  run('authz.js');
  run('features.js');
  run('nav.js');

  sandbox.GfpFeatures.isModuleAvailable = function (key, registry) {
    if (!key) return true;
    if (key === 'stock_management' && sandbox.GfpFeatures.PHASE_HIDE_STOCK_MANAGEMENT) return false;
    if (registry == null) return false;
    return !!registry[key];
  };

  return sandbox;
}

function shape(cats) {
  const out = {};
  cats.forEach(function (c) {
    out[c.key] = c.items.map(function (i) {
      return i.key;
    });
  });
  return out;
}

function assertShape(label, actual, expected) {
  const aKeys = Object.keys(actual).sort();
  const eKeys = Object.keys(expected).sort();
  assert(
    aKeys.join(',') === eKeys.join(','),
    label +
      ': categories\n  got:  ' +
      aKeys.join(',') +
      '\n  want: ' +
      eKeys.join(',')
  );
  eKeys.forEach(function (k) {
    assert(
      (actual[k] || []).join(',') === expected[k].join(','),
      label +
        ': ' +
        k +
        '\n  got:  ' +
        (actual[k] || []).join(',') +
        '\n  want: ' +
        expected[k].join(',')
    );
  });
}

function runFixture(name, modulesOn) {
  const sandbox = loadShared();
  const f = FIXTURES[name];
  const token = fixtureToken(f.role, f.perms);
  sandbox.localStorage.getItem = function (k) {
    if (k === 'gfp_access_token') return token;
    if (k === 'gfp_user') return JSON.stringify({ role: f.role, fullName: name });
    return null;
  };
  const registry = {};
  (sandbox.GfpFeatures.FEATURE_MODULES || []).forEach(function (k) {
    registry[k] = modulesOn(k);
  });
  return shape(
    sandbox.GfpNav.useVisibleNav(registry, {
      accessToken: token,
      role: f.role
    })
  );
}

const ALL_ON = function () {
  return true;
};

assert(
  (loadShared().GfpFeatures.FEATURE_MODULES || []).indexOf('inventory') !== -1,
  'FEATURE_MODULES includes inventory'
);
assert(
  (loadShared().GfpFeatures.FEATURE_MODULES || []).indexOf('stock_management') !== -1,
  'FEATURE_MODULES includes stock_management'
);

assertShape('Owner', runFixture('Owner', ALL_ON), {
  overview: ['dashboard'],
  members: ['members', 'invitations', 'attendance'],
  'front-desk': ['pos', 'member-orders', 'call-sheet'],
  shifts: ['shifts', 'z-report'],
  money: ['offers', 'invoices', 'reports'],
  catalog: CATALOG_OWNER_KEYS.slice(),
  administration: ['imports', 'audit', 'notifications', 'staff', 'roles', 'settings']
});

assertShape('Manager', runFixture('Manager', ALL_ON), {
  overview: ['dashboard'],
  members: ['members', 'invitations', 'attendance'],
  'front-desk': ['pos', 'member-orders', 'call-sheet'],
  shifts: ['shifts', 'z-report'],
  money: ['offers', 'invoices', 'reports'],
  catalog: CATALOG_MANAGER_KEYS.slice(),
  administration: ['notifications']
});

assertShape('Trainer', runFixture('Trainer', ALL_ON), {
  overview: ['dashboard'],
  members: ['attendance'],
  administration: ['notifications']
});

assertShape('Receptionist', runFixture('Receptionist', ALL_ON), {
  overview: ['dashboard'],
  members: ['members', 'invitations', 'attendance'],
  'front-desk': ['pos', 'member-orders', 'call-sheet'],
  shifts: ['shifts'],
  money: ['offers', 'reports'],
  administration: ['notifications']
});

// Receptionist: shop UX hides hub / warehouses; no catalog admin
{
  const stock = runFixture('Receptionist', ALL_ON)['stock-management'] || [];
  const inv = runFixture('Receptionist', ALL_ON).inventory || [];
  const catalog = runFixture('Receptionist', ALL_ON).catalog || [];
  assert(!stock.length, 'Receptionist shop UX hides Stock Management hub');
  assert(!inv.length, 'Receptionist shop UX hides Inventory overview/insights/warehouses');
  assert(!catalog.includes('inv-products'), 'Receptionist hides Products');
  assert(!catalog.includes('inv-suppliers'), 'Receptionist hides Suppliers');
  assert(!catalog.includes('inv-purchase-orders'), 'Receptionist hides Purchases');
}

// FEATURE_DISABLED sales — POS hidden from front desk; Inventory unchanged
{
  const actual = runFixture('Receptionist', function (k) {
    return k !== 'sales';
  });
  assert(!actual['front-desk'].includes('pos'), 'sales flag hides Sale');
  assert(!actual['front-desk'].includes('debtors'), 'Debtors is not a primary nav module');
  assert(!actual.money.includes('refunds'), 'Refunds is not a primary nav module');
  assert(!actual['stock-management'], 'sales flag does not restore Stock Management in shop UX');
  assert(actual['front-desk'].includes('call-sheet'), 'Call sheet never flag-gated');
  assert(!actual.money.includes('offers'), 'offers uses sales flag');
}

// FEATURE_DISABLED inventory — category gone
{
  const actual = runFixture('Owner', function (k) {
    return k !== 'inventory';
  });
  assert(!actual.inventory, 'inventory flag off hides Inventory category');
  assert(!actual['stock-management'], 'inventory flag off hides Stock Management');
  assert(actual.catalog && actual.catalog.includes('plans'), 'Plans stays when inventory off');
  assert(!actual.catalog.includes('inv-products'), 'Products leaves Catalog when inventory off');
}

// Growth packaging: inventory on, stock_management off → Products in Catalog only
{
  const actual = runFixture('Owner', function (k) {
    return k !== 'stock_management';
  });
  assert(!actual['stock-management'], 'stock_management off hides Stock Management');
  assert(!actual.inventory, 'Growth packaging hides advanced Inventory section');
  assert(
    actual.catalog && actual.catalog.join(',') === CATALOG_OWNER_KEYS.join(','),
    'Shop UX Catalog = Plans + Products + Suppliers + Purchases'
  );
}

// Claims over role name
{
  const sandbox = loadShared();
  const token = fixtureToken('Receptionist', ALL_PERMS.slice());
  const registry = {};
  sandbox.GfpFeatures.FEATURE_MODULES.forEach(function (k) {
    registry[k] = true;
  });
  const cats = sandbox.GfpNav.useVisibleNav(registry, {
    accessToken: token,
    role: 'Receptionist'
  });
  const catalog = cats.find(function (c) {
    return c.key === 'catalog';
  });
  assert(catalog && catalog.items.some(function (i) {
    return i.key === 'plans';
  }), 'plans.manage claim shows Plans regardless of role name');
  const inventory = cats.find(function (c) {
    return c.key === 'inventory';
  });
  assert(!inventory, 'shop UX hides advanced Inventory even with full perms');
  assert(catalog && catalog.items.some(function (i) {
    return i.key === 'inv-products';
  }), 'full inventory perms still show Products in Catalog');
  assert(catalog && catalog.items.some(function (i) {
    return i.key === 'inv-suppliers';
  }), 'full inventory perms show Suppliers in Catalog');
  assert(catalog && catalog.items.some(function (i) {
    return i.key === 'inv-purchase-orders';
  }), 'full inventory perms show Purchases in Catalog');
  const admin = cats.find(function (c) {
    return c.key === 'administration';
  });
  assert(
    admin && !admin.items.some(function (i) {
      return i.key === 'staff';
    }),
    'Staff stays OwnerOnly even with full perms'
  );
  assert(
    admin && !admin.items.some(function (i) {
      return i.key === 'roles';
    }),
    'Roles stays OwnerOnly even with full perms'
  );
}

function landingFor(name, modulesOn) {
  const sandbox = loadShared();
  const f = FIXTURES[name];
  const token = fixtureToken(f.role, f.perms);
  const registry = {};
  (sandbox.GfpFeatures.FEATURE_MODULES || []).forEach(function (k) {
    registry[k] = modulesOn(k);
  });
  const cats = sandbox.GfpNav.useVisibleNav(registry, {
    accessToken: token,
    role: f.role
  });
  return sandbox.GfpNav.getDefaultLandingPath(cats);
}

assert(landingFor('Owner', ALL_ON) === '/dashboard/', 'Owner lands Dashboard');
assert(landingFor('Manager', ALL_ON) === '/dashboard/', 'Manager lands Dashboard');
assert(landingFor('Trainer', ALL_ON) === '/dashboard/', 'Trainer lands Dashboard (first of overview)');
assert(landingFor('Receptionist', ALL_ON) === '/dashboard/', 'Receptionist lands Dashboard');

// Empty claims → no landing / empty categories (no dead groups)
{
  const sandbox = loadShared();
  const token = fixtureToken('Receptionist', []);
  const registry = {};
  sandbox.GfpFeatures.FEATURE_MODULES.forEach(function (k) {
    registry[k] = true;
  });
  const cats = sandbox.GfpNav.useVisibleNav(registry, {
    accessToken: token,
    role: 'Receptionist'
  });
  assert(cats.length >= 1, 'AnyStaff still has overview even with zero perms');
  assert(sandbox.GfpNav.getDefaultLandingPath(cats) === '/dashboard/', 'zero-perm staff lands Dashboard');
}

// Truly empty: Member role with no staff access simulation — filter with role Member
{
  const sandbox = loadShared();
  const token = fixtureToken('Member', []);
  const registry = {};
  sandbox.GfpFeatures.FEATURE_MODULES.forEach(function (k) {
    registry[k] = true;
  });
  const cats = sandbox.GfpNav.useVisibleNav(registry, {
    accessToken: token,
    role: 'Member'
  });
  assert(cats.length === 0, 'Member role yields empty visible nav');
  assert(sandbox.GfpNav.getDefaultLandingPath(cats) === null, 'empty nav → null landing');
}

console.log('apps/web nav.selftest: OK (Owner/Manager/Trainer/Receptionist + inventory + landing/empty)');
