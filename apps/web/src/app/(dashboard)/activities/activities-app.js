/**
 * Activities management (Catalog → Activities).
 * CRUD for activities (classes + facilities) + schedule management.
 * Perm: plans.manage.
 */
(function () {
  var Gfp = window.GfpApi;
  var Authz = window.GfpAuthz;

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function getUser() {
    if (Gfp && Gfp.tokens) return Gfp.tokens.getUser();
    try { return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user')); }
    catch (e) { return null; }
  }

  var user = getUser();
  if (!user) { window.location.href = '/auth/login/'; return; }
  var canManage = Authz ? Authz.useCan('plans.manage') : false;
  if (!canManage) { window.location.href = '/dashboard/'; return; }

  // Populate user info
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

  var grid = document.getElementById('actGrid');
  var allActivities = [];
  var currentKind = 'all';
  var staffList = null;

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

  function openOverlay(id) { document.getElementById(id).classList.add('show'); }
  function closeOverlay(id) { document.getElementById(id).classList.remove('show'); }

  // ── Kind Tabs ──
  document.getElementById('kindTabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.kind-tab');
    if (!tab) return;
    currentKind = tab.dataset.kind;
    document.querySelectorAll('.kind-tab').forEach(function (t) { t.classList.remove('act'); });
    tab.classList.add('act');
    renderActivities();
  });

  // ── Load Activities ──
  async function loadActivities() {
    grid.innerHTML = '<div class="loading-state"><div class="loader"></div><p>Loading activities...</p></div>';
    if (!Gfp) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-title">API client missing</div></div>';
      return;
    }
    var r = await Gfp.get('/activities');
    if (!r.ok) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ti ti-alert-circle"></i></div><div class="empty-title">Could not load activities</div><div class="empty-desc">' + esc(errMsg(r)) + '</div></div>';
      return;
    }
    allActivities = Array.isArray(r.data) ? r.data : [];

    // Enrich with schedules
    await Promise.all(allActivities.map(async function (a) {
      if (a.kind === 'class' || a.kind === 'facility') {
        try {
          var sr = await Gfp.get('/activities/' + a.id + '/schedules');
          if (sr.ok && Array.isArray(sr.data)) a._schedules = sr.data;
        } catch (e) { /* skip */ }
      }
    }));

    renderActivities();
    updateStats();
  }

  function getFiltered() {
    if (currentKind === 'all') return allActivities;
    return allActivities.filter(function (a) { return a.kind === currentKind; });
  }

  function updateStats() {
    var list = getFiltered();
    document.getElementById('statTotal').textContent = list.length;
    document.getElementById('statActive').textContent = list.filter(function (a) { return a.isActive !== false; }).length;
    document.getElementById('statInactive').textContent = list.filter(function (a) { return a.isActive === false; }).length;
  }

  function renderActivities() {
    var list = getFiltered();
    updateStats();
    if (!list.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ti ti-run"></i></div><div class="empty-title">No Activities Yet</div><div class="empty-desc">Create your first activity or facility to get started.</div><button class="btn-create" id="emptyCreate"><i class="ti ti-plus"></i> New Activity</button></div>';
      var ec = document.getElementById('emptyCreate');
      if (ec) ec.addEventListener('click', function () { showActivityModal(); });
      return;
    }
    grid.innerHTML = list.map(buildCard).join('');
    grid.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = this.dataset.action;
        var id = this.dataset.id;
        if (action === 'edit') showActivityModal(id);
        else if (action === 'delete') showDeleteConfirm(id);
        else if (action === 'schedule') showScheduleModal(id);
      });
    });
  }

  function buildCard(a) {
    var isClass = a.kind === 'class';
    var isFacility = a.kind === 'facility';
    var kindClass = a.isSystem ? 'kind-system' : (isClass ? 'kind-class' : 'kind-facility');
    var kindLabel = a.isSystem ? 'System' : (isClass ? 'Class' : 'Facility');
    var kindIcon = a.isSystem ? 'ti-lock' : (isClass ? 'ti-run' : 'ti-pool');
    var accent = a.isSystem ? '#8C8C8C' : (isClass ? '#3B82F6' : '#8B5CF6');
    var features = buildFeatures(a);
    var schedHtml = buildSchedulePills(a);

    var actions = '';
    if (!a.isSystem) {
      actions =
        '<button class="card-btn" data-action="edit" data-id="' + a.id + '"><i class="ti ti-edit"></i> Edit</button>';
    }
    if (isClass) {
      actions += '<button class="card-btn sched" data-action="schedule" data-id="' + a.id + '"><i class="ti ti-calendar-event"></i> Schedule</button>';
    }
    if (!a.isSystem) {
      actions += '<button class="card-btn del" data-action="delete" data-id="' + a.id + '"><i class="ti ti-trash"></i></button>';
    }

    return '<div class="act-card ' + (a.isActive === false ? 'inactive' : '') + '">' +
      '<div class="card-accent" style="background:' + accent + '"></div>' +
      '<div class="card-body">' +
      '<span class="kind-badge ' + kindClass + '"><i class="ti ' + kindIcon + '"></i>' + kindLabel + '</span>' +
      '<div class="act-name">' + esc(a.name) + '</div>' +
      '<div class="act-name-ar">' + esc(a.nameAr || '') + '</div>' +
      features +
      schedHtml +
      '<div class="card-actions">' + actions + '</div>' +
      '</div></div>';
  }

  function buildFeatures(a) {
    var items = [];
    if (a.defaultCapacity) items.push('<div class="act-feat"><i class="ti ti-users"></i>Capacity: ' + a.defaultCapacity + '</div>');
    if (a.defaultDurationMinutes) items.push('<div class="act-feat"><i class="ti ti-clock"></i>' + a.defaultDurationMinutes + ' min</div>');
    if (a.bookingRequired) items.push('<div class="act-feat"><i class="ti ti-calendar-check"></i>Booking required</div>');
    else items.push('<div class="act-feat"><i class="ti ti-door-enter"></i>No booking needed</div>');
    if (a.dropInPrice > 0) items.push('<div class="act-feat"><i class="ti ti-coin"></i>Drop-in: ' + a.dropInPrice + ' EGP</div>');
    if (a.visibleToMembers === false) items.push('<div class="act-feat"><i class="ti ti-eye-off"></i>Hidden from members</div>');
    return items.length ? '<div class="act-features">' + items.join('') + '</div>' : '';
  }

  function buildSchedulePills(a) {
    var scheds = a._schedules;
    if (!scheds || !scheds.length) return '';
    var pills = scheds.map(function (s) {
      var days = parseDays(s.daysOfWeek);
      var dayStr = days.map(function (d) { return DAYS_SHORT[d]; }).join(', ');
      var time = fmtTime(s.startTime) + ' – ' + fmtTime(s.endTime);
      return '<div class="sched-pill"><i class="ti ti-clock"></i>' + dayStr + ' ' + time + '</div>';
    }).join('');
    return '<div class="sched-section"><div class="sched-section-title"><i class="ti ti-calendar-event"></i> Schedule</div><div class="sched-pills">' + pills + '</div></div>';
  }

  function parseDays(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch (e) { return val.split(',').map(Number); }
    }
    return [];
  }

  function fmtTime(t) {
    if (!t) return '';
    var s = String(t);
    if (s.length >= 5) return s.slice(0, 5);
    return s;
  }

  // ── Create/Edit Modal ──
  async function showActivityModal(editId) {
    var isEdit = !!editId;
    var act = {};

    if (isEdit) {
      var r = await Gfp.get('/activities/' + editId);
      if (!r.ok || !r.data) { toast(errMsg(r), 'error'); return; }
      act = r.data;
    }

    if (!staffList) {
      try {
        var sr = await Gfp.get('/admin/staff');
        if (sr.ok && Array.isArray(sr.data)) staffList = sr.data;
        else staffList = [];
      } catch (e) { staffList = []; }
    }

    var modal = document.getElementById('modalContent');
    modal.innerHTML = buildModalHTML(act, isEdit);
    openOverlay('modalOverlay');

    // Kind selector
    var kindCards = modal.querySelectorAll('.kind-card');
    kindCards.forEach(function (kc) {
      kc.addEventListener('click', function () {
        if (isEdit) return;
        kindCards.forEach(function (c) { c.classList.remove('selected'); });
        this.classList.add('selected');
        this.querySelector('input').checked = true;
        updateCondFields(this.querySelector('input').value);
      });
    });

    updateCondFields(act.kind || 'class');

    // Toggle wiring
    modal.querySelectorAll('.toggle input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var knob = this.parentElement.querySelector('.toggle-knob');
        if (knob) knob.style.left = this.checked ? '20px' : '2px';
      });
    });

    modal.querySelector('.modal-close').addEventListener('click', function () { closeOverlay('modalOverlay'); });

    document.getElementById('actForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = this.querySelector('.btn-primary');
      var body = collectFormData();
      if (!body) return;
      btn.disabled = true;
      btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Saving...';

      var res = isEdit
        ? await Gfp.put('/activities/' + editId, body)
        : await Gfp.post('/activities', body);

      if (res && res.ok) {
        toast(isEdit ? 'Activity updated' : 'Activity created');
        closeOverlay('modalOverlay');
        loadActivities();
      } else {
        toast(errMsg(res), 'error');
        btn.disabled = false;
        btn.innerHTML = isEdit ? '<i class="ti ti-check"></i> Update' : '<i class="ti ti-plus"></i> Create';
      }
    });
  }

  function updateCondFields(kind) {
    var classFields = document.getElementById('cond-class');
    var facilityFields = document.getElementById('cond-facility');
    if (classFields) classFields.classList.toggle('visible', kind === 'class');
    if (facilityFields) facilityFields.classList.toggle('visible', kind === 'facility');
  }

  function collectFormData() {
    var f = document.getElementById('actForm');
    var fd = new FormData(f);
    var body = {
      name: (fd.get('name') || '').trim(),
      nameAr: (fd.get('nameAr') || '').trim(),
      kind: fd.get('kind') || 'class',
      defaultCapacity: parseInt(fd.get('defaultCapacity'), 10) || null,
      bookingRequired: !!f.querySelector('[name="bookingRequired"]').checked,
      visibleToMembers: !!f.querySelector('[name="visibleToMembers"]').checked
    };
    if (!body.name) { toast('Name is required', 'error'); return null; }

    var desc = fd.get('description');
    if (desc) body.description = desc;
    var descAr = fd.get('descriptionAr');
    if (descAr) body.descriptionAr = descAr;

    if (body.kind === 'class') {
      body.defaultDurationMinutes = parseInt(fd.get('defaultDurationMinutes'), 10) || null;
      var price = parseFloat(fd.get('dropInPrice'));
      if (!isNaN(price) && price > 0) body.dropInPrice = price;
    }
    return body;
  }

  function buildModalHTML(a, isEdit) {
    var v = a || {};
    var selKind = v.kind || 'class';
    var bookReq = v.bookingRequired != null ? v.bookingRequired : true;
    var visible = v.visibleToMembers != null ? v.visibleToMembers : true;

    return '<div class="modal-header">' +
      '<div><h2>' + (isEdit ? 'Edit Activity' : 'New Activity') + '</h2>' +
      '<div class="modal-header-sub">' + (isEdit ? 'Update activity details' : 'Add a new class or facility') + '</div></div>' +
      '<button type="button" class="modal-close"><i class="ti ti-x"></i></button></div>' +
      '<form id="actForm"><div class="modal-body">' +

      '<div class="fg"><label>Type <span class="req">*</span></label>' +
      (isEdit ? '<div class="modal-header-sub" style="margin-bottom:8px">Type is fixed after creation</div>' : '') +
      '</div>' +
      '<div class="kind-selector">' +
      '<div class="kind-card ' + (selKind === 'class' ? 'selected' : '') + (isEdit && selKind !== 'class' ? '" style="opacity:.4;pointer-events:none' : '') + '">' +
      '<input type="radio" name="kind" value="class" ' + (selKind === 'class' ? 'checked' : '') + (isEdit && selKind !== 'class' ? ' disabled' : '') + '>' +
      '<div class="kind-card-icon" style="background:var(--inf100);color:var(--inf500)"><i class="ti ti-run"></i></div>' +
      '<div class="kind-card-name">Class</div>' +
      '<div class="kind-card-desc">CrossFit, Yoga, Boxing...</div></div>' +
      '<div class="kind-card ' + (selKind === 'facility' ? 'selected' : '') + (isEdit && selKind !== 'facility' ? '" style="opacity:.4;pointer-events:none' : '') + '">' +
      '<input type="radio" name="kind" value="facility" ' + (selKind === 'facility' ? 'checked' : '') + (isEdit && selKind !== 'facility' ? ' disabled' : '') + '>' +
      '<div class="kind-card-icon" style="background:var(--purple100);color:var(--purple)"><i class="ti ti-pool"></i></div>' +
      '<div class="kind-card-name">Facility</div>' +
      '<div class="kind-card-desc">Sauna, Pool, Steam Room...</div></div></div>' +

      '<div class="form-row">' +
      '<div class="fg"><label>Name (English) <span class="req">*</span></label><input name="name" value="' + esc(v.name || '') + '" required placeholder="e.g. CrossFit"></div>' +
      '<div class="fg"><label>Name (Arabic)</label><input name="nameAr" value="' + esc(v.nameAr || '') + '" placeholder="مثال: كروس فت" dir="rtl" style="font-family:var(--fa)"></div></div>' +

      '<div class="fg"><label>Capacity</label><input type="number" name="defaultCapacity" min="1" value="' + (v.defaultCapacity || '') + '" placeholder="e.g. 15"></div>' +

      '<div class="cond-section" id="cond-class">' +
      '<div class="cond-title"><i class="ti ti-run"></i> Class Options</div>' +
      '<div class="form-row">' +
      '<div class="fg"><label>Duration (minutes)</label><input type="number" name="defaultDurationMinutes" min="1" value="' + (v.defaultDurationMinutes || '') + '" placeholder="e.g. 60"></div>' +
      '<div class="fg"><label>Drop-in Price (EGP)</label><input type="number" name="dropInPrice" step="0.01" min="0" value="' + (v.dropInPrice || '') + '" placeholder="0 = free / included only"></div></div></div>' +

      '<div class="cond-section" id="cond-facility">' +
      '<div class="cond-title"><i class="ti ti-pool"></i> Facility Notes</div>' +
      '<div class="modal-header-sub">Facilities can be included in membership plans via entitlements. Toggle "Booking Required" below if members must book a slot.</div></div>' +

      '<div class="toggle-row"><span class="toggle-label">Booking Required</span>' +
      '<label class="toggle"><input type="checkbox" name="bookingRequired" ' + (bookReq ? 'checked' : '') + '>' +
      '<div class="toggle-track"></div><div class="toggle-knob" style="left:' + (bookReq ? '20px' : '2px') + '"></div></label></div>' +

      '<div class="toggle-row"><span class="toggle-label">Visible to Members (App)</span>' +
      '<label class="toggle"><input type="checkbox" name="visibleToMembers" ' + (visible ? 'checked' : '') + '>' +
      '<div class="toggle-track"></div><div class="toggle-knob" style="left:' + (visible ? '20px' : '2px') + '"></div></label></div>' +

      '<div class="form-row">' +
      '<div class="fg"><label>Description (English)</label><textarea name="description" placeholder="Optional...">' + esc(v.description || '') + '</textarea></div>' +
      '<div class="fg"><label>Description (Arabic)</label><textarea name="descriptionAr" placeholder="وصف..." dir="rtl" style="font-family:var(--fa)">' + esc(v.descriptionAr || '') + '</textarea></div></div>' +

      '</div><div class="modal-footer">' +
      '<button type="button" class="btn-cancel" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'show\')">Cancel</button>' +
      '<button type="submit" class="btn-primary">' + (isEdit ? '<i class="ti ti-check"></i> Update' : '<i class="ti ti-plus"></i> Create') + '</button></div></form>';
  }

  // ── Delete ──
  async function showDeleteConfirm(id) {
    var act = allActivities.find(function (a) { return a.id === id; });
    if (!act) return;
    var dlg = document.getElementById('deleteDialog');
    dlg.innerHTML =
      '<div class="del-icon warn"><i class="ti ti-trash"></i></div>' +
      '<div class="del-title">Delete "' + esc(act.name) + '"?</div>' +
      '<div class="del-msg">This will deactivate the activity. It will no longer be available for scheduling or booking.</div>' +
      '<div class="del-actions">' +
      '<button class="btn-cancel" id="delCancel">Cancel</button>' +
      '<button class="btn-primary" style="background:var(--dng500);box-shadow:0 2px 8px rgba(239,68,68,.3)" id="delConfirm"><i class="ti ti-trash"></i> Delete</button></div>';
    openOverlay('deleteOverlay');
    document.getElementById('delCancel').addEventListener('click', function () { closeOverlay('deleteOverlay'); });
    document.getElementById('delConfirm').addEventListener('click', async function () {
      this.disabled = true;
      var res = await Gfp.del('/activities/' + id);
      if (res.ok || res.status === 204) {
        closeOverlay('deleteOverlay');
        toast('Activity deleted');
        loadActivities();
      } else {
        closeOverlay('deleteOverlay');
        toast(errMsg(res), 'error');
      }
    });
  }

  // ── Schedule Modal ──
  async function showScheduleModal(actId) {
    var act = allActivities.find(function (a) { return a.id === actId; });
    if (!act) return;

    if (!staffList) {
      try {
        var sr = await Gfp.get('/admin/staff');
        if (sr.ok && Array.isArray(sr.data)) staffList = sr.data;
        else staffList = [];
      } catch (e) { staffList = []; }
    }

    var schedR = await Gfp.get('/activities/' + actId + '/schedules');
    var schedules = (schedR.ok && Array.isArray(schedR.data)) ? schedR.data : (act._schedules || []);

    var modal = document.getElementById('scheduleContent');
    modal.innerHTML = buildScheduleModalHTML(act, schedules);
    openOverlay('scheduleOverlay');

    modal.querySelector('.modal-close').addEventListener('click', function () { closeOverlay('scheduleOverlay'); });

    // Day check toggles
    modal.querySelectorAll('.day-check').forEach(function (dc) {
      dc.addEventListener('click', function () {
        var inp = this.querySelector('input');
        inp.checked = !inp.checked;
        this.classList.toggle('checked', inp.checked);
      });
    });

    // Add schedule form
    document.getElementById('schedForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      var days = [];
      this.querySelectorAll('.day-check input:checked').forEach(function (inp) { days.push(parseInt(inp.value, 10)); });
      if (!days.length) { toast('Select at least one day', 'error'); return; }
      var startTime = fd.get('startTime');
      var endTime = fd.get('endTime');
      if (!startTime || !endTime) { toast('Start and end time required', 'error'); return; }

      var body = {
        daysOfWeek: days,
        startTime: startTime + ':00',
        endTime: endTime + ':00'
      };
      var cap = parseInt(fd.get('capacity'), 10);
      if (cap > 0) body.capacity = cap;
      var coachId = fd.get('coachUserId');
      if (coachId) body.coachUserId = coachId;
      var effFrom = fd.get('effectiveFrom');
      if (effFrom) body.effectiveFrom = effFrom;
      var effUntil = fd.get('effectiveUntil');
      if (effUntil) body.effectiveUntil = effUntil;

      var btn = this.querySelector('.btn-primary');
      btn.disabled = true;
      var res = await Gfp.post('/activities/' + actId + '/schedules', body);
      if (res && res.ok) {
        toast('Schedule added');
        closeOverlay('scheduleOverlay');
        loadActivities();
      } else {
        toast(errMsg(res), 'error');
        btn.disabled = false;
      }
    });

    // Delete schedule buttons
    modal.querySelectorAll('[data-sched-del]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var sid = this.dataset.schedDel;
        this.disabled = true;
        var res = await Gfp.del('/activity-schedules/' + sid);
        if (res.ok || res.status === 204) {
          toast('Schedule removed');
          closeOverlay('scheduleOverlay');
          loadActivities();
        } else {
          toast(errMsg(res), 'error');
          this.disabled = false;
        }
      });
    });
  }

  function buildScheduleModalHTML(act, schedules) {
    var coachOptions = '<option value="">— No coach —</option>';
    if (staffList && staffList.length) {
      coachOptions += staffList.map(function (s) {
        var name = s.fullName || s.name || (s.firstName + ' ' + s.lastName) || s.email || 'Staff';
        return '<option value="' + s.id + '">' + esc(name) + '</option>';
      }).join('');
    }

    var schedList = '';
    if (schedules.length) {
      schedList = '<div class="sched-list">' + schedules.map(function (s) {
        var days = parseDays(s.daysOfWeek);
        var dayStr = days.map(function (d) { return DAYS_SHORT[d] || d; }).join(', ');
        var time = fmtTime(s.startTime) + ' – ' + fmtTime(s.endTime);
        var coach = s.coachName || '';
        var cap = s.capacity ? 'Cap: ' + s.capacity : '';
        var sub = [coach, cap].filter(Boolean).join(' · ');
        return '<div class="sched-row">' +
          '<div class="sched-row-info"><strong>' + dayStr + '</strong> ' + time +
          (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' +
          '<div class="sched-row-actions">' +
          '<button class="sched-row-btn del" data-sched-del="' + s.id + '" title="Remove"><i class="ti ti-trash"></i></button></div></div>';
      }).join('') + '</div>';
    }

    return '<div class="modal-header"><div><h2>Schedule — ' + esc(act.name) + '</h2>' +
      '<div class="modal-header-sub">Recurring class schedule. Sessions are generated from these rules.</div></div>' +
      '<button type="button" class="modal-close"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body">' +

      (schedList || '<div class="modal-header-sub" style="margin-bottom:16px">No schedules yet. Add one below.</div>') +

      '<div style="margin-top:20px;padding-top:16px;border-top:2px dashed var(--ls3)">' +
      '<div class="cond-title"><i class="ti ti-plus"></i> Add Schedule</div>' +
      '<form id="schedForm">' +
      '<div class="fg"><label>Days of Week <span class="req">*</span></label>' +
      '<div class="day-checks">' +
      DAYS.map(function (d, i) {
        return '<div class="day-check"><input type="checkbox" value="' + i + '"><span>' + DAYS_SHORT[i] + '</span></div>';
      }).join('') + '</div></div>' +

      '<div class="form-row">' +
      '<div class="fg"><label>Start Time <span class="req">*</span></label><input type="time" name="startTime" required></div>' +
      '<div class="fg"><label>End Time <span class="req">*</span></label><input type="time" name="endTime" required></div></div>' +

      '<div class="form-row">' +
      '<div class="fg"><label>Capacity (override)</label><input type="number" name="capacity" min="1" placeholder="Default: ' + (act.defaultCapacity || 'none') + '"></div>' +
      '<div class="fg"><label>Coach</label><select name="coachUserId">' + coachOptions + '</select></div></div>' +

      '<div class="form-row">' +
      '<div class="fg"><label>Effective From</label><input type="date" name="effectiveFrom"></div>' +
      '<div class="fg"><label>Effective Until</label><input type="date" name="effectiveUntil"></div></div>' +

      '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">' +
      '<button type="button" class="btn-cancel" onclick="document.getElementById(\'scheduleOverlay\').classList.remove(\'show\')">Close</button>' +
      '<button type="submit" class="btn-primary"><i class="ti ti-plus"></i> Add Schedule</button></div>' +
      '</form></div></div>';
  }

  // ── Overlay click-to-close ──
  ['modalOverlay', 'deleteOverlay', 'scheduleOverlay'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      if (e.target === this) closeOverlay(id);
    });
  });

  // ── Init ──
  document.getElementById('btnCreate').addEventListener('click', function () { showActivityModal(); });
  loadActivities();
})();
