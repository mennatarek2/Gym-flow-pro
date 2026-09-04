/**
 * HyMotion web — shared API origin.
 * Production (same host as API): uses window.location.origin + '/api'
 * Override: <meta name="gfp-api-base" content="https://your-domain.com/api">
 * Dev persist: localStorage.gfp_api_base
 * Dev default: local HTTPS API (https://localhost:5001/api).
 * Local API must be started with: dotnet run --launch-profile https
 * See docs/getting-started/STAFF_WEB_LOCAL_HTTPS.md (W-04).
 * Remote environments must opt in through the meta tag or gfp_api_base storage key.
 */
(function (global) {
  var LOCAL_API = 'https://localhost:5001/api';

  function normalizeApiBase(raw) {
    if (!raw) return '';
    var c = String(raw).trim().replace(/\/+$/, '');
    if (!c) return '';
    return c.endsWith('/api') ? c : c + '/api';
  }

  function resolveDefaultBase() {
    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
      return LOCAL_API;
    }
    var meta = document.querySelector('meta[name="gfp-api-base"]');
    if (meta && meta.getAttribute('content')) {
      var fromMeta = normalizeApiBase(meta.getAttribute('content'));
      if (fromMeta) return fromMeta;
    }
    try {
      var stored = normalizeApiBase(localStorage.getItem('gfp_api_base') || sessionStorage.getItem('gfp_api_base'));
      if (stored) return stored;
    } catch (e) { /* ignore */ }
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return LOCAL_API;
    }
    return window.location.origin + '/api';
  }

  var DEFAULT_API_BASE = resolveDefaultBase();
  if (!global.API_BASE) {
    global.API_BASE = DEFAULT_API_BASE;
  }
  global.GFP_DEFAULT_API_BASE = DEFAULT_API_BASE;
})(typeof window !== 'undefined' ? window : globalThis);
