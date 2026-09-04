/**
 * Classes front-desk (Front desk → Classes).
 * Activity → Schedule → Session board: day timeline, bookings, check-in.
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
  var canSell = Authz ? Authz.canPermission(Authz.getAccessToken(), 'sales.sell') : false;
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
  var dateMode = 'today'; // today | tomorrow | week | custom
  var allSessions = [];
  var weekSessions = [];
  var classActivities = [];
  var activityFilterId = '';
  var currentSession = null;
  var lastLoadError = null;
  var sessionsList = document.getElementById('sessionsList');
  var activityFilter = document.getElementById('activityFilter');

  function currentActivityId() {
    return (currentSession && (currentSession.activityId || (currentSession.activity && currentSession.activity.id))) || null;
  }

  // ── Helpers ──
  function toast(msg, type) {
    return globalThis.toastShared(msg, type);
  }

  function errMsg(r) {
    if (!r) return 'Request failed. Please try again.';
    if (r.error) {
      var m = r.error.message || '';
      if (/full/i.test(m)) return 'This class is full.';
      if (/payment required|drop-in/i.test(m)) return m;
      if (/already booked/i.test(m)) return 'This member is already booked into this session.';
      if (/quota|credits/i.test(m)) return 'Member has no class credits remaining.';
      if (/not eligible/i.test(m)) return 'Member is not eligible for this class.';
      if (/already checked in/i.test(m)) return 'Member is already checked in.';
      if (/stack|exception|at /i.test(m)) return 'Something went wrong. Please try again.';
      return m || 'Something went wrong. Please try again.';
    }
    if (r.data) {
      var d = r.data;
      var dm = d.message || d.error || '';
      if (typeof dm === 'string' && dm && !/stack|exception/i.test(dm)) return dm;
      if (d.title) return d.title;
    }
    return 'Something went wrong. Please try again.';
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDateShort(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function fmtTimeShort(iso) {
    if (!iso) return '';
    var s = String(iso);
    if (s.indexOf('T') >= 0) {
      var dt = new Date(s);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    if (s.length >= 5) {
      var parts = s.slice(0, 5).split(':');
      var h = parseInt(parts[0], 10);
      var m = parts[1] || '00';
      var ap = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12; if (h12 === 0) h12 = 12;
      return h12 + ':' + m + ' ' + ap;
    }
    return s;
  }

  function sessionStart(s) { return s.startsAtUtc || s.startsAt || s.startTime || ''; }
  function sessionEnd(s) { return s.endsAtUtc || s.endsAt || s.endTime || ''; }
  function sessionActivityName(s) {
    return (s.activityName && String(s.activityName).trim())
      || (s.activity && s.activity.name)
      || '';
  }
  function sessionCoach(s) {
    return (s.coachName && String(s.coachName).trim())
      || (s.coach && (s.coach.fullName || ((s.coach.firstName || '') + ' ' + (s.coach.lastName || '')).trim()))
      || '';
  }
  function sessionBooked(s) {
    return s.bookedCount != null ? s.bookedCount : (s.bookingsCount || 0);
  }
  function sessionCap(s) { return s.capacity || 0; }
  function sessionRemaining(s) {
    if (s.remainingCapacity != null) return Math.max(0, s.remainingCapacity);
    var cap = sessionCap(s);
    return cap > 0 ? Math.max(0, cap - sessionBooked(s)) : null;
  }

  function openOverlay(id) { document.getElementById(id).classList.add('show'); }
  function closeOverlay(id) { document.getElementById(id).classList.remove('show'); }

  // ── Date navigation ──
  var dateDisplay = document.getElementById('dateDisplay');
  var datePick = document.getElementById('datePick');

  function setChipActive(range) {
    document.querySelectorAll('.day-chip').forEach(function (c) {
      c.classList.toggle('is-active', c.getAttribute('data-range') === range);
    });
  }

  function updateDateUI() {
    if (dateMode === 'week') {
      dateDisplay.textContent = fmtDateShort(selectedDate) + ' – ' + fmtDateShort(addDays(selectedDate, 6));
    } else {
      dateDisplay.textContent = fmtDate(selectedDate);
    }
    datePick.value = selectedDate;
  }

  function selectDay(dateStr, mode) {
    selectedDate = dateStr;
    dateMode = mode || 'custom';
    if (mode === 'today' || mode === 'tomorrow' || mode === 'week') setChipActive(mode);
    else setChipActive('');
    updateDateUI();
    loadSessions();
  }

  dateDisplay.addEventListener('click', function () {
    if (datePick.showPicker) {
      try { datePick.showPicker(); } catch (e) { datePick.focus(); }
    } else {
      datePick.focus();
    }
  });
  document.getElementById('btnPrev').addEventListener('click', function () {
    selectDay(addDays(selectedDate, dateMode === 'week' ? -7 : -1), dateMode === 'week' ? 'week' : 'custom');
  });
  document.getElementById('btnNext').addEventListener('click', function () {
    selectDay(addDays(selectedDate, dateMode === 'week' ? 7 : 1), dateMode === 'week' ? 'week' : 'custom');
  });
  document.getElementById('btnToday').addEventListener('click', function () {
    selectDay(todayStr(), 'today');
  });
  datePick.addEventListener('change', function () {
    if (this.value) selectDay(this.value, 'custom');
  });
  document.getElementById('btnRefresh').addEventListener('click', function () { loadSessions(); });
  document.getElementById('chipToday').addEventListener('click', function () { selectDay(todayStr(), 'today'); });
  document.getElementById('chipTomorrow').addEventListener('click', function () { selectDay(addDays(todayStr(), 1), 'tomorrow'); });
  document.getElementById('chipWeek').addEventListener('click', function () {
    // Start week from today for reception ("what do we have this week")
    selectDay(todayStr(), 'week');
  });

  activityFilter.addEventListener('change', function () {
    activityFilterId = this.value || '';
    renderSessions();
    updateStats();
  });

  updateDateUI();
  setChipActive('today');

  // ── Activities (for filter) ──
  async function loadActivityFilter() {
    if (!Gfp) return;
    var r = await Gfp.get('/activities');
    if (!r.ok) {
      activityFilter.innerHTML = '<option value="">All Activities</option>';
      return;
    }
    var list = Array.isArray(r.data) ? r.data : [];
    classActivities = list.filter(function (a) {
      var kind = String(a.kind || 'class').toLowerCase();
      return (kind === 'class' || kind === '') && a.isActive !== false && !a.isDeleted;
    });
    if (!classActivities.length) {
      activityFilter.innerHTML = '<option value="">No activities available</option>';
      activityFilter.disabled = true;
      return;
    }
    activityFilter.disabled = false;
    activityFilter.innerHTML = '<option value="">All Activities</option>' +
      classActivities.map(function (a) {
        return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
      }).join('');
    if (activityFilterId) activityFilter.value = activityFilterId;
  }

  // ── Load sessions ──
  async function fetchSessionsForDate(dateStr) {
    var r = await Gfp.get('/activity-sessions?date=' + encodeURIComponent(dateStr));
    if (!r.ok) return { ok: false, error: r, items: [] };
    var items = Array.isArray(r.data) ? r.data : (r.data && r.data.items ? r.data.items : []);
    // Classes board = class sessions only (facilities stay in the strip below).
    items = items.filter(function (s) {
      var kind = (s.activityKind || (s.activity && s.activity.kind) || 'class').toLowerCase();
      return kind === 'class' || kind === '';
    });
    return { ok: true, items: items };
  }

  async function loadSessions() {
    lastLoadError = null;
    sessionsList.innerHTML = '<div class="loading-state"><div class="loader"></div><p>Loading classes…</p></div>';
    if (!Gfp) {
      sessionsList.innerHTML = '<div class="empty-state"><div class="empty-title">API client missing</div><div class="empty-desc">Hard-refresh or restart the web app.</div></div>';
      return;
    }

    await loadActivityFilter();
    loadFacilities();

    if (dateMode === 'week') {
      var days = [];
      for (var i = 0; i < 7; i++) days.push(addDays(selectedDate, i));
      var results = await Promise.all(days.map(fetchSessionsForDate));
      var failed = results.find(function (x) { return !x.ok; });
      if (failed) {
        lastLoadError = failed.error;
        renderError();
        return;
      }
      weekSessions = [];
      results.forEach(function (res, idx) {
        res.items.forEach(function (s) {
          s._boardDate = days[idx];
          weekSessions.push(s);
        });
      });
      weekSessions.sort(function (a, b) {
        var ta = sessionStart(a);
        var tb = sessionStart(b);
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      allSessions = weekSessions;
    } else {
      var one = await fetchSessionsForDate(selectedDate);
      if (!one.ok) {
        lastLoadError = one.error;
        renderError();
        return;
      }
      allSessions = one.items.map(function (s) {
        s._boardDate = selectedDate;
        return s;
      });
      allSessions.sort(function (a, b) {
        var ta = sessionStart(a);
        var tb = sessionStart(b);
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
    }

    renderSessions();
    updateStats();
  }

  function renderError() {
    sessionsList.innerHTML =
      '<div class="empty-state">' +
      '<div class="empty-icon"><i class="ti ti-alert-circle"></i></div>' +
      '<div class="empty-title">Unable to load classes</div>' +
      '<div class="empty-desc">' + esc(errMsg(lastLoadError)) + '</div>' +
      '<button type="button" class="btn-primary empty-cta" id="btnRetryLoad"><i class="ti ti-refresh"></i> Retry</button>' +
      '</div>';
    var btn = document.getElementById('btnRetryLoad');
    if (btn) btn.addEventListener('click', function () { loadSessions(); });
    updateStatsZeros();
  }

  function updateStatsZeros() {
    document.getElementById('statSessions').textContent = '0';
    document.getElementById('statBooked').textContent = '0';
    document.getElementById('statCheckedIn').textContent = '0';
  }

  function visibleSessions() {
    if (!activityFilterId) return allSessions;
    return allSessions.filter(function (s) {
      var id = s.activityId || (s.activity && s.activity.id);
      return String(id) === String(activityFilterId);
    });
  }

  function getSessionStatus(s) {
    if (s.status === 'cancelled') return 'cancelled';
    var booked = sessionBooked(s);
    var cap = sessionCap(s);
    if (cap > 0 && booked >= cap) return 'full';
    if (s.status === 'completed') return 'completed';
    if (s.status === 'in_progress' || s.status === 'in-progress') return 'in-progress';
    return 'upcoming';
  }

  function updateStats() {
    var list = visibleSessions();
    document.getElementById('statSessions').textContent = list.length;
    var totalBooked = 0;
    var totalCheckedIn = 0;
    list.forEach(function (s) {
      totalBooked += sessionBooked(s);
      totalCheckedIn += s.checkedInCount || 0;
    });
    document.getElementById('statBooked').textContent = totalBooked;
    document.getElementById('statCheckedIn').textContent = totalCheckedIn;
  }

  function renderSessions() {
    var list = visibleSessions();
    if (!list.length) {
      var hasAnyActivities = classActivities.length > 0;
      var filtered = !!activityFilterId;
      var emptyHint;
      if (filtered) {
        emptyHint = 'No sessions for this activity on the selected date.';
      } else if (!hasAnyActivities) {
        emptyHint = 'Create an activity and schedule first, then sessions will appear here.';
      } else if (dateMode === 'today') {
        emptyHint = 'No class sessions today. Try Tomorrow or This week — schedules only create sessions on their scheduled days (e.g. Mon / Wed / Sat).';
      } else if (dateMode === 'tomorrow') {
        emptyHint = 'No class sessions tomorrow. Try This week, or add a schedule for that day under Activities.';
      } else {
        emptyHint = 'No class sessions for this range. Add a schedule under Activities, or pick another day.';
      }
      sessionsList.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-icon"><i class="ti ti-calendar-off"></i></div>' +
        '<div class="empty-title">No upcoming classes</div>' +
        '<div class="empty-desc">' + esc(emptyHint) + '</div>' +
        (dateMode === 'today' && hasAnyActivities
          ? '<button type="button" class="btn-primary empty-cta" id="btnJumpWeek"><i class="ti ti-calendar-week"></i> View this week</button>'
          : (hasAnyActivities
            ? '<a class="btn-primary empty-cta" href="/dashboard/activities/"><i class="ti ti-calendar-plus"></i> Configure a schedule</a>'
            : '<a class="btn-primary empty-cta" href="/dashboard/activities/"><i class="ti ti-plus"></i> Create Activity</a>')) +
        '</div>';
      var jump = document.getElementById('btnJumpWeek');
      if (jump) jump.addEventListener('click', function () { selectDay(todayStr(), 'week'); });
      return;
    }

    if (dateMode === 'week') {
      var byDay = {};
      list.forEach(function (s) {
        var d = s._boardDate || selectedDate;
        if (!byDay[d]) byDay[d] = [];
        byDay[d].push(s);
      });
      var html = Object.keys(byDay).sort().map(function (d) {
        return '<div class="day-group">' +
          '<div class="day-group-title">' + esc(fmtDate(d)) + '</div>' +
          byDay[d].map(buildSessionCard).join('') +
          '</div>';
      }).join('');
      sessionsList.innerHTML = html;
    } else {
      sessionsList.innerHTML = list.map(buildSessionCard).join('');
    }

    sessionsList.querySelectorAll('.session-card').forEach(function (card) {
      card.addEventListener('click', function () {
        openSessionDrawer(this.dataset.sessionId);
      });
      var bookBtn = card.querySelector('[data-quick-book]');
      if (bookBtn) {
        bookBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openSessionDrawer(card.dataset.sessionId).then(function () {
            var add = document.getElementById('btnAddBooking');
            if (add && !add.disabled) add.click();
          });
        });
      }
    });
  }

  function buildSessionCard(s) {
    var status = getSessionStatus(s);
    var startTime = fmtTimeShort(sessionStart(s));
    var endTime = fmtTimeShort(sessionEnd(s));
    var actName = sessionActivityName(s) || 'Untitled activity';
    var coach = sessionCoach(s);
    var booked = sessionBooked(s);
    var cap = sessionCap(s);
    var remaining = sessionRemaining(s);
    var pct = cap > 0 ? Math.min(100, Math.round((booked / cap) * 100)) : 0;
    var dayLabel = dateMode === 'week' && s._boardDate ? fmtDateShort(s._boardDate) : fmtDateShort(s._boardDate || selectedDate);

    var spotsText = '';
    if (remaining === 0 && cap > 0) spotsText = '';
    else if (remaining != null && remaining > 0) spotsText = remaining + (remaining === 1 ? ' spot left' : ' spots left');

    var statusBadge = '';
    if (status === 'full') statusBadge = '<span class="sess-status full-badge">FULL</span>';
    else if (status === 'in-progress') statusBadge = '<span class="sess-status in-progress">IN PROGRESS</span>';
    else if (status === 'completed') statusBadge = '<span class="sess-status completed-badge">COMPLETED</span>';
    else if (status === 'cancelled') statusBadge = '<span class="sess-status cancelled-badge">CANCELLED</span>';
    else if (remaining != null && remaining <= 3 && remaining > 0) statusBadge = '<span class="sess-status almost-full">' + esc(spotsText.toUpperCase()) + '</span>';
    else statusBadge = '<span class="sess-status upcoming">OPEN</span>';

    var cardClass = 'session-card';
    if (status === 'full') cardClass += ' full';
    if (status === 'completed') cardClass += ' completed';

    return '<article class="' + cardClass + '" data-session-id="' + esc(s.id) + '" tabindex="0">' +
      '<div class="sess-time">' +
        '<div class="sess-time-start">' + esc(startTime) + '</div>' +
        '<div class="sess-time-end">' + esc(endTime) + '</div>' +
      '</div>' +
      '<div class="sess-div" aria-hidden="true"></div>' +
      '<div class="sess-info">' +
        '<div class="sess-name">' + esc(actName) + '</div>' +
        '<div class="sess-when">' + esc(dayLabel) + ' · ' + esc(startTime) + (endTime ? ' – ' + esc(endTime) : '') + '</div>' +
        '<div class="sess-meta">' +
          (coach ? '<span class="sess-meta-item"><i class="ti ti-user"></i>' + esc(coach) + '</span>' : '<span class="sess-meta-item muted">No coach assigned</span>') +
        '</div>' +
      '</div>' +
      '<div class="sess-capacity">' +
        (cap > 0
          ? '<div class="cap-bar"><div class="cap-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="cap-text ' + (status === 'full' ? 'full-text' : '') + '">' + booked + ' / ' + cap + '</div>' +
            (spotsText ? '<div class="cap-spots' + (remaining <= 3 ? ' low' : '') + '">' + esc(spotsText) + '</div>' : (status === 'full' ? '<div class="cap-spots low">Full</div>' : ''))
          : '<div class="cap-text">' + booked + ' booked</div>') +
      '</div>' +
      '<div class="sess-actions">' +
        statusBadge +
        '<button type="button" class="btn-card-view">View</button>' +
        '<button type="button" class="btn-card-book" data-quick-book' + (status === 'full' || status === 'cancelled' || status === 'completed' ? ' disabled' : '') + '>Book</button>' +
      '</div>' +
    '</article>';
  }

  // ── Facilities strip ──
  async function loadFacilities() {
    var host = document.getElementById('facilitiesSection');
    if (!host || !Gfp) return;
    var r = await Gfp.get('/activities');
    if (!r.ok || !Array.isArray(r.data)) { host.hidden = true; return; }
    var facs = r.data.filter(function (a) { return a.kind === 'facility' && a.isActive !== false; });
    if (!facs.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML =
      '<div class="fac-section"><div class="fac-title"><i class="ti ti-pool"></i> Facilities <span class="title-ar-sm">/ المرافق</span></div>' +
      '<div class="fac-grid">' +
      facs.map(function (f) {
        var icon = f.systemKey === 'gym_floor' ? 'ti-dumbbell' : 'ti-pool';
        if (/sauna/i.test(f.name || '')) icon = 'ti-flame';
        if (/jacuzzi|spa/i.test(f.name || '')) icon = 'ti-bath';
        var tag, cls;
        if (!f.bookingRequired) { tag = f.isSystem ? 'Open access' : 'Walk-in'; cls = f.isSystem ? 'open' : 'walkin'; }
        else { tag = 'Reservation required'; cls = 'reserve'; }
        var capTxt = f.defaultCapacity ? ' · Capacity ' + f.defaultCapacity : '';
        return '<div class="fac-card">' +
          '<div class="fac-icon"><i class="ti ' + icon + '"></i></div>' +
          '<div class="fac-info"><div class="fac-name">' + esc(f.name) + '</div>' +
          '<div class="fac-behavior"><i class="ti ' + (f.bookingRequired ? 'ti-calendar-check' : 'ti-walk') + '"></i>' +
          (f.bookingRequired ? 'Booking required' + esc(capTxt) : 'No booking needed') + '</div>' +
          '<span class="fac-tag ' + cls + '">' + esc(tag) + '</span></div></div>';
      }).join('') +
      '</div></div>';
  }

  // ── Session drawer ──
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
    var actName = sessionActivityName(s) || 'Untitled activity';
    var startTime = fmtTimeShort(sessionStart(s));
    var endTime = fmtTimeShort(sessionEnd(s));
    var coach = sessionCoach(s);
    var booked = sessionBooked(s);
    var cap = sessionCap(s);
    var remaining = sessionRemaining(s);
    var status = getSessionStatus(s);
    var isFull = status === 'full';
    var bookings = s.bookings || [];
    var boardDate = s._boardDate || selectedDate;

    drawer.innerHTML =
      '<div class="drawer-hdr"><div><h2>' + esc(actName) + '</h2>' +
      '<div class="drawer-hdr-sub">' + esc(fmtDate(boardDate)) + '</div></div>' +
      '<button type="button" class="drawer-close" id="drawerClose" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
      '<div class="drawer-body">' +
      '<div class="sess-summary">' +
      '<div class="sess-summary-row"><i class="ti ti-clock"></i><strong>' + esc(startTime) + ' – ' + esc(endTime) + '</strong></div>' +
      (coach ? '<div class="sess-summary-row"><i class="ti ti-user"></i>' + esc(coach) + '</div>' : '') +
      '<div class="sess-summary-row"><i class="ti ti-users"></i><strong>' + booked + ' / ' + (cap || '—') + '</strong> booked' +
      (cap > 0 ? ' · <span class="' + (isFull ? 'cap-full-inline' : 'cap-spots-inline') + '">' +
        (isFull ? 'Full' : ((remaining != null ? remaining : Math.max(0, cap - booked)) + ' spots left')) + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="booking-list-hdr">' +
      '<div class="booking-list-title">Bookings (' + bookings.length + ')</div>' +
      '<button type="button" class="btn-add-booking" id="btnAddBooking"' + (isFull || status === 'cancelled' || status === 'completed' ? ' disabled title="Unavailable"' : '') + '><i class="ti ti-plus"></i> Book</button></div>' +
      '<div class="booking-list" id="bookingList">' +
      (bookings.length ? bookings.map(buildBookingRow).join('') :
        '<div class="booking-empty"><i class="ti ti-calendar-off"></i>No bookings yet.<span class="booking-empty-hint">Use “Book” to add a member or walk-in guest.</span></div>') +
      '</div></div>';

    document.getElementById('drawerClose').addEventListener('click', function () { closeOverlay('drawerOverlay'); });
    document.getElementById('btnAddBooking').addEventListener('click', function () { showBookModal(s.id); });

    drawer.querySelectorAll('[data-bk-action]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var action = this.dataset.bkAction;
        var bkId = this.dataset.bkId;
        if (action === 'invoice') {
          openBookingInvoice(this.dataset.invoiceId, this.dataset.invoiceNumber);
          return;
        }
        this.disabled = true;
        if (action === 'checkin') this.innerHTML = '<i class="ti ti-loader-2 spin"></i> Checking in…';
        if (action === 'cancel' && !window.confirm('Cancel this member\u2019s booking?')) {
          this.disabled = false;
          return;
        }
        var res;
        if (action === 'checkin') res = await Gfp.put('/activity-bookings/' + bkId + '/check-in');
        else if (action === 'cancel') res = await Gfp.put('/activity-bookings/' + bkId + '/cancel');

        if (res && res.ok) {
          toast(action === 'checkin'
            ? 'Member checked in — attendance recorded.'
            : (res.data && res.data.status === 'cancelled_late' ? 'Booking cancelled (late — credit not restored).' : 'Booking cancelled.'));
          await openSessionDrawer(currentSession.id);
          loadSessions();
        } else {
          toast(errMsg(res), 'error');
          this.disabled = false;
          if (action === 'checkin') this.innerHTML = '<i class="ti ti-door-enter"></i> Check In';
        }
      });
    });
  }

  function buildBookingRow(bk) {
    var name = bk.memberName || (bk.member && bk.member.fullName) || 'Member';
    var initials = name.split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
    var st = (bk.status || 'booked').toLowerCase().replace(/\s+/g, '-');
    var statusLabel = bk.status || 'Booked';
    var statusIcon = 'ti-calendar-check';
    if (st === 'checked-in' || st === 'checked_in' || st === 'checkedin') { statusIcon = 'ti-door-enter'; st = 'checked-in'; statusLabel = 'Checked In'; }
    else if (st === 'cancelled') { statusIcon = 'ti-x'; }
    else if (st === 'cancelled-late' || st === 'cancelled_late' || st === 'cancelledlate') { statusIcon = 'ti-clock-x'; st = 'cancelled-late'; statusLabel = 'Cancelled Late'; }
    else if (st === 'no-show' || st === 'no_show' || st === 'noshow') { statusIcon = 'ti-alert-triangle'; st = 'no-show'; statusLabel = 'No Show'; }

    var source = String(bk.source || '').toLowerCase();
    var saleId = bk.saleId || bk.SaleId || null;
    var invoiceId = bk.invoiceId || bk.InvoiceId || null;
    var invoiceNumber = bk.invoiceNumber || bk.InvoiceNumber || '';
    var isPaid = !!(saleId || source === 'drop_in' || source === 'guest_walk_in');
    var payHtml = isPaid
      ? '<div class="booking-pay paid"><i class="ti ti-file-invoice"></i> ' +
        esc(invoiceNumber || 'Paid drop-in') + '</div>'
      : '<div class="booking-pay credit"><i class="ti ti-ticket"></i> Plan credit \u2014 no invoice</div>';

    var actions = '';
    if (invoiceId) {
      actions +=
        '<button type="button" class="bk-btn invoice" data-bk-action="invoice" data-invoice-id="' +
        esc(invoiceId) + '" data-invoice-number="' + esc(invoiceNumber) +
        '"><i class="ti ti-file-invoice"></i> Invoice</button>';
    }
    if (st === 'booked') {
      actions +=
        '<button type="button" class="bk-btn checkin" data-bk-action="checkin" data-bk-id="' + esc(bk.id) + '"><i class="ti ti-door-enter"></i> Check In</button>' +
        '<button type="button" class="bk-btn cancel-bk" data-bk-action="cancel" data-bk-id="' + esc(bk.id) + '"><i class="ti ti-x"></i></button>';
    }

    return '<div class="booking-row">' +
      '<div class="booking-avatar">' + esc(initials) + '</div>' +
      '<div class="booking-info"><div class="booking-name">' + esc(name) + '</div>' +
      '<div class="booking-status ' + st + '"><i class="ti ' + statusIcon + '"></i> ' + esc(statusLabel) + '</div>' +
      payHtml + '</div>' +
      '<div class="booking-actions">' + actions + '</div></div>';
  }

  function openBookingInvoice(invoiceId, invoiceNumber) {
    if (!invoiceId || !Gfp) return;
    var overlay = document.getElementById('classPrintOverlay');
    var frame = document.getElementById('classPrintFrame');
    var title = document.getElementById('classPrintTitle');
    if (!overlay || !frame) {
      toast('Invoice view is not available on this page.', 'error');
      return;
    }
    if (title) title.textContent = invoiceNumber ? ('Invoice ' + invoiceNumber) : 'Invoice';
    frame.srcdoc = '<p style="padding:16px;font-family:sans-serif;color:#666">Loading invoice…</p>';
    openOverlay('classPrintOverlay');
    Gfp.get('/invoices/' + encodeURIComponent(invoiceId) + '/receipt-html?format=a4').then(function (res) {
      if (res && res.ok && typeof res.data === 'string' && res.data) {
        frame.srcdoc = res.data;
        return;
      }
      var msg = errMsg(res) || 'Could not load this invoice.';
      frame.srcdoc = '<p style="padding:16px;font-family:sans-serif;color:#991b1b">' + esc(msg) + '</p>';
      toast(msg, 'error');
    }).catch(function () {
      toast('Could not load this invoice.', 'error');
    });
  }

  function printBookingInvoice() {
    var frame = document.getElementById('classPrintFrame');
    try {
      if (frame && frame.contentWindow) {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      }
    } catch (e) {
      toast('Print failed — wait for the invoice to load.', 'error');
    }
  }

  // ── Book Member modal ──
  var searchTimer = null;
  var bookCtx = null; // { sessionId, memberId, memberName, dropInPrice, actName, ... }
  var bookingFlowToken = 0;

  function moneyEGP(n) {
    if (n == null || n === '' || isNaN(Number(n))) return null;
    var v = Number(n);
    return 'EGP ' + (Math.round(v * 100) / 100).toLocaleString('en-EG', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  async function resolveDropInPrice() {
    var actId = currentActivityId();
    if (!actId || !Gfp) return null;
    var ar = await Gfp.get('/activities');
    if (!ar.ok || !Array.isArray(ar.data)) return null;
    for (var i = 0; i < ar.data.length; i++) {
      if (String(ar.data[i].id) === String(actId)) {
        var p = ar.data[i].dropInPrice;
        return p != null ? Number(p) : null;
      }
    }
    return null;
  }

  function showBookModal(sessionId) {
    var s = currentSession || {};
    var actName = sessionActivityName(s) || 'Class';
    var startTime = fmtTimeShort(sessionStart(s));
    var endTime = fmtTimeShort(sessionEnd(s));
    var booked = sessionBooked(s);
    var cap = sessionCap(s);
    var remaining = sessionRemaining(s);
    var boardDate = s._boardDate || selectedDate;
    var isFull = cap > 0 && booked >= cap;

    bookCtx = {
      sessionId: sessionId,
      actName: actName,
      boardDate: boardDate,
      startTime: startTime,
      endTime: endTime,
      booked: booked,
      cap: cap,
      remaining: remaining
    };

    var modal = document.getElementById('bookContent');
    modal.innerHTML =
      '<div class="modal-header"><div><h2>Book member or walk-in</h2>' +
      '<div class="modal-header-sub">Use a plan credit when available, or collect a drop-in payment and issue an invoice.</div></div>' +
      '<button type="button" class="modal-close" id="bookClose" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body">' +
      '<div class="book-summary">' +
        '<div class="book-summary-row"><span class="lbl">Activity</span><strong>' + esc(actName) + '</strong></div>' +
        '<div class="book-summary-row"><span class="lbl">Session</span><strong>' + esc(fmtDateShort(boardDate)) + ' — ' + esc(startTime) + (endTime ? ' – ' + esc(endTime) : '') + '</strong></div>' +
        '<div class="book-summary-row"><span class="lbl">Capacity</span><strong>' + booked + ' / ' + (cap || '—') +
          (remaining != null && cap > 0 ? ' · ' + (isFull ? 'Full' : remaining + ' spots left') : '') + '</strong></div>' +
      '</div>' +
      '<div id="bookStep">' +
      (isFull
        ? '<div class="book-blocked" role="alert"><i class="ti ti-ban"></i> This class is full.</div>'
        : '') +
      '</div></div>';

    openOverlay('bookOverlay');
    document.getElementById('bookClose').addEventListener('click', function () { closeOverlay('bookOverlay'); });

    if (!isFull) resetSearchStep(sessionId);
  }

  async function searchMembers(query, sessionId) {
    var container = document.getElementById('searchResults');
    if (!container) return;
    container.innerHTML = '<div class="search-empty">Searching…</div>';

    var r = await Gfp.get('/members?search=' + encodeURIComponent(query) + '&pageSize=10');
    if (!r.ok) {
      container.innerHTML = '<div class="search-empty">Search failed. Try again.</div>';
      return;
    }

    var paged = Gfp.asPaged(r.data);
    var members = paged.items;
    if (!members.length) {
      container.innerHTML = '<div class="search-empty">No members found</div>';
      return;
    }

    container.innerHTML = '<div class="search-results">' + members.map(function (m) {
      var name = m.fullName || ((m.firstName || '') + ' ' + (m.lastName || '')).trim() || 'Member';
      var phone = m.phoneNumber || m.phone || '';
      var initials = name.split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
      return '<button type="button" class="search-result" data-member-id="' + esc(m.id) + '" data-member-name="' + esc(name) + '" data-member-phone="' + esc(phone) + '">' +
        '<div class="booking-avatar">' + esc(initials) + '</div>' +
        '<div class="search-result-text"><div class="search-result-name">' + esc(name) + '</div>' +
        '<div class="search-result-sub">' + esc(phone) + '</div></div>' +
        '<i class="ti ti-chevron-right search-result-go" aria-hidden="true"></i></button>';
    }).join('') + '</div>';

    container.querySelectorAll('.search-result').forEach(function (row) {
      row.addEventListener('click', function () {
        showConfirmStep(row.dataset.memberId, row.dataset.memberName, row.dataset.memberPhone || '', sessionId);
      });
    });
  }

  function showConfirmStep(memberId, memberName, memberPhone, sessionId) {
    bookingFlowToken++;
    bookCtx.memberId = memberId;
    bookCtx.memberName = memberName;
    bookCtx.memberPhone = memberPhone;

    var step = document.getElementById('bookStep');
    if (!step) return;
    var initials = (memberName || 'M').split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();

    step.innerHTML =
      '<div class="book-member-card">' +
        '<div class="booking-avatar lg">' + esc(initials) + '</div>' +
        '<div class="book-member-meta">' +
          '<div class="book-member-name">' + esc(memberName || 'Member') + '</div>' +
          (memberPhone ? '<div class="book-member-phone">' + esc(memberPhone) + '</div>' : '') +
        '</div>' +
        '<button type="button" class="btn-text" id="eligChange">Change</button>' +
      '</div>' +
      '<div class="book-note">Use a plan credit when the membership includes this class \u2014 that does not create an invoice or cash movement. Collect a drop-in payment to issue an invoice and record cash in the open shift.</div>' +
      '<div class="elig-status" id="eligStatus" role="status"></div>' +
      '<div class="book-footer">' +
        '<button type="button" class="btn-cancel" id="eligBack">Back</button>' +
        (canSell
          ? '<button type="button" class="btn-pay" id="eligPay"><i class="ti ti-cash"></i> Collect payment</button>'
          : '') +
        '<button type="button" class="btn-book" id="eligConfirm"><i class="ti ti-ticket"></i> Use credit</button>' +
      '</div>';

    document.getElementById('eligChange').addEventListener('click', function () { resetSearchStep(sessionId); });
    document.getElementById('eligBack').addEventListener('click', function () { resetSearchStep(sessionId); });
    document.getElementById('eligConfirm').addEventListener('click', function () { tryBookWithCredits(sessionId); });
    var payNow = document.getElementById('eligPay');
    if (payNow) {
      payNow.addEventListener('click', async function () {
        payNow.disabled = true;
        var price = await resolveDropInPrice();
        bookCtx.dropInPrice = price;
        showDropInPayStep(sessionId, price, 'Collect a drop-in payment to issue an invoice and record it in Cash Drawer.');
      });
    }
  }

  function resetSearchStep(sessionId) {
    bookingFlowToken++;
    var step = document.getElementById('bookStep');
    if (!step) return;
    step.innerHTML =
      '<div class="book-entry-choice">' +
        '<button type="button" class="book-choice active" id="memberPath"><i class="ti ti-user"></i> Registered member</button>' +
        '<button type="button" class="book-choice" id="guestPath"><i class="ti ti-walk"></i> Walk-in guest</button>' +
      '</div>' +
      '<div id="memberSearchPane">' +
      '<label class="book-field-label" for="memberSearch">Search member</label>' +
      '<div class="search-wrap"><i class="ti ti-search search-icon"></i>' +
      '<input class="search-input" id="memberSearch" placeholder="Name or phone…" autocomplete="off" autofocus></div>' +
      '<div id="searchResults"></div></div>';
    var searchInput = document.getElementById('memberSearch');
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      var results = document.getElementById('searchResults');
      if (!q.length) { results.innerHTML = ''; return; }
      searchTimer = setTimeout(function () { searchMembers(q, sessionId); }, 250);
    });
    document.getElementById('memberPath').addEventListener('click', function () {
      resetSearchStep(sessionId);
    });
    document.getElementById('guestPath').addEventListener('click', function () {
      showGuestStep(sessionId);
    });
    searchInput.focus();
  }

  var paymentMethods = [
    { value: 'cash', label: 'Cash' },
    { value: 'card_paymob', label: 'Card' },
    { value: 'fawry', label: 'Fawry' },
    { value: 'vodafone', label: 'Vodafone Wallet' },
    { value: 'instapay', label: 'InstaPay' },
    { value: 'account_credit', label: 'Account credit' }
  ];

  function paymentMethodSelect(id, includeCredit) {
    return '<label class="book-field-label" for="' + id + '">Payment method</label>' +
      '<select class="payment-select" id="' + id + '">' +
      paymentMethods.filter(function (p) { return includeCredit || p.value !== 'account_credit'; }).map(function (p) {
        return '<option value="' + p.value + '">' + p.label + '</option>';
      }).join('') + '</select>';
  }

  async function showGuestStep(sessionId) {
    var flowToken = ++bookingFlowToken;
    var step = document.getElementById('bookStep');
    if (!step) return;
    // Clear any member selected earlier in this modal before entering the guest path.
    bookCtx.memberId = null;
    bookCtx.memberName = '';
    bookCtx.memberPhone = '';
    step.innerHTML = '<div class="search-empty">Loading drop-in price…</div>';
    var price = await resolveDropInPrice();
    if (flowToken !== bookingFlowToken) return;
    bookCtx.dropInPrice = price;
    step.innerHTML =
      '<div class="book-guest-heading"><i class="ti ti-walk"></i><strong>Walk-in guest</strong>' +
        '<span>Guest details are saved on the booking and invoice.</span></div>' +
      '<label class="book-field-label" for="guestName">Guest name</label>' +
      '<input class="text-input" id="guestName" placeholder="Full name" maxlength="200" autocomplete="name">' +
      '<label class="book-field-label" for="guestPhone">Guest phone</label>' +
      '<input class="text-input" id="guestPhone" placeholder="Phone number" maxlength="30" autocomplete="tel">' +
      '<div class="dropin-card guest-price-card">' +
        '<div class="dropin-card-row price"><span>Amount to collect</span><strong class="dropin-price">' +
          (moneyEGP(price) || 'Drop-in price not configured') + '</strong></div>' +
      '</div>' +
      paymentMethodSelect('guestPaymentMethod', false) +
      '<div class="elig-status" id="guestStatus" role="status"></div>' +
      '<div class="book-footer">' +
        '<button type="button" class="btn-cancel" id="guestBack">Back</button>' +
        '<button type="button" class="btn-pay" id="guestPay"' + (!price ? ' disabled' : '') + '><i class="ti ti-file-invoice"></i> Pay &amp; book</button>' +
      '</div>';

    document.getElementById('guestBack').addEventListener('click', function () {
      resetSearchStep(sessionId);
    });
    var payBtn = document.getElementById('guestPay');
    if (payBtn && !payBtn.disabled) {
      payBtn.addEventListener('click', function () {
        var name = document.getElementById('guestName').value.trim();
        var phone = document.getElementById('guestPhone').value.trim();
        var statusEl = document.getElementById('guestStatus');
        if (!name || !phone) {
          statusEl.textContent = 'Guest name and phone are required.';
          statusEl.className = 'elig-status is-error';
          return;
        }
        bookCtx.memberId = null;
        bookCtx.guestName = name;
        bookCtx.guestPhone = phone;
        bookCtx.paymentMethod = document.getElementById('guestPaymentMethod').value;
        collectDropInAndBook(sessionId);
      });
    }
    document.getElementById('guestName').focus();
  }

  function isNoCreditError(res) {
    var m = errMsg(res) || '';
    return /payment required|drop-in|no class credits|quota|credits remaining|not eligible/i.test(m);
  }

  async function tryBookWithCredits(sessionId) {
    var flowToken = bookingFlowToken;
    var btn = document.getElementById('eligConfirm');
    var statusEl = document.getElementById('eligStatus');
    if (!btn || !bookCtx || !bookCtx.memberId) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Checking…';
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'elig-status';
    }

    var res = await Gfp.post('/activity-bookings', {
      sessionId: sessionId,
      memberId: bookCtx.memberId
    });
    if (flowToken !== bookingFlowToken) return;

    if (res && res.ok) {
      toast('Member booked using membership credit — no invoice and no cash movement (no payment was taken).');
      closeOverlay('bookOverlay');
      await openSessionDrawer(currentSession.id);
      loadSessions();
      return;
    }

    if (isNoCreditError(res)) {
      var price = await resolveDropInPrice();
      bookCtx.dropInPrice = price;
      showDropInPayStep(sessionId, price, errMsg(res));
      return;
    }

    var friendly = errMsg(res);
    if (statusEl) {
      statusEl.textContent = friendly;
      statusEl.className = 'elig-status is-error';
    }
    toast(friendly, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-ticket"></i> Use credit';
  }

  function showDropInPayStep(sessionId, price, reasonMsg) {
    var step = document.getElementById('bookStep');
    if (!step || !bookCtx) return;
    var priceLabel = moneyEGP(price);
    var initials = (bookCtx.memberName || 'M').split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();

    step.innerHTML =
      '<div class="book-member-card">' +
        '<div class="booking-avatar lg">' + esc(initials) + '</div>' +
        '<div class="book-member-meta">' +
          '<div class="book-member-name">' + esc(bookCtx.memberName || 'Member') + '</div>' +
          (bookCtx.memberPhone ? '<div class="book-member-phone">' + esc(bookCtx.memberPhone) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="book-warn" role="alert">' +
        '<div class="book-warn-title"><i class="ti ti-alert-circle"></i> No class credits remaining</div>' +
        '<div class="book-warn-body">' +
          esc(reasonMsg && !/stack|exception/i.test(reasonMsg)
            ? reasonMsg
            : (bookCtx.memberName || 'This member') + ' cannot use a membership credit for ' + (bookCtx.actName || 'this class') + '.') +
        '</div>' +
      '</div>' +
      '<div class="dropin-card">' +
        '<div class="dropin-card-title">Drop-in for this session</div>' +
        '<div class="dropin-card-row"><span>Activity</span><strong>' + esc(bookCtx.actName || 'Class') + '</strong></div>' +
        '<div class="dropin-card-row"><span>Session</span><strong>' + esc(fmtDateShort(bookCtx.boardDate)) + ' — ' + esc(bookCtx.startTime) + '</strong></div>' +
        '<div class="dropin-card-row price"><span>Amount to collect</span><strong class="dropin-price">' +
          (priceLabel || 'Set on activity') + '</strong></div>' +
        '<div class="dropin-pay-method"><i class="ti ti-file-invoice"></i> A legal invoice will be issued for this payment.</div>' +
      '</div>' +
      paymentMethodSelect('dropinPaymentMethod', true) +
      '<div class="elig-status" id="eligStatus" role="status"></div>' +
      '<div class="book-footer">' +
        '<button type="button" class="btn-cancel" id="dropinBack">Back</button>' +
        '<button type="button" class="btn-pay" id="dropinPay"' + (!priceLabel ? ' disabled title="Drop-in price not configured"' : '') + '>' +
          '<i class="ti ti-cash"></i> ' + (priceLabel ? 'Collect ' + priceLabel + ' &amp; book' : 'Drop-in price missing') +
        '</button>' +
      '</div>';

    document.getElementById('dropinBack').addEventListener('click', function () {
      showConfirmStep(bookCtx.memberId, bookCtx.memberName, bookCtx.memberPhone || '', sessionId);
    });
    var payBtn = document.getElementById('dropinPay');
    if (payBtn && !payBtn.disabled) {
      payBtn.addEventListener('click', function () {
        bookCtx.paymentMethod = document.getElementById('dropinPaymentMethod').value;
        collectDropInAndBook(sessionId);
      });
    }
  }

  async function fetchInvoiceForSale(saleId) {
    for (var attempt = 0; attempt < 6; attempt += 1) {
      var inv = await Gfp.get('/sales/' + encodeURIComponent(saleId) + '/invoice');
      if (inv && inv.ok && inv.data && (inv.data.invoiceId || inv.data.invoiceNumber)) {
        return inv.data;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 350); });
    }
    return null;
  }

  async function collectDropInAndBook(sessionId) {
    var flowToken = bookingFlowToken;
    var isGuest = !!(bookCtx && !bookCtx.memberId && bookCtx.guestName);
    var btn = document.getElementById(isGuest ? 'guestPay' : 'dropinPay');
    var statusEl = document.getElementById(isGuest ? 'guestStatus' : 'eligStatus');
    if (!btn || !bookCtx || (!bookCtx.memberId && !bookCtx.guestName)) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Taking payment…';
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'elig-status';
    }

    var body = {
      sessionId: sessionId,
      paymentMethod: bookCtx.paymentMethod || 'cash'
    };
    if (bookCtx.memberId) body.memberId = bookCtx.memberId;
    else {
      body.guestName = bookCtx.guestName;
      body.guestPhone = bookCtx.guestPhone;
    }
    if (bookCtx.dropInPrice != null && !isNaN(bookCtx.dropInPrice)) {
      body.amountPaid = bookCtx.dropInPrice;
    }

    var res = await Gfp.post('/activity-bookings/drop-in', body);
    if (flowToken !== bookingFlowToken) return;

    if (res && res.ok) {
      var paid = moneyEGP(bookCtx.dropInPrice);
      var booking = res.data && (res.data.booking || res.data.Booking);
      var saleId = (res.data && (res.data.saleId || res.data.SaleId))
        || (booking && (booking.saleId || booking.SaleId));
      var invoiceId = booking && (booking.invoiceId || booking.InvoiceId);
      var invoiceNumber = booking && (booking.invoiceNumber || booking.InvoiceNumber);
      var invoice = null;
      if (!invoiceId && saleId) invoice = await fetchInvoiceForSale(saleId);
      if (!invoiceId && invoice) {
        invoiceId = invoice.invoiceId || invoice.InvoiceId;
        invoiceNumber = invoice.invoiceNumber || invoice.InvoiceNumber || invoiceNumber;
      }
      if (invoiceId) {
        toast(
          (paid ? paid + ' collected — ' : '') +
          (bookCtx.memberName || bookCtx.guestName || 'Guest') +
          ' booked. Invoice ' + (invoiceNumber || '') +
          ' is in Invoices → Classes & drop-ins and in Cash Drawer.'
        );
        openBookingInvoice(invoiceId, invoiceNumber);
      } else {
        toast(
          (paid ? paid + ' collected — ' : 'Drop-in paid — ') +
          'booking created. Invoice issuing — check Invoices → Classes & drop-ins.'
        );
      }
      closeOverlay('bookOverlay');
      await openSessionDrawer(currentSession.id);
      loadSessions();
      return;
    }

    var friendly = errMsg(res);
    if (/permission|forbidden|403/i.test(friendly) || (res && res.status === 403)) {
      friendly = 'You need sales permission to take a drop-in payment. Ask a manager, or sell from Sale / POS.';
    }
    if (statusEl) {
      statusEl.textContent = friendly;
      statusEl.className = 'elig-status is-error';
    }
    toast(friendly, 'error');
    btn.disabled = false;
    btn.innerHTML = isGuest
      ? '<i class="ti ti-file-invoice"></i> Pay &amp; book'
      : '<i class="ti ti-cash"></i> Collect ' + (moneyEGP(bookCtx.dropInPrice) || 'payment') + ' & book';
  }

  document.getElementById('drawerOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeOverlay('drawerOverlay');
  });
  document.getElementById('bookOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeOverlay('bookOverlay');
  });
  var printOverlay = document.getElementById('classPrintOverlay');
  if (printOverlay) {
    printOverlay.addEventListener('click', function (e) {
      if (e.target === this) closeOverlay('classPrintOverlay');
    });
  }
  var printClose = document.getElementById('classPrintClose');
  if (printClose) printClose.addEventListener('click', function () { closeOverlay('classPrintOverlay'); });
  var printDismiss = document.getElementById('classPrintDismiss');
  if (printDismiss) printDismiss.addEventListener('click', function () { closeOverlay('classPrintOverlay'); });
  var printDo = document.getElementById('classPrintDo');
  if (printDo) printDo.addEventListener('click', printBookingInvoice);

  loadSessions().then(function () {
    try {
      var sid = new URLSearchParams(window.location.search).get('sessionId');
      if (sid) openSessionDrawer(sid);
    } catch (e) { /* ignore */ }
  });
})();
