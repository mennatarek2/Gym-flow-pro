/**
 * Classes front-desk (Front desk → Classes).
 * Day-based session timeline, booking management, check-in.
 * Perm: members.view.
 */
(function () {
  var Gfp = window.GfpApi;
  var Authz = window.GfpAuthz;

  function getUser() {
    if (Gfp && Gfp.tokens) return Gfp.tokens.getUser();
    try { return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user')); }
    catch (e) { return null; }
  }

  var user = getUser();
  if (!user) { window.location.href = '/auth/login/'; return; }
  var canView = Authz ? Authz.canPermission(Authz.getAccessToken(), 'members.view') : false;
  if (!canView) { window.location.href = '/dashboard/'; return; }

  var ini = (user.fullName || 'U').split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
  var avatarEl = document.getElementById('userAvatar');
  var nameEl = document.getElementById('userName');
  var roleEl = document.getElementById('userRole');
  if (avatarEl) avatarEl.textContent = ini;
  if (nameEl) nameEl.textContent = user.fullName || 'User';
  if (roleEl) roleEl.textContent = user.role || 'Staff';

  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', function () {
    if (Gfp) Gfp.logout(); else window.location.href = '/auth/login/';
  });

  (async function loadGymHeader() {
    if (!Gfp) return;
    var r = await Gfp.get('/settings');
    if (r.ok && r.data) {
      var gn = document.getElementById('gymName');
      var ga = document.getElementById('gymNameAr');
      if (gn) gn.textContent = r.data.gymName || '';
      if (ga) ga.textContent = r.data.gymNameAr || '';
    }
  })();

  // ── State ──
  var selectedDate = todayStr();
  var allSessions = [];
  var currentSession = null;
  var sessionsList = document.getElementById('sessionsList');

  // ── Helpers ──
  function toast(msg, type) {
    type = type || 'success';
    var t = document.getElementById('toast');
    var icon = type === 'success' ? 'ti-check' : 'ti-alert-circle';
    t.innerHTML = '<i class="ti ' + icon + '"></i>' + msg;
    t.className = 'toast ' + type + ' show';
    setTimeout(function () { t.classList.remove('show'); }, 4000);
  }

  function errMsg(r) {
    if (!r) return 'Request failed';
    if (r.error && r.error.message) return r.error.message;
    if (r.data) return r.data.message || r.data.error || 'Request failed';
    return 'Request failed';
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    var opts = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
    return d.toLocaleDateString('en-US', opts);
  }

  function fmtTime(t) {
    if (!t) return '';
    var s = String(t);
    // ISO datetime
    if (s.includes('T')) {
      var dt = new Date(s);
      return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    if (s.length >= 5) return s.slice(0, 5);
    return s;
  }

  function fmtTimeShort(iso) {
    if (!iso) return '';
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return fmtTime(iso);
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function openOverlay(id) { document.getElementById(id).classList.add('show'); }
  function closeOverlay(id) { document.getElementById(id).classList.remove('show'); }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ── Date Navigation ──
  var dateDisplay = document.getElementById('dateDisplay');
  var datePick = document.getElementById('datePick');

  function updateDateUI() {
    dateDisplay.textContent = fmtDate(selectedDate);
    datePick.value = selectedDate;
  }

  document.getElementById('btnPrev').addEventListener('click', function () {
    selectedDate = addDays(selectedDate, -1);
    updateDateUI();
    loadSessions();
  });
  document.getElementById('btnNext').addEventListener('click', function () {
    selectedDate = addDays(selectedDate, 1);
    updateDateUI();
    loadSessions();
  });
  document.getElementById('btnToday').addEventListener('click', function () {
    selectedDate = todayStr();
    updateDateUI();
    loadSessions();
  });
  datePick.addEventListener('change', function () {
    if (this.value) {
      selectedDate = this.value;
      updateDateUI();
      loadSessions();
    }
  });
  document.getElementById('btnRefresh').addEventListener('click', function () { loadSessions(); });

  updateDateUI();

  // ── Load Sessions ──
  async function loadSessions() {
    sessionsList.innerHTML = '<div class="loading-state"><div class="loader"></div><p>Loading sessions...</p></div>';
    if (!Gfp) {
      sessionsList.innerHTML = '<div class="empty-state"><div class="empty-title">API client missing</div></div>';
      return;
    }
    var r = await Gfp.get('/activity-sessions?date=' + selectedDate);
    if (!r.ok) {
      sessionsList.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ti ti-alert-circle"></i></div><div class="empty-title">Could not load sessions</div><div class="empty-desc">' + esc(errMsg(r)) + '</div></div>';
      return;
    }
    allSessions = Array.isArray(r.data) ? r.data : (r.data && r.data.items ? r.data.items : []);

    // Sort by start time
    allSessions.sort(function (a, b) {
      var ta = a.startsAtUtc || a.startsAt || a.startTime || '';
      var tb = b.startsAtUtc || b.startsAt || b.startTime || '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    renderSessions();
    updateStats();
  }

  function getSessionStatus(s) {
    if (s.status === 'cancelled') return 'cancelled';
    var booked = s.bookedCount || s.bookingsCount || 0;
    var cap = s.capacity || 0;
    if (cap > 0 && booked >= cap) return 'full';
    if (s.status === 'completed') return 'completed';
    if (s.status === 'in_progress') return 'in-progress';
    return 'upcoming';
  }

  function updateStats() {
    document.getElementById('statSessions').textContent = allSessions.length;
    var totalBooked = 0;
    var totalCheckedIn = 0;
    allSessions.forEach(function (s) {
      totalBooked += s.bookedCount || s.bookingsCount || 0;
      totalCheckedIn += s.checkedInCount || 0;
    });
    document.getElementById('statBooked').textContent = totalBooked;
    document.getElementById('statCheckedIn').textContent = totalCheckedIn;
  }

  function renderSessions() {
    if (!allSessions.length) {
      sessionsList.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ti ti-calendar-off"></i></div><div class="empty-title">No Sessions</div><div class="empty-desc">No classes scheduled for this day.</div></div>';
      return;
    }
    sessionsList.innerHTML = allSessions.map(buildSessionCard).join('');
    sessionsList.querySelectorAll('.session-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var id = this.dataset.sessionId;
        openSessionDrawer(id);
      });
    });
  }

  function buildSessionCard(s) {
    var status = getSessionStatus(s);
    var startTime = fmtTimeShort(s.startsAtUtc || s.startsAt || s.startTime);
    var endTime = fmtTimeShort(s.endsAtUtc || s.endsAt || s.endTime);
    var actName = s.activityName || s.activity?.name || 'Class';
    var coach = s.coachName || s.coach?.fullName || '';
    var booked = s.bookedCount || s.bookingsCount || 0;
    var cap = s.capacity || 0;
    var pct = cap > 0 ? Math.min(100, Math.round((booked / cap) * 100)) : 0;

    var statusBadge = '';
    if (status === 'full') statusBadge = '<span class="sess-status full-badge">FULL</span>';
    else if (status === 'in-progress') statusBadge = '<span class="sess-status in-progress">IN PROGRESS</span>';
    else if (status === 'completed') statusBadge = '<span class="sess-status completed-badge">COMPLETED</span>';
    else if (status === 'cancelled') statusBadge = '<span class="sess-status cancelled-badge">CANCELLED</span>';
    else statusBadge = '<span class="sess-status upcoming">UPCOMING</span>';

    var cardClass = 'session-card';
    if (status === 'full') cardClass += ' full';
    if (status === 'completed') cardClass += ' completed';

    return '<div class="' + cardClass + '" data-session-id="' + s.id + '">' +
      '<div class="sess-time"><div class="sess-time-start">' + esc(startTime) + '</div><div class="sess-time-end">' + esc(endTime) + '</div></div>' +
      '<div class="sess-div"></div>' +
      '<div class="sess-info"><div class="sess-name">' + esc(actName) + '</div>' +
      '<div class="sess-meta">' +
      (coach ? '<span class="sess-meta-item"><i class="ti ti-user"></i>' + esc(coach) + '</span>' : '') +
      (s.defaultDurationMinutes || s.durationMinutes ? '<span class="sess-meta-item"><i class="ti ti-clock"></i>' + (s.defaultDurationMinutes || s.durationMinutes) + ' min</span>' : '') +
      '</div></div>' +
      '<div class="sess-capacity">' +
      (cap > 0 ? '<div class="cap-bar"><div class="cap-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="cap-text ' + (status === 'full' ? 'full-text' : '') + '">' + booked + ' / ' + cap + '</div>' : '<div class="cap-text">' + booked + ' booked</div>') +
      '</div>' +
      statusBadge +
      '</div>';
  }

  // ── Session Detail Drawer ──
  async function openSessionDrawer(sessionId) {
    var r = await Gfp.get('/activity-sessions/' + sessionId);
    if (!r.ok || !r.data) {
      toast(errMsg(r), 'error');
      return;
    }
    currentSession = r.data;
    renderDrawer();
    openOverlay('drawerOverlay');
  }

  function renderDrawer() {
    var s = currentSession;
    if (!s) return;
    var drawer = document.getElementById('drawerContent');
    var actName = s.activityName || s.activity?.name || 'Class';
    var startTime = fmtTimeShort(s.startsAtUtc || s.startsAt || s.startTime);
    var endTime = fmtTimeShort(s.endsAtUtc || s.endsAt || s.endTime);
    var coach = s.coachName || s.coach?.fullName || '';
    var booked = s.bookedCount || s.bookingsCount || 0;
    var cap = s.capacity || 0;
    var status = getSessionStatus(s);
    var isFull = status === 'full';
    var bookings = s.bookings || [];

    drawer.innerHTML =
      '<div class="drawer-hdr"><div><h2>' + esc(actName) + '</h2>' +
      '<div class="drawer-hdr-sub">' + fmtDate(selectedDate) + '</div></div>' +
      '<button class="drawer-close" id="drawerClose"><i class="ti ti-x"></i></button></div>' +

      '<div class="drawer-body">' +
      '<div class="sess-summary">' +
      '<div class="sess-summary-row"><i class="ti ti-clock"></i><strong>' + esc(startTime) + ' – ' + esc(endTime) + '</strong></div>' +
      (coach ? '<div class="sess-summary-row"><i class="ti ti-user"></i>' + esc(coach) + '</div>' : '') +
      '<div class="sess-summary-row"><i class="ti ti-users"></i>' + booked + ' / ' + (cap || '∞') + ' booked</div>' +
      '</div>' +

      '<div class="booking-list-hdr">' +
      '<div class="booking-list-title">Bookings (' + bookings.length + ')</div>' +
      '<button class="btn-add-booking" id="btnAddBooking"' + (isFull ? ' disabled title="Session is full"' : '') + '><i class="ti ti-plus"></i> Book Member</button></div>' +

      '<div class="booking-list" id="bookingList">' +
      (bookings.length ? bookings.map(buildBookingRow).join('') : '<div class="booking-empty"><i class="ti ti-calendar-off"></i>No bookings yet</div>') +
      '</div></div>';

    document.getElementById('drawerClose').addEventListener('click', function () { closeOverlay('drawerOverlay'); });

    document.getElementById('btnAddBooking').addEventListener('click', function () {
      showBookModal(s.id);
    });

    // Booking action buttons
    drawer.querySelectorAll('[data-bk-action]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var action = this.dataset.bkAction;
        var bkId = this.dataset.bkId;
        this.disabled = true;

        var res;
        if (action === 'checkin') {
          res = await Gfp.put('/activity-bookings/' + bkId + '/check-in');
        } else if (action === 'cancel') {
          res = await Gfp.put('/activity-bookings/' + bkId + '/cancel');
        }

        if (res && res.ok) {
          toast(action === 'checkin' ? 'Checked in' : 'Booking cancelled');
          await openSessionDrawer(currentSession.id);
          loadSessions();
        } else {
          toast(errMsg(res), 'error');
          this.disabled = false;
        }
      });
    });
  }

  function buildBookingRow(bk) {
    var name = bk.memberName || bk.member?.fullName || 'Member';
    var ini = name.split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
    var st = (bk.status || 'booked').toLowerCase().replace(/\s+/g, '-');
    var statusLabel = bk.status || 'Booked';
    var statusIcon = 'ti-calendar-check';
    if (st === 'checked-in' || st === 'checked_in' || st === 'checkedin') { statusIcon = 'ti-door-enter'; st = 'checked-in'; statusLabel = 'Checked In'; }
    else if (st === 'cancelled') { statusIcon = 'ti-x'; }
    else if (st === 'no-show' || st === 'no_show' || st === 'noshow') { statusIcon = 'ti-alert-triangle'; st = 'no-show'; statusLabel = 'No Show'; }

    var actions = '';
    if (st === 'booked') {
      actions =
        '<button class="bk-btn checkin" data-bk-action="checkin" data-bk-id="' + bk.id + '"><i class="ti ti-door-enter"></i> Check In</button>' +
        '<button class="bk-btn cancel-bk" data-bk-action="cancel" data-bk-id="' + bk.id + '"><i class="ti ti-x"></i></button>';
    }

    return '<div class="booking-row">' +
      '<div class="booking-avatar">' + ini + '</div>' +
      '<div class="booking-info"><div class="booking-name">' + esc(name) + '</div>' +
      '<div class="booking-status ' + st + '"><i class="ti ' + statusIcon + '"></i> ' + esc(statusLabel) + '</div></div>' +
      '<div class="booking-actions">' + actions + '</div></div>';
  }

  // ── Book Member Modal ──
  var searchTimer = null;

  function showBookModal(sessionId) {
    var modal = document.getElementById('bookContent');
    modal.innerHTML =
      '<div class="modal-header"><div><h2>Book Member</h2>' +
      '<div class="modal-header-sub">Search and select a member to book into this session.</div></div>' +
      '<button type="button" class="modal-close" id="bookClose"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body">' +
      '<div class="search-wrap"><i class="ti ti-search search-icon"></i>' +
      '<input class="search-input" id="memberSearch" placeholder="Search by name or phone..." autofocus></div>' +
      '<div id="searchResults"></div></div>';

    openOverlay('bookOverlay');

    document.getElementById('bookClose').addEventListener('click', function () { closeOverlay('bookOverlay'); });

    var searchInput = document.getElementById('memberSearch');
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (q.length < 2) {
        document.getElementById('searchResults').innerHTML = '';
        return;
      }
      searchTimer = setTimeout(function () { searchMembers(q, sessionId); }, 300);
    });
  }

  async function searchMembers(query, sessionId) {
    var container = document.getElementById('searchResults');
    container.innerHTML = '<div class="search-empty">Searching...</div>';

    var r = await Gfp.get('/members?search=' + encodeURIComponent(query) + '&pageSize=10');
    if (!r.ok) {
      container.innerHTML = '<div class="search-empty">Search failed</div>';
      return;
    }

    var paged = Gfp.asPaged(r.data);
    var members = paged.items;
    if (!members.length) {
      container.innerHTML = '<div class="search-empty">No members found</div>';
      return;
    }

    container.innerHTML = '<div class="search-results">' + members.map(function (m) {
      var name = m.fullName || (m.firstName + ' ' + m.lastName) || 'Member';
      var phone = m.phoneNumber || m.phone || '';
      var ini = name.split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
      return '<div class="search-result" data-member-id="' + m.id + '">' +
        '<div class="booking-avatar">' + ini + '</div>' +
        '<div><div class="search-result-name">' + esc(name) + '</div>' +
        '<div class="search-result-sub">' + esc(phone) + '</div></div></div>';
    }).join('') + '</div>';

    container.querySelectorAll('.search-result').forEach(function (row) {
      row.addEventListener('click', async function () {
        var memberId = this.dataset.memberId;
        this.style.opacity = '0.5';
        this.style.pointerEvents = 'none';

        var res = await Gfp.post('/activity-bookings', {
          sessionId: sessionId,
          memberId: memberId
        });

        if (res && res.ok) {
          toast('Member booked');
          closeOverlay('bookOverlay');
          await openSessionDrawer(currentSession.id);
          loadSessions();
        } else {
          toast(errMsg(res), 'error');
          this.style.opacity = '1';
          this.style.pointerEvents = 'auto';
        }
      });
    });
  }

  // ── Overlay close ──
  document.getElementById('drawerOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeOverlay('drawerOverlay');
  });
  document.getElementById('bookOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeOverlay('bookOverlay');
  });

  // ── Init ──
  loadSessions();
})();
