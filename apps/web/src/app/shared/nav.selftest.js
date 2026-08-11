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

// Inventory IA: Sell / Buy & receive / Fix removed from nav (contextual or Front Desk).
// Move, Count, Insights, Products, Suppliers, Warehouses restored.
const INV_VIEW_KEYS = ['inv-home', 'inv-stock', 'inv-reports'];

const INV_ALL_KEYS = INV_VIEW_KEYS.concat([
  'inv-transfers',
  'inv-counts',
  'inv-products',
  'inv-suppliers',
  'inv-warehouses'
]).sort();

// Stable order as registered in nav.js
const INV_OWNER_KEYS = [
  'inv-home',
  'inv-stock',
  'inv-transfers',
  'inv-counts',
  'inv-reports',
  'inv-products',
  'inv-suppliers',
  'inv-warehouses'
];

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

assertShape('Owner', runFixture('Owner', ALL_ON), {
  overview: ['dashboard'],
  members: ['members', 'attendance'],
  'front-desk': ['pos', 'member-orders', 'debtors', 'call-sheet'],
  money: ['shifts', 'refunds', 'promo-codes', 'invoices', 'z-report', 'reports'],
  catalog: ['plans'],
  inventory: INV_OWNER_KEYS.slice(),
  administration: ['imports', 'audit', 'notifications', 'staff', 'settings']
});

assertShape('Manager', runFixture('Manager', ALL_ON), {
  overview: ['dashboard'],
  members: ['members', 'attendance'],
  'front-desk': ['pos', 'member-orders', 'debtors', 'call-sheet'],
  money: ['shifts', 'refunds', 'promo-codes', 'invoices', 'z-report', 'reports'],
  inventory: INV_OWNER_KEYS.slice(),
  administration: ['notifications']
});

assertShape('Trainer', runFixture('Trainer', ALL_ON), {
  overview: ['dashboard'],
  members: ['attendance'],
  administration: ['notifications']
});

assertShape('Receptionist', runFixture('Receptionist', ALL_ON), {
  overview: ['dashboard'],
  members: ['members', 'attendance'],
  'front-desk': ['pos', 'member-orders', 'debtors', 'call-sheet'],
  money: ['shifts', 'refunds', 'promo-codes', 'reports'],
  inventory: INV_VIEW_KEYS.slice(),
  administration: ['notifications']
});

// Receptionist: daily ops — no adjust/transfer/counts/catalog; Sell/Buy/Fix not in nav
{
  const inv = runFixture('Receptionist', ALL_ON).inventory || [];
  assert(!inv.includes('inv-adjustments'), 'Receptionist hides Adjustments nav');
  assert(!inv.includes('inv-transfers'), 'Receptionist hides Transfers nav');
  assert(!inv.includes('inv-counts'), 'Receptionist hides Counts nav');
  assert(!inv.includes('inv-products'), 'Receptionist hides demoted Products');
  assert(!inv.includes('inv-warehouses'), 'Receptionist hides demoted Warehouses');
  assert(!inv.includes('inv-suppliers'), 'Receptionist hides demoted Suppliers');
  assert(!inv.includes('inv-sell'), 'Sell products removed from Inventory nav');
  assert(!inv.includes('inv-purchase-orders'), 'Buy & receive removed from Inventory nav');
  assert(inv.includes('inv-stock'), 'Receptionist sees On Hand');
  assert(inv.includes('inv-home'), 'Receptionist sees Inventory Overview');
  assert(inv.includes('inv-reports'), 'Receptionist sees Insights');
}

// FEATURE_DISABLED sales — POS hidden from front desk; Inventory unchanged
{
  const actual = runFixture('Receptionist', function (k) {
    return k !== 'sales';
  });
  assert(!actual['front-desk'].includes('pos'), 'sales flag hides Sale');
  assert(actual['front-desk'].includes('debtors'), 'debtors use their own flag');
  assert(
    (actual.inventory || []).includes('inv-stock'),
    'Inventory On Hand stays when sales flag off'
  );
  assert(actual['front-desk'].includes('call-sheet'), 'Call sheet never flag-gated');
  assert(!actual.money.includes('promo-codes'), 'promo uses sales flag');
}

// FEATURE_DISABLED inventory — category gone
{
  const actual = runFixture('Owner', function (k) {
    return k !== 'inventory';
  });
  assert(!actual.inventory, 'inventory flag off hides Inventory category');
  assert(actual.catalog && actual.catalog.includes('plans'), 'Plans stays when inventory off');
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
  assert(
    inventory && inventory.items.length === INV_OWNER_KEYS.length,
    'full inventory perms show restored inventory nav items'
  );
  const admin = cats.find(function (c) {
    return c.key === 'administration';
  });
  assert(
    admin && !admin.items.some(function (i) {
      return i.key === 'staff';
    }),
    'Staff stays OwnerOnly even with full perms'
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
