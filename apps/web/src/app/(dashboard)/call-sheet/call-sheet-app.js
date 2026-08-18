(function () {
  'use strict';
  var Gfp = window.GfpApi;
  if (!Gfp) return;

  var dateChip = 'today';
  var filters = { status: '', reason: '', priority: '', assignee: '' };
  var items = [];
  var summary = {};
  var selectedId = null;
  var addMember = null;
  var outFollow = null;
  var outPick = 'reached';
  var nextPick = 'call_tomorrow';
  var searchTimer = null;
  var memberTimer = null;

  var OUTCOMES = [
    ['reached', 'Reached'],
    ['no_answer', 'No answer'],
    ['busy', 'Busy'],
    ['wrong_number', 'Wrong number'],
    ['not_interested', 'Not interested'],
    ['will_visit', 'Will visit'],
    ['renewed', 'Renewed'],
    ['needs_follow_up', 'Needs follow-up']
  ];
  var NEXT = [
    ['call_tomorrow', 'Call tomorrow'],
    ['call_in_3_days', 'Call in 3 days'],
    ['member_will_visit', 'Member will visit'],
    ['member_renewed', 'Member renewed'],
    ['not_interested', 'Not interested'],
    ['wrong_number', 'Wrong number'],
    ['no_answer', 'No answer'],
    ['completed', 'Completed'],
    ['custom', 'Custom']
  ];
  var REASON_LBL = {
    renewal: 'Renewal', trial: 'Trial', payment: 'Payment', welcome: 'Welcome',
    inactive: 'Inactive', offer: 'Offer', custom: 'Custom'
  };
  var PRI_LBL = { high: 'High', medium: 'Medium', low: 'Low' };
  var NEXT_LBL = {
    call_tomorrow: 'Call tomorrow', call_in_3_days: 'Call in 3 days',
    member_will_visit: 'Member will visit', member_renewed: 'Member renewed',
    not_interested: 'Not interested', wrong_number: 'Wrong number',
    no_answer: 'No answer', completed: 'Completed', custom: 'Custom'
  };

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2800);
  }
  function err(r) {
    var d = r && r.data;
    return (d && (d.detail || d.message || d.title)) || 'Could not load Call Sheet';
  }
  function isOpen(st) {
    return st === 'pending' || st === 'in_progress' || st === 'contacted' || st === 'no_answer';
  }
  function cairoDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  }
  function todayCairo() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  }
  function relContact(iso) {
    if (!iso) return 'Never';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    var days = Math.round((Date.now() - t) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return days + ' days ago';
  }
  function nextLabel(row) {
    if (row.nextAction && NEXT_LBL[row.nextAction]) return NEXT_LBL[row.nextAction];
    var due = cairoDay(row.dueAtUtc);
    var td = todayCairo();
    if (due && due < td && isOpen(row.status)) return 'Overdue';
    if (due === td) return 'Call today';
    return due || '—';
  }
  function waHref(phone) {
    var d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '20' + d.slice(1);
    if (d.length < 10) return '';
    return 'https://wa.me/' + d;
  }
  function telHref(phone) {
    var d = String(phone || '').replace(/\s/g, '');
    return d ? 'tel:' + d : '';
  }
  function activeFilterCount() {
    var n = 0;
    if (filters.status) n += 1;
    if (filters.reason) n += 1;
    if (filters.priority) n += 1;
    if (filters.assignee) n += 1;
    return n;
  }
  function qs() {
    var p = new URLSearchParams();
    p.set('date', dateChip);
    if (filters.status) p.set('status', filters.status);
    if (filters.reason) p.set('reason', filters.reason);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.assignee) p.set('assignee', filters.assignee);
    var q = (document.getElementById('searchQ').value || '').trim();
    if (q) p.set('q', q);
    return p.toString();
  }

  async function load() {
    var r = await Gfp.get('/call-sheet?' + qs());
    var root = document.getElementById('queue');
    if (!r.ok) {
      root.innerHTML = '<div class="empty"><p>' + esc(err(r)) + '</p></div>';
      return;
    }
    var data = r.data || {};
    items = Array.isArray(data.items) ? data.items : [];
    summary = data.summary || {};
    renderKpis();
    renderOverdue();
    renderQueue();
  }

  function renderKpis() {
    var el = document.getElementById('kpis');
    var cells = [
      [summary.toCallToday || 0, 'To call today', false],
      [summary.highPriority || 0, 'High priority', true],
      [summary.pending || 0, 'Pending', false],
      [summary.contactedToday || 0, 'Contacted', false],
      [summary.noAnswerToday || 0, 'No answer', false]
    ];
    el.innerHTML = cells.map(function (c) {
      return '<div class="kpi' + (c[2] ? ' urg' : '') + '"><div class="n">' + c[0] + '</div><div class="l">' + c[1] + '</div></div>';
    }).join('');
  }

  function renderOverdue() {
    var bar = document.getElementById('overdueBar');
    var n = summary.overdue || 0;
    if (n > 0 && dateChip !== 'overdue') {
      bar.hidden = false;
      document.getElementById('overdueCopy').textContent =
        n + ' overdue follow-up' + (n === 1 ? '' : 's') + ' — they stay above today until completed.';
    } else {
      bar.hidden = true;
    }
  }

  function rowHtml(r, extraCls) {
    var pri = r.priority || 'medium';
    var cls = extraCls || '';
    if (pri === 'high' && isOpen(r.status)) cls += ' hi';
    if (cairoDay(r.dueAtUtc) < todayCairo() && isOpen(r.status)) cls += ' od';
    if (r.status === 'completed') cls += ' done';
    var tel = telHref(r.phoneNumber);
    var wa = waHref(r.phoneNumber);
    return (
      '<div class="row' + cls + '" data-open="' + esc(r.id) + '">' +
        '<div class="who"><div class="nm">' + esc(r.fullName) + '</div>' +
        '<div class="why">' + esc(r.why || REASON_LBL[r.reason] || r.reason) + '</div>' +
        '<div class="id">' + esc(r.memberNumber || '') + '</div></div>' +
        '<div class="tags"><span class="tag">' + esc(REASON_LBL[r.reason] || r.reason) + '</span>' +
        '<span class="tag' + (pri === 'high' ? ' hi' : pri === 'low' ? ' lo' : '') + '">' + esc(PRI_LBL[pri] || pri) + '</span></div>' +
        '<div class="meta-cell"><b>Last contact</b>' + esc(relContact(r.lastContactAtUtc)) + '</div>' +
        '<div class="meta-cell"><b>Next action</b>' + esc(nextLabel(r)) + '</div>' +
        '<div class="acts">' +
          (tel ? '<a class="btn sm" href="' + esc(tel) + '" data-call="' + esc(r.id) + '"><i class="ti ti-phone"></i> Call</a>' : '') +
          (wa ? '<a class="btn sm" target="_blank" rel="noopener" href="' + esc(wa) + '"><i class="ti ti-brand-whatsapp"></i> WhatsApp</a>' : '') +
          (isOpen(r.status) ? '<button type="button" class="btn sm" data-done="' + esc(r.id) + '">Done</button>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function section(title, rows, extraCls) {
    if (!rows.length) return '';
    return (
      '<section class="sec"><div class="sec-h"><h2>' + esc(title) + '</h2><span class="meta">' + rows.length + '</span></div>' +
      '<div class="queue">' + rows.map(function (r) { return rowHtml(r, extraCls); }).join('') + '</div></section>'
    );
  }

  function renderQueue() {
    var root = document.getElementById('queue');
    if (!items.length) {
      root.innerHTML =
        '<div class="empty"><i class="ti ti-circle-check"></i><h3>You\'re all caught up</h3>' +
        '<p>No follow-ups require your attention today.</p>' +
        '<button type="button" class="btn primary" id="btnEmptyAdd"><i class="ti ti-plus"></i> Add Follow-up</button></div>';
      var b = document.getElementById('btnEmptyAdd');
      if (b) b.onclick = openAdd;
      return;
    }
    var td = todayCairo();
    var overdue = items.filter(function (i) { return isOpen(i.status) && cairoDay(i.dueAtUtc) < td; });
    var high = items.filter(function (i) {
      return isOpen(i.status) && i.priority === 'high' && cairoDay(i.dueAtUtc) >= td;
    });
    var todayOpen = items.filter(function (i) {
      return isOpen(i.status) && cairoDay(i.dueAtUtc) === td && i.priority !== 'high';
    });
    var done = items.filter(function (i) { return i.status === 'completed'; });
    var rest = items.filter(function (i) {
      return overdue.indexOf(i) < 0 && high.indexOf(i) < 0 && todayOpen.indexOf(i) < 0 && done.indexOf(i) < 0;
    });
    root.innerHTML =
      section('Overdue', overdue) +
      section('High priority', high) +
      section(dateChip === 'today' ? 'Today' : 'Queue', todayOpen.concat(rest)) +
      section('Completed today', done, ' done');
  }

  function choiceHtml(list, selected, attr) {
    return list.map(function (p) {
      return '<button type="button" class="' + (selected === p[0] ? 'act' : '') + '" data-' + attr + '="' + p[0] + '">' + p[1] + '</button>';
    }).join('');
  }

  async function openPanel(id) {
    selectedId = id;
    var ov = document.getElementById('drawerOv');
    ov.hidden = false;
    document.getElementById('drawerBody').innerHTML = '<p class="muted">Loading…</p>';
    var r = await Gfp.get('/call-sheet/' + encodeURIComponent(id));
    if (!r.ok) {
      document.getElementById('drawerBody').innerHTML = '<p class="muted">' + esc(err(r)) + '</p>';
      return;
    }
    var f = r.data || {};
    var memberR = await Gfp.get('/members/' + encodeURIComponent(f.memberId));
    var member = memberR.ok ? (memberR.data || {}) : {};
    var debtR = await Gfp.get('/debtors?memberId=' + encodeURIComponent(f.memberId) + '&pageSize=5');
    var due = 0;
    if (debtR.ok && debtR.data) {
      var list = debtR.data.items || debtR.data || [];
      if (Array.isArray(list) && list[0]) due = Number(list[0].totalDue || list[0].amountDue || 0);
    }
    var ms = member.currentMembership || {};
    var att = Array.isArray(member.recentAttendance) ? member.recentAttendance : [];
    var lastAtt = att[0] ? att[0].checkInAtUtc : null;
    var photo = member.profilePhotoUrl || f.profilePhotoUrl;
    var initials = String(f.fullName || 'M').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    document.getElementById('drawerTitle').textContent = f.fullName || 'Member';
    document.getElementById('drawerMeta').textContent = (f.memberNumber || '') + (f.phoneNumber ? ' · ' + f.phoneNumber : '');
    document.getElementById('drawerBody').innerHTML =
      '<div class="phead"><div class="av">' + (photo ? '<img src="' + esc(photo) + '" alt="">' : esc(initials)) + '</div>' +
      '<div><div class="nm">' + esc(f.fullName) + '</div><div class="drawer-id">' + esc(REASON_LBL[f.reason] || f.reason) + ' · ' + esc(PRI_LBL[f.priority] || f.priority) + '</div></div></div>' +
      '<div class="block"><h3>Membership</h3>' +
        '<div class="kv"><span>Plan</span><b>' + esc(ms.planName || '—') + '</b></div>' +
        '<div class="kv"><span>Start</span><span>' + esc(ms.startDate || '—') + '</span></div>' +
        '<div class="kv"><span>End</span><span>' + esc(ms.endDate || '—') + '</span></div>' +
        '<div class="kv"><span>Status</span><span>' + esc(ms.status || '—') + '</span></div>' +
        (ms.sessionsRemaining != null ? '<div class="kv"><span>Sessions left</span><span>' + esc(ms.sessionsRemaining) + '</span></div>' : '') +
        '<p class="fine">Read from covering membership. Call Sheet does not own this status.</p></div>' +
      '<div class="block"><h3>Financial</h3>' +
        '<div class="kv"><span>Outstanding</span><b>EGP ' + due.toFixed(2) + '</b></div>' +
        '<p class="fine">Outstanding = Sale.AmountDue. Collect Payment stays on Member 360.</p></div>' +
      '<div class="block"><h3>Attendance</h3>' +
        '<div class="kv"><span>Last visit</span><span>' + esc(lastAtt ? new Date(lastAtt).toLocaleString() : '—') + '</span></div>' +
        '<div class="kv"><span>Recent</span><span>' + att.length + ' in last records</span></div></div>' +
      '<div class="block"><h3>Follow-up history</h3>' + historyHtml(f.history) + '</div>';
    var tel = telHref(f.phoneNumber);
    var wa = waHref(f.phoneNumber);
    document.getElementById('drawerFt').innerHTML =
      (tel ? '<a class="btn sm primary" href="' + esc(tel) + '" data-call="' + esc(f.id) + '"><i class="ti ti-phone"></i> Call</a>' : '') +
      (wa ? '<a class="btn sm" target="_blank" rel="noopener" href="' + esc(wa) + '"><i class="ti ti-brand-whatsapp"></i> WhatsApp</a>' : '') +
      (isOpen(f.status) ? '<button type="button" class="btn sm" data-done="' + esc(f.id) + '">Done</button>' : '') +
      '<a class="btn sm ghost" href="/dashboard/members/' + encodeURIComponent(f.memberId) + '/">Member 360</a>';
  }

  function historyHtml(list) {
    if (!list || !list.length) return '<p class="muted">No calls logged yet.</p>';
    return list.map(function (h) {
      var when = h.atUtc ? new Date(h.atUtc).toLocaleString() : '';
      var bits = [OUTCOMES.filter(function (o) { return o[0] === h.outcome; })[0] ? OUTCOMES.filter(function (o) { return o[0] === h.outcome; })[0][1] : h.outcome];
      if (h.nextAction) bits.push('Next: ' + (NEXT_LBL[h.nextAction] || h.nextAction));
      if (h.note) bits.push(h.note);
      return '<div class="tl-item"><div class="tl-t">' + esc(when) + (h.staffName ? ' · ' + esc(h.staffName) : '') + '</div><div class="tl-m">' + esc(bits.join('. ')) + '</div></div>';
    }).join('');
  }

  function closePanel() {
    document.getElementById('drawerOv').hidden = true;
    selectedId = null;
  }

  function openAdd() {
    addMember = null;
    document.getElementById('addMemberQ').value = '';
    document.getElementById('addMemberResults').hidden = true;
    document.getElementById('addMemberSelected').hidden = true;
    document.getElementById('addNote').value = '';
    var due = document.getElementById('addDue');
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    due.value = d.toISOString().slice(0, 16);
    document.getElementById('addOv').hidden = false;
    document.getElementById('addMemberQ').focus();
  }
  function closeAdd() { document.getElementById('addOv').hidden = true; }

  async function searchMembers(q) {
    var box = document.getElementById('addMemberResults');
    if (!q || q.length < 2) { box.hidden = true; return; }
    var r = await Gfp.get('/members?search=' + encodeURIComponent(q) + '&pageSize=8');
    var list = (r.ok && r.data && (r.data.items || r.data)) || [];
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<button type="button" disabled>No members found</button>';
      box.hidden = false;
      return;
    }
    box.innerHTML = list.map(function (m) {
      return '<button type="button" data-pick="' + esc(m.id) + '" data-name="' + esc(m.fullName) + '" data-phone="' + esc(m.phone || m.phoneNumber || '') + '" data-no="' + esc(m.memberNumber || '') + '">' +
        esc(m.fullName) + ' · ' + esc(m.memberNumber || '') + '</button>';
    }).join('');
    box.hidden = false;
  }

  function openOutcome(id) {
    outFollow = items.filter(function (x) { return x.id === id; })[0] || { id: id };
    outPick = 'reached';
    nextPick = 'call_tomorrow';
    document.getElementById('outTitle').textContent = 'Log call — ' + (outFollow.fullName || '');
    document.getElementById('outHint').textContent = outFollow.why || '';
    document.getElementById('outNote').value = '';
    document.getElementById('outChoices').innerHTML = choiceHtml(OUTCOMES, outPick, 'out');
    document.getElementById('nextChoices').innerHTML = choiceHtml(NEXT, nextPick, 'next');
    var d = new Date();
    d.setDate(d.getDate() + 1);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('outNextAt').value = d.toISOString().slice(0, 16);
    document.getElementById('outOv').hidden = false;
  }
  function closeOut() { document.getElementById('outOv').hidden = true; outFollow = null; }

  async function saveOutcome() {
    if (!outFollow) return;
    var nextAt = document.getElementById('outNextAt').value;
    var body = {
      outcome: outPick,
      note: (document.getElementById('outNote').value || '').trim() || null,
      nextAction: nextPick,
      nextActionAtUtc: nextAt ? new Date(nextAt).toISOString() : null
    };
    var r = await Gfp.post('/call-sheet/' + encodeURIComponent(outFollow.id) + '/outcome', body);
    if (!r.ok) { toast(err(r)); return; }
    closeOut();
    toast('Outcome recorded');
    await load();
    if (selectedId) openPanel(selectedId);
  }

  async function markDone(id) {
    var r = await Gfp.post('/call-sheet/' + encodeURIComponent(id) + '/complete', {});
    if (!r.ok) { toast(err(r)); return; }
    toast('Follow-up completed');
    await load();
    if (selectedId === id) openPanel(id);
  }

  async function saveAdd() {
    if (!addMember) { toast('Select a member'); return; }
    var due = document.getElementById('addDue').value;
    var r = await Gfp.post('/call-sheet', {
      memberId: addMember.id,
      reason: document.getElementById('addReason').value,
      priority: document.getElementById('addPriority').value,
      dueAtUtc: due ? new Date(due).toISOString() : null,
      notes: (document.getElementById('addNote').value || '').trim() || null
    });
    if (!r.ok) { toast(err(r)); return; }
    closeAdd();
    toast('Follow-up added');
    await load();
  }

  function syncFilterCount() {
    var n = activeFilterCount();
    var el = document.getElementById('filterCount');
    el.hidden = n === 0;
    el.textContent = String(n);
  }

  document.getElementById('dateChips').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-date]');
    if (!btn) return;
    dateChip = btn.getAttribute('data-date');
    document.querySelectorAll('#dateChips .chip').forEach(function (c) {
      c.classList.toggle('act', c.getAttribute('data-date') === dateChip);
    });
    load();
  });
  document.getElementById('searchQ').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
  });
  document.getElementById('btnFilters').addEventListener('click', function () {
    var pop = document.getElementById('filterPop');
    pop.hidden = !pop.hidden;
  });
  document.getElementById('btnFilterApply').addEventListener('click', function () {
    filters.status = document.getElementById('fltStatus').value;
    filters.reason = document.getElementById('fltReason').value;
    filters.priority = document.getElementById('fltPriority').value;
    filters.assignee = document.getElementById('fltAssignee').value;
    document.getElementById('filterPop').hidden = true;
    syncFilterCount();
    load();
  });
  document.getElementById('btnFilterClear').addEventListener('click', function () {
    filters = { status: '', reason: '', priority: '', assignee: '' };
    document.getElementById('fltStatus').value = '';
    document.getElementById('fltReason').value = '';
    document.getElementById('fltPriority').value = '';
    document.getElementById('fltAssignee').value = '';
    document.getElementById('filterPop').hidden = true;
    syncFilterCount();
    load();
  });
  document.getElementById('btnAdd').addEventListener('click', openAdd);
  document.getElementById('btnAddCancel').addEventListener('click', closeAdd);
  document.getElementById('btnAddSave').addEventListener('click', saveAdd);
  document.getElementById('addOv').addEventListener('click', function (e) { if (e.target.id === 'addOv') closeAdd(); });
  document.getElementById('addMemberQ').addEventListener('input', function () {
    clearTimeout(memberTimer);
    var q = this.value.trim();
    memberTimer = setTimeout(function () { searchMembers(q); }, 250);
  });
  document.getElementById('addMemberResults').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pick]');
    if (!btn) return;
    addMember = { id: btn.getAttribute('data-pick'), name: btn.getAttribute('data-name') };
    document.getElementById('addMemberSelected').hidden = false;
    document.getElementById('addMemberSelected').textContent = btn.getAttribute('data-name') + ' · ' + (btn.getAttribute('data-no') || '');
    document.getElementById('addMemberResults').hidden = true;
  });
  document.getElementById('btnDrawerClose').addEventListener('click', closePanel);
  document.getElementById('drawerOv').addEventListener('click', function (e) { if (e.target.id === 'drawerOv') closePanel(); });
  document.getElementById('queue').addEventListener('click', function (e) {
    var done = e.target.closest('[data-done]');
    if (done) { e.preventDefault(); e.stopPropagation(); markDone(done.getAttribute('data-done')); return; }
    var call = e.target.closest('[data-call]');
    if (call) { e.stopPropagation(); openOutcome(call.getAttribute('data-call')); return; }
    var row = e.target.closest('[data-open]');
    if (row) openPanel(row.getAttribute('data-open'));
  });
  document.getElementById('drawerFt').addEventListener('click', function (e) {
    var done = e.target.closest('[data-done]');
    if (done) { e.preventDefault(); markDone(done.getAttribute('data-done')); return; }
    var call = e.target.closest('[data-call]');
    if (call) { openOutcome(call.getAttribute('data-call')); }
  });
  document.getElementById('outChoices').addEventListener('click', function (e) {
    var b = e.target.closest('[data-out]');
    if (!b) return;
    outPick = b.getAttribute('data-out');
    document.getElementById('outChoices').innerHTML = choiceHtml(OUTCOMES, outPick, 'out');
  });
  document.getElementById('nextChoices').addEventListener('click', function (e) {
    var b = e.target.closest('[data-next]');
    if (!b) return;
    nextPick = b.getAttribute('data-next');
    document.getElementById('nextChoices').innerHTML = choiceHtml(NEXT, nextPick, 'next');
  });
  document.getElementById('btnOutCancel').addEventListener('click', closeOut);
  document.getElementById('btnOutSave').addEventListener('click', saveOutcome);
  document.getElementById('outOv').addEventListener('click', function (e) { if (e.target.id === 'outOv') closeOut(); });

  load();
})();
