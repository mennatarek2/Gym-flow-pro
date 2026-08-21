/**
 * GymFlowPro web — shared API origin.
 * Production (same host as API): uses window.location.origin + '/api'
 * Override: <meta name="gfp-api-base" content="https://your-domain.com/api">
 * Dev override: window.API_BASE = 'http://localhost:5000/api'
 */
(function (global) {
  function resolveDefaultBase() {
    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
      return 'http://localhost:5000/api';
    }
    var meta = document.querySelector('meta[name="gfp-api-base"]');
    if (meta && meta.getAttribute('content')) {
      var c = meta.getAttribute('content').trim().replace(/\/+$/, '');
      return c.endsWith('/api') ? c : c + '/api';
    }
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:5000/api';
    }
    return window.location.origin + '/api';
  }

  var DEFAULT_API_BASE = resolveDefaultBase();
  if (!global.API_BASE) {
    global.API_BASE = DEFAULT_API_BASE;
  }
  global.GFP_DEFAULT_API_BASE = DEFAULT_API_BASE;
})(typeof window !== 'undefined' ? window : globalThis);
