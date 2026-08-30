/**
 * GymFlowPro web — shared API origin.
 * Production (same host as API): uses window.location.origin + '/api'
 * Override: <meta name="gfp-api-base" content="https://your-tunnel.ngrok-free.dev/api">
 * Dev persist: localStorage.gfp_api_base
 * Dev override: window.API_BASE = 'http://localhost:5000/api'
 */
(function (global) {
  function normalizeApiBase(raw) {
    if (!raw) return '';
    var c = String(raw).trim().replace(/\/+$/, '');
    if (!c) return '';
    return c.endsWith('/api') ? c : c + '/api';
  }

  function resolveDefaultBase() {
    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
      return 'http://localhost:5000/api';
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
      // http://localhost:5000 307-redirects to https://localhost:5001, which breaks CORS
      // preflight — call the HTTPS origin directly.
      return 'https://localhost:5001/api';
    }
    return window.location.origin + '/api';
  }

  var DEFAULT_API_BASE = resolveDefaultBase();
  if (!global.API_BASE) {
    global.API_BASE = DEFAULT_API_BASE;
  }
  global.GFP_DEFAULT_API_BASE = DEFAULT_API_BASE;
})(typeof window !== 'undefined' ? window : globalThis);
