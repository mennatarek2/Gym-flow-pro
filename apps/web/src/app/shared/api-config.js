/**
 * GymFlowPro web — shared API origin.
 * Production (same host as API): uses window.location.origin + '/api'
 * Override: <meta name="gfp-api-base" content="https://your-domain.com/api">
 * Dev default: ngrok tunnel (Swagger origin)
 */
(function (global) {
  var NGROK_API = 'https://reach-lullaby-tighten.ngrok-free.dev/api';

  function resolveDefaultBase() {
    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
      return NGROK_API;
    }
    var meta = document.querySelector('meta[name="gfp-api-base"]');
    if (meta && meta.getAttribute('content')) {
      var c = meta.getAttribute('content').trim().replace(/\/+$/, '');
      return c.endsWith('/api') ? c : c + '/api';
    }
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return NGROK_API;
    }
    return window.location.origin + '/api';
  }

  var DEFAULT_API_BASE = resolveDefaultBase();
  if (!global.API_BASE) {
    global.API_BASE = DEFAULT_API_BASE;
  }
  global.GFP_DEFAULT_API_BASE = DEFAULT_API_BASE;
})(typeof window !== 'undefined' ? window : globalThis);
