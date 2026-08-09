/**
 * GymFlowPro web — shared API origin.
 * Override at runtime: window.API_BASE = 'http://localhost:5000/api'
 *
 * Default: ngrok-tunneled API (must end with /api).
 */
(function (global) {
  var DEFAULT_API_BASE = 'https://reach-lullaby-tighten.ngrok-free.dev/api';
  if (!global.API_BASE) {
    global.API_BASE = DEFAULT_API_BASE;
  }
  global.GFP_DEFAULT_API_BASE = DEFAULT_API_BASE;
})(typeof window !== 'undefined' ? window : globalThis);
