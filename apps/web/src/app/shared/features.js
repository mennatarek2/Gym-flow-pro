/**
 * GymFlowPro — feature-flag module probe + cached registry (§0.8).
 * FEATURE_DISABLED (404 ProblemDetails title) → module unavailable (hide from nav).
 * Network errors: fail-open for core modules; fail-closed for stock_management (Growth desk).
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'gfp_feature_modules_v3';
  var CACHE_TTL_MS = 10 * 60 * 1000;

  var FEATURE_MODULES = [
    'sales',
    'shifts',
    'trials',
    'refunds',
    'debtors',
    'imports',
    'inventory',
    'stock_management'
  ];

  /** Modules that must stay OFF when probe fails (tier packaging, not core POS). */
  var FAIL_CLOSED = { stock_management: true };

  var PROBES = {
    sales: { method: 'GET', path: '/promo-codes?page=1&pageSize=1' },
    shifts: { method: 'GET', path: '/shifts/current' },
    trials: { method: 'POST', path: '/trials/confirm', body: { phoneNumber: '0000000000', otp: '000000' } },
    refunds: { method: 'GET', path: '/refunds' },
    debtors: { method: 'GET', path: '/debtors?page=1&pageSize=1' },
    imports: { method: 'GET', path: '/imports/template.xlsx', raw: true },
    // INVS: cheapest inventory read — FEATURE_DISABLED → hide Inventory nav
    inventory: { method: 'GET', path: '/inventory/categories' },
    // Pro+ Move/Count engines — Growth/Starter Products desk only
    stock_management: { method: 'GET', path: '/inventory/transfers' }
  };

  function readCache() {
    try {
      var raw = global.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.at || !parsed.modules) return null;
      if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
      return parsed.modules;
    } catch (e) {
      return null;
    }
  }

  function writeCache(modules) {
    try {
      global.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), modules: modules }));
    } catch (e) { /* ignore */ }
  }

  function clearCache() {
    try { global.sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
    try { global.sessionStorage.removeItem('gfp_feature_modules_v2'); } catch (e) { /* ignore */ }
    try { global.sessionStorage.removeItem('gfp_feature_modules_v1'); } catch (e) { /* ignore */ }
  }

  function isFeatureDisabled(result) {
    if (!result) return false;
    if (result.status !== 404) return false;
    var err = result.error;
    if (err && err.code === 'FEATURE_DISABLED') return true;
    var d = result.data;
    if (d && typeof d === 'object' && d.title === 'FEATURE_DISABLED') return true;
    return false;
  }

  async function probeModuleAvailable(module) {
    var probe = PROBES[module];
    if (!probe) return !FAIL_CLOSED[module];
    try {
      var Gfp = global.GfpApi;
      if (!Gfp) return !FAIL_CLOSED[module];
      var opts = { auth: true };
      if (probe.raw) opts.raw = true;
      var r;
      if (probe.method === 'POST') {
        r = await Gfp.post(probe.path, probe.body || {}, opts);
      } else {
        r = await Gfp.get(probe.path, opts);
      }

      // imports: raw Response — check JSON ProblemDetails on 404
      if (probe.raw && r.response) {
        if (r.status === 404) {
          var ct = (r.headers && r.headers.get('content-type')) || '';
          if (ct.indexOf('application/json') !== -1) {
            try {
              var body = await r.response.clone().json();
              if (body && body.title === 'FEATURE_DISABLED') return false;
            } catch (e) { /* ignore */ }
          }
          return true;
        }
        return true;
      }

      if (isFeatureDisabled(r)) return false;
      return true;
    } catch (e) {
      return !FAIL_CLOSED[module];
    }
  }

  async function probeAllModules(force) {
    if (!force) {
      var cached = readCache();
      if (cached) return cached;
    }
    var modules = {};
    await Promise.all(
      FEATURE_MODULES.map(async function (key) {
        modules[key] = await probeModuleAvailable(key);
      })
    );
    writeCache(modules);
    return modules;
  }

  function isModuleAvailable(key, registry) {
    if (!key) return true;
    // null/undefined registry = probes not finished — treat as unavailable so nav is not
    // clickable-but-broken before FEATURE_DISABLED is known.
    if (registry == null) return false;
    if (registry[key] === undefined) return false;
    return !!registry[key];
  }

  var GfpFeatures = {
    FEATURE_MODULES: FEATURE_MODULES,
    probeModuleAvailable: probeModuleAvailable,
    probeAllModules: probeAllModules,
    isModuleAvailable: isModuleAvailable,
    clearCache: clearCache,
    readCache: readCache
  };

  global.GfpFeatures = GfpFeatures;
})(typeof window !== 'undefined' ? window : globalThis);
