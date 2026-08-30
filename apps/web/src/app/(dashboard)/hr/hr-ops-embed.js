/**
 * HR secondary-route helper.
 * Departments/Positions → HR Settings.
 * Shift templates stay on /hr/shifts (same tab) with a back-link to Schedule.
 * Do NOT open Staff/HR pages in target=_blank — sessionStorage auth does not carry to new tabs.
 */
(function () {
  'use strict';
  try {
    var u = new URL(window.location.href);
    var path = (u.pathname || '').toLowerCase();

    if (path.indexOf('/hr/departments') >= 0 && u.searchParams.get('embed') !== '1') {
      var hub = new URL('/dashboard/hr/settings/', window.location.origin);
      hub.searchParams.set('tab', 'departments');
      window.location.replace(hub.pathname + hub.search);
      return;
    }
    if (path.indexOf('/hr/positions') >= 0 && u.searchParams.get('embed') !== '1') {
      var hubP = new URL('/dashboard/hr/settings/', window.location.origin);
      hubP.searchParams.set('tab', 'positions');
      window.location.replace(hubP.pathname + hubP.search);
      return;
    }

    // Settings embeds still use ?embed=1
    if (u.searchParams.get('embed') === '1') {
      document.documentElement.classList.add('hr-embed');
    }
  } catch (e) {
    /* ignore */
  }
})();
