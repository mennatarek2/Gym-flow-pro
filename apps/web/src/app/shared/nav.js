/**
 * Declarative navigation registry (§0.4) — apps/web.
 * Data only (no DOM). Icons are Tabler class names (`ti-*`).
 *
 * Category table (staff console IA):
 * | Category        | Items                                                         |
 * |-----------------|---------------------------------------------------------------|
 * | Overview        | Dashboard                                                     |
 * | Members         | Members, Attendance                                           |
 * | Front desk      | Sale, Member Orders, Debtors, Call sheet                      |
 * | Money           | Shifts, Refunds, Promo codes, Invoices, Z-Report, Reports     |
 * | Catalog         | Plans                                                         |
 * | Inventory       | Overview, On Hand, Move, Count, Insights, Products, Suppliers,  |
 * |                 | Warehouses (Buy/Adjust contextual from On Hand; Sell → Front Desk)|
 * | Administration  | Import, Audit, Notifications, Staff, Settings                 |
 */
(function (global) {
  'use strict';

  /**
   * @typedef {|
   *   { kind: 'permission', value: string|string[] } |
   *   { kind: 'policy', value: 'OwnerOnly'|'ManagerOrAbove'|'AnyStaff' } |
   *   { kind: 'any' }
   * } NavAccess
   */

  /**
   * @typedef {{
   *   key: string,
   *   label: string,
   *   labelAr: string,
   *   path: string,
   *   icon: string,
   *   access: NavAccess,
   *   featureFlag?: 'sales'|'shifts'|'trials'|'refunds'|'debtors'|'imports'|'inventory',
   *   featureFlags?: Array<'sales'|'shifts'|'trials'|'refunds'|'debtors'|'imports'|'inventory'>
   * }} NavItem
   */

  /**
   * @typedef {{ key: string, label: string, labelAr: string, items: NavItem[] }} NavCategory
   */

  /** @type {NavCategory[]} */
  var NAV_CATEGORIES = [
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
    },
    {
      key: 'members',
      label: 'Members',
      labelAr: 'الأعضاء',
      items: [
        {
          key: 'members',
          label: 'Members',
          labelAr: 'الأعضاء',
          path: '/dashboard/members/',
          icon: 'ti-users',
          access: { kind: 'permission', value: 'members.view' }
        },
        {
          key: 'attendance',
          label: 'Attendance',
          labelAr: 'الحضور',
          path: '/dashboard/attendance/',
          icon: 'ti-door-enter',
          access: { kind: 'permission', value: ['checkin.manual', 'members.view'] }
        }
      ]
    },
    {
      key: 'front-desk',
      label: 'Front desk',
      labelAr: 'مكتب الاستقبال',
      items: [
        {
          key: 'pos',
          // Retail / general sales — membership onboarding lives in Members
          label: 'Sale',
          labelAr: 'بيع',
          path: '/dashboard/pos/?mode=retail',
          icon: 'ti-shopping-cart',
          access: { kind: 'permission', value: 'sales.sell' },
          featureFlag: 'sales'
        },
        {
          key: 'member-orders',
          label: 'Member Orders',
          labelAr: 'طلبات الأعضاء',
          path: '/dashboard/member-orders/',
          icon: 'ti-shopping-bag',
          // Prefer orders.* when backend ships them; sales.sell covers front-desk staff today
          access: {
            kind: 'permission',
            value: ['sales.sell', 'orders.view', 'orders.fulfill', 'memberorders.view', 'memberorders.manage']
          }
        },
        {
          key: 'debtors',
          label: 'Debtors',
          labelAr: 'المدينون',
          path: '/dashboard/debtors/',
          icon: 'ti-cash-off',
          access: { kind: 'permission', value: 'sales.sell' },
          featureFlag: 'debtors'
        },
        {
          key: 'call-sheet',
          label: 'Call sheet',
          labelAr: 'ورقة المتابعة',
          path: '/dashboard/call-sheet/',
          icon: 'ti-phone-call',
          access: { kind: 'permission', value: 'sales.sell' }
          // never featureFlag — Call Sheet is not flag-gated (§0.8)
        }
      ]
    },
    {
      key: 'money',
      label: 'Money',
      labelAr: 'المالية',
      items: [
        {
          key: 'shifts',
          label: 'Shifts',
          labelAr: 'الورديات',
          path: '/dashboard/shifts/',
          icon: 'ti-cash',
          access: { kind: 'permission', value: ['shift.open', 'shift.close'] },
          featureFlag: 'shifts'
        },
        {
          key: 'refunds',
          label: 'Refunds',
          labelAr: 'المرتجعات',
          path: '/dashboard/refunds/',
          icon: 'ti-receipt-refund',
          access: {
            kind: 'permission',
            value: ['payments.refund.request', 'payments.refund.approve']
          },
          featureFlag: 'refunds'
        },
        {
          key: 'promo-codes',
          label: 'Promo codes',
          labelAr: 'أكواد الخصم',
          path: '/dashboard/promo-codes/',
          icon: 'ti-discount-2',
          access: { kind: 'permission', value: ['sales.sell', 'plans.manage'] },
          featureFlag: 'sales'
        },
        {
          key: 'invoices',
          label: 'Invoices',
          labelAr: 'الفواتير',
          path: '/dashboard/invoices/',
          icon: 'ti-file-invoice',
          access: { kind: 'permission', value: 'reports.financial.view' }
        },
        {
          key: 'z-report',
          label: 'Z-Report',
          labelAr: 'تقرير Z',
          path: '/dashboard/z-report/',
          icon: 'ti-report-money',
          access: { kind: 'permission', value: 'reports.financial.view' }
        },
        {
          key: 'reports',
          label: 'Reports',
          labelAr: 'التقارير',
          path: '/dashboard/reports/',
          icon: 'ti-chart-bar',
          access: {
            kind: 'permission',
            value: ['reports.financial.view', 'members.view']
          }
        }
      ]
    },
    {
      key: 'catalog',
      label: 'Catalog',
      labelAr: 'الباقات',
      items: [
        {
          key: 'plans',
          label: 'Plans',
          labelAr: 'الباقات',
          path: '/dashboard/plans/',
          icon: 'ti-package',
          access: { kind: 'permission', value: 'plans.manage' }
        }
      ]
    },
    {
      key: 'inventory',
      label: 'Inventory',
      labelAr: 'المخزون',
      items: [
        {
          key: 'inv-home',
          label: 'Overview',
          labelAr: 'نظرة عامة',
          path: '/dashboard/inventory/',
          icon: 'ti-gauge',
          access: { kind: 'permission', value: 'inventory.view' },
          featureFlag: 'inventory'
        },
        {
          key: 'inv-stock',
          // Primary stock workspace — Buy & receive / Adjust quantity launch from product detail
          label: 'On Hand',
          labelAr: 'الرصيد',
          path: '/dashboard/inventory/stock/',
          icon: 'ti-stack-2',
          access: { kind: 'permission', value: 'inventory.view' },
          featureFlag: 'inventory'
        },
        {
          key: 'inv-transfers',
          label: 'Move stock',
          labelAr: 'نقل مخزون',
          path: '/dashboard/inventory/transfers/',
          icon: 'ti-arrows-exchange',
          access: { kind: 'permission', value: 'inventory.transfer' },
          featureFlag: 'inventory'
        },
        {
          key: 'inv-counts',
          label: 'Count stock',
          labelAr: 'جرد',
          path: '/dashboard/inventory/counts/',
          icon: 'ti-clipboard-check',
          access: { kind: 'permission', value: 'inventory.adjust' },
          featureFlag: 'inventory'
        },
        {
          key: 'inv-reports',
          label: 'Insights',
          labelAr: 'رؤى وتقارير',
          path: '/dashboard/inventory/reports/',
          icon: 'ti-chart-histogram',
          access: { kind: 'permission', value: 'inventory.view' },
          featureFlag: 'inventory'
        },
        {
          key: 'inv-products',
          label: 'Products',
          labelAr: 'المنتجات',
          path: '/dashboard/inventory/products/',
          icon: 'ti-box',
          access: { kind: 'permission', value: ['inventory.manage', 'inventory.purchase'] },
          featureFlag: 'inventory'
        },
        {
          key: 'inv-suppliers',
          label: 'Suppliers',
          labelAr: 'الموردون',
          path: '/dashboard/inventory/suppliers/',
          icon: 'ti-truck',
          access: { kind: 'permission', value: ['inventory.purchase', 'inventory.manage'] },
          featureFlag: 'inventory'
        },
        {
          key: 'inv-warehouses',
          label: 'Warehouses',
          labelAr: 'المستودعات',
          path: '/dashboard/inventory/warehouses/',
          icon: 'ti-building-warehouse',
          access: { kind: 'permission', value: 'inventory.manage' },
          featureFlag: 'inventory'
        }
      ]
    },
    {
      key: 'administration',
      label: 'Administration',
      labelAr: 'الإدارة',
      items: [
        {
          key: 'imports',
          label: 'Import',
          labelAr: 'الاستيراد',
          path: '/dashboard/imports/',
          icon: 'ti-file-import',
          access: { kind: 'permission', value: 'settings.manage' },
          featureFlag: 'imports'
        },
        {
          key: 'audit',
          label: 'Audit',
          labelAr: 'التدقيق',
          path: '/dashboard/audit/',
          icon: 'ti-list-search',
          access: { kind: 'permission', value: 'settings.manage' }
        },
        {
          key: 'notifications',
          label: 'Notifications',
          labelAr: 'الإشعارات',
          path: '/dashboard/notifications/',
          icon: 'ti-bell',
          access: { kind: 'any' }
        },
        {
          key: 'staff',
          label: 'Staff',
          labelAr: 'الموظفون',
          path: '/dashboard/staff/',
          icon: 'ti-user-shield',
          access: { kind: 'policy', value: 'OwnerOnly' }
        },
        {
          key: 'settings',
          label: 'Settings',
          labelAr: 'الإعدادات',
          path: '/dashboard/settings/',
          icon: 'ti-settings',
          access: { kind: 'policy', value: 'OwnerOnly' }
        }
      ]
    }
  ];

  var NAV_ITEMS = NAV_CATEGORIES.reduce(function (acc, cat) {
    return acc.concat(cat.items);
  }, []);

  /**
   * Never branch on role string for permission items — use access + claims.
   * @param {NavAccess} access
   * @param {{ accessToken?: string|null, role?: string|null, Authz?: object }} [opts]
   */
  function canAccess(access, opts) {
    opts = opts || {};
    var Authz = opts.Authz || global.GfpAuthz;
    if (!Authz) return false;
    var token = opts.accessToken != null ? opts.accessToken : Authz.getAccessToken();
    var role = opts.role != null ? opts.role : Authz.getUserRole();

    if (!access || !access.kind) return false;
    if (access.kind === 'permission') {
      return Authz.canPermission(token, access.value);
    }
    if (access.kind === 'policy') {
      return Authz.matchesRolePolicy(role, access.value);
    }
    if (access.kind === 'any') {
      return Authz.matchesRolePolicy(role, 'AnyStaff');
    }
    return false;
  }

  /**
   * @param {NavItem} item
   * @param {Record<string,boolean>|null} registry
   * @param {{ accessToken?: string|null, role?: string|null }} [opts]
   */
  function isNavItemVisible(item, registry, opts) {
    opts = opts || {};
    var Features = global.GfpFeatures;
    var flags = item.featureFlags;
    if (flags && flags.length) {
      if (!Features) return false;
      for (var i = 0; i < flags.length; i++) {
        if (!Features.isModuleAvailable(flags[i], registry)) return false;
      }
    } else if (item.featureFlag) {
      if (!Features || !Features.isModuleAvailable(item.featureFlag, registry)) {
        return false;
      }
    }
    return canAccess(item.access, opts);
  }

  /**
   * Filters categories by useCan(access) + feature-flag registry; drops empty categories.
   * Re-evaluate on login/refresh only (claims baked into JWT) — not on a timer.
   * @param {Record<string,boolean>|null} [registry]
   * @param {{ accessToken?: string|null, role?: string|null, categories?: NavCategory[] }} [opts]
   * @returns {NavCategory[]}
   */
  function useVisibleNav(registry, opts) {
    opts = opts || {};
    var cats = opts.categories || NAV_CATEGORIES;
    if (registry === undefined) {
      registry = (global.GfpFeatures && global.GfpFeatures.readCache()) || null;
    }
    return cats
      .map(function (cat) {
        return {
          key: cat.key,
          label: cat.label,
          labelAr: cat.labelAr,
          items: cat.items.filter(function (item) {
            return isNavItemVisible(item, registry, opts);
          })
        };
      })
      .filter(function (cat) {
        return cat.items.length > 0;
      });
  }

  /**
   * Default landing = first item of first non-empty filtered category.
   * Not hardcoded by role — adapts when claims / flags change.
   * @param {NavCategory[]} [categories]
   * @returns {string|null}
   */
  function getDefaultLandingPath(categories) {
    var cats = categories;
    if (!cats) {
      cats = useVisibleNav();
    }
    if (!cats || !cats.length) return null;
    var first = cats[0];
    if (!first.items || !first.items.length) return null;
    return first.items[0].path || null;
  }

  global.GfpNav = {
    NAV_CATEGORIES: NAV_CATEGORIES,
    NAV_ITEMS: NAV_ITEMS,
    canAccess: canAccess,
    isNavItemVisible: isNavItemVisible,
    useVisibleNav: useVisibleNav,
    getDefaultLandingPath: getDefaultLandingPath
  };
  global.useVisibleNav = useVisibleNav;
})(typeof window !== 'undefined' ? window : globalThis);
