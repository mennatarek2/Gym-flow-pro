(function () {
  var R = window.GfpStaffRules;
  var role = user && user.role;
  if (window.GfpAuthz && typeof window.GfpAuthz.getUserRole === 'function') {
    role = window.GfpAuthz.getUserRole() || role;
  }
  var isOwner = R && R.isOwnerRole(role);
  var guard = document.getElementById('ownerGuard');
  var content = document.getElementById('staffContent');
  if (!isOwner) {
    if (content) content.style.display = 'none';
    if (guard) {
      guard.hidden = false;
      guard.classList.add('is-on');
    }
    return;
  }
  if (guard) {
    guard.hidden = true;
    guard.classList.remove('is-on');
  }
  if (content) content.style.removeProperty('display');

  var tbody = document.getElementById('staffBody');
  var allStaff = [];
  /** @type {string} ApplicationUser.Id — Identity / JWT sub, not AppUser.Id */
  var openStaffId = null;

  var avColors = {
    Owner: { bg: 'rgba(217,119,6,.12)', fg: '#D97706' },
    Manager: { bg: 'rgba(59,130,246,.12)', fg: '#3B82F6' },
    Trainer: { bg: 'rgba(13,148,136,.12)', fg: '#0D9488' },
    Receptionist: { bg: 'rgba(139,92,246,.12)', fg: '#7C3AED' }
  };

  function toast(msg, type) {
    return globalThis.toastShared(msg, type);
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function initials(name) {
    return (name || '?').split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function staffId(s) { return s.id; }
  function roleKey(s) { return R.canonicalRole(s.role); }
  function roleMeta(s) { return R.ROLE_META[roleKey(s)] || R.ROLE_META.Trainer; }
  function colors(s) { return avColors[roleKey(s)] || avColors.Trainer; }

  function deptOptions(selected) {
    var cur = selected || '';
    return '<option value="">—</option>' + (R.DEPARTMENTS || []).map(function (d) {
      return '<option value="' + esc(d) + '"' + (d === cur ? ' selected' : '') + '>' + esc(d) + '</option>';
    }).join('');
  }

  function kv(label, value) {
    if (value == null || value === '') return '';
    return '<div class="kv"><span>' + esc(label) + '</span><b>' + esc(String(value)) + '</b></div>';
  }

  function hireInputValue(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 10);
  }

  function workFieldsHtml(s) {
    s = s || {};
    return '' +
      '<div class="fg"><label>Phone</label><input name="phoneNumber" value="' + esc(s.phoneNumber || '') + '" placeholder="01xxxxxxxxx" maxlength="20"></div>' +
      '<div class="fg"><label>Job title</label><input name="jobTitle" value="' + esc(s.jobTitle || '') + '" placeholder="e.g. Front Desk Supervisor" maxlength="80"></div>' +
      '<div class="fg"><label>Department</label><select name="department">' + deptOptions(s.department) + '</select></div>' +
      '<div class="fg"><label>Hire date</label><input type="date" name="hireDate" value="' + esc(hireInputValue(s.hireDate)) + '"></div>' +
      '<div class="fg"><label>Notes</label><textarea name="notes" rows="3" maxlength="2000" placeholder="Ops notes for the owner">' + esc(s.notes || '') + '</textarea></div>';
  }

  function collectWork(fd) {
    var hire = String(fd.get('hireDate') || '').trim();
    var work = {
      phoneNumber: String(fd.get('phoneNumber') || '').trim(),
      jobTitle: String(fd.get('jobTitle') || '').trim(),
      department: String(fd.get('department') || '').trim(),
      notes: String(fd.get('notes') || '').trim()
    };
    if (hire) work.hireDate = hire;
    return work;
  }

  function apiErr(res, fallback) {
    var d = res && res.data;
    if (!d) return fallback;
    if (d.message || d.error) return d.message || d.error;
    if (d.detail) return d.detail;
    if (d.errors) {
      var key = Object.keys(d.errors)[0];
      var first = key ? d.errors[key] : null;
      if (Array.isArray(first) && first[0]) return first[0];
    }
    return fallback;
  }

  function roleCardsHtml(selected) {
    var sel = R.isCreatableRole(selected) ? R.canonicalRole(selected) : 'Trainer';
    return R.CREATABLE_ROLES.map(function (w) {
      var m = R.ROLE_META[w];
      var ac = avColors[w];
      var on = sel === w;
      return '<div class="role-card ' + (on ? 'selected' : '') + '" data-role="' + w + '">' +
        '<input type="radio" name="role" value="' + w + '" ' + (on ? 'checked' : '') + '>' +
        '<div class="role-card-icon" style="background:' + ac.bg + ';color:' + ac.fg + '"><i class="ti ' + m.icon + '"></i></div>' +
        '<div class="role-card-name">' + m.label + '</div>' +
        '<div class="role-card-desc">' + (w === 'Manager' ? 'Ops, not settings' : w === 'Receptionist' ? 'Front desk' : 'Check-in') + '</div>' +
        '</div>';
    }).join('');
  }

  var roleCatalog = null;

  function roleTasksHtml(role) {
    var key = R.isCreatableRole(role) ? R.canonicalRole(role) : 'Trainer';
    var keys = R.permissionsFromCatalog(key, roleCatalog);
    var groups = R.groupsForKeys(keys, true);
    var n = keys.length;
    var customized = false;
    if (roleCatalog && roleCatalog.roles) {
      var hit = roleCatalog.roles.filter(function (r) { return r.id === key; })[0];
      customized = !!(hit && hit.isCustomized);
    }
    var body = groups.map(function (g) {
      var items = g.items.filter(function (i) { return i.allowed; }).map(function (i) {
        return '<li>' + esc(i.label) + '</li>';
      }).join('');
      return '<div class="job-tasks-grp"><div class="job-tasks-grp-name">' + esc(g.label) + '</div><ul>' + items + '</ul></div>';
    }).join('');
    return '<div class="job-tasks" id="jobTasks">' +
      '<div class="job-tasks-hd">This job can <span>' + n + ' tasks' + (customized ? ' · custom for this gym' : ' · gym default') + '</span></div>' +
      body +
      '<p class="hint">Change this person’s job here. Change the job’s tasks on <a href="/dashboard/roles/">Roles</a>.</p>' +
    '</div>';
  }

  function paintJobTasks(root) {
    var radio = root.querySelector('.role-card.selected input, input[name="role"]:checked');
    var role = radio ? radio.value : 'Trainer';
    var box = root.querySelector('#jobTasks');
    var html = roleTasksHtml(role);
    if (!box) {
      var wrap = document.createElement('div');
      wrap.innerHTML = html;
      var selector = root.querySelector('.role-selector');
      if (selector && selector.parentNode) selector.parentNode.insertBefore(wrap.firstChild, selector.nextSibling);
      return;
    }
    var next = document.createElement('div');
    next.innerHTML = html;
    box.replaceWith(next.firstChild);
  }

  function bindRoleCards(root) {
    root.querySelectorAll('.role-card').forEach(function (card) {
      card.addEventListener('click', function () {
        root.querySelectorAll('.role-card').forEach(function (c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        card.querySelector('input').checked = true;
        paintJobTasks(root);
      });
    });
    paintJobTasks(root);
  }

  function passwordChecklistHtml(idPrefix) {
    return '<div class="pw-checklist" id="' + idPrefix + 'Checklist">' +
      '<div class="pw-req" data-req="length"><i class="ti ti-circle"></i> 6+ characters</div>' +
      '<div class="pw-req" data-req="upper"><i class="ti ti-circle"></i> Uppercase letter</div>' +
      '<div class="pw-req" data-req="lower"><i class="ti ti-circle"></i> Lowercase letter</div>' +
      '<div class="pw-req" data-req="number"><i class="ti ti-circle"></i> Number</div>' +
      '</div>' +
      '<div class="hint">A special character is optional. Backend does not require one.</div>';
  }

  function paintPassword(pw, fillId, labelId, checklistSel) {
    var checks = R.checkPassword(pw);
    var met = ['length', 'upper', 'lower', 'number'].filter(function (k) { return checks[k]; }).length;
    var levels = ['', 'weak', 'fair', 'strong', 'very-strong'];
    var labels = ['', 'Weak', 'Fair', 'Strong', 'Very strong'];
    var fill = document.getElementById(fillId);
    var lbl = document.getElementById(labelId);
    fill.className = 'pw-fill ' + (levels[met] || '');
    lbl.className = 'pw-label ' + (levels[met] || '');
    lbl.textContent = pw.length > 0 ? (labels[met] || '') : '';
    document.querySelectorAll(checklistSel + ' .pw-req').forEach(function (el) {
      var req = el.dataset.req;
      if (checks[req]) {
        el.classList.add('met');
        el.querySelector('i').className = 'ti ti-circle-check-filled';
      } else {
        el.classList.remove('met');
        el.querySelector('i').className = 'ti ti-circle';
      }
    });
  }

  function openOverlay(id) { document.getElementById(id).classList.add('show'); }
  function closeOverlay(id) { document.getElementById(id).classList.remove('show'); }

  ['addModalOverlay', 'resetModalOverlay', 'deactOverlay', 'drawerOverlay'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      if (e.target === this) closeOverlay(id);
    });
  });

  function filteredStaff() {
    var q = (document.getElementById('staffSearch').value || '').trim().toLowerCase();
    var role = document.getElementById('staffRoleFilter').value;
    var status = document.getElementById('staffStatusFilter').value;
    return allStaff.filter(function (s) {
      if (role && roleKey(s) !== role) return false;
      var dept = document.getElementById('staffDeptFilter');
      var deptVal = dept ? dept.value : '';
      if (deptVal && (s.department || '') !== deptVal) return false;
      if (status === 'active' && s.isActive === false) return false;
      if (status === 'inactive' && s.isActive !== false) return false;
      if (!q) return true;
      var name = (s.fullName || '').toLowerCase();
      var email = (s.email || '').toLowerCase();
      var num = (s.staffNumber || '').toLowerCase();
      var phone = (s.phoneNumber || '').toLowerCase();
      return name.indexOf(q) !== -1 || email.indexOf(q) !== -1 || num.indexOf(q) !== -1 || phone.indexOf(q) !== -1;
    });
  }

  async function loadStaff() {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell"><div class="loader"></div>Loading staff…</td></tr>';
    var data = null;
    try {
      data = await apiGet('/admin/staff');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Could not load staff. Refresh and try again.</td></tr>';
      return;
    }
    if (data == null) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Could not load staff. Refresh and try again.</td></tr>';
      return;
    }
    allStaff = Array.isArray(data) ? data : [];
    renderTable();
  }

  function renderTable() {
    var staff = filteredStaff();
    if (!staff.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell"><i class="ti ti-users-group" style="font-size:36px;display:block;margin-bottom:8px;color:var(--ls4)"></i>No staff members found</td></tr>';
      return;
    }
    tbody.innerHTML = staff.map(function (s) {
      var role = roleMeta(s);
      var ac = colors(s);
      var login = R.formatLastLogin(s.lastLoginAt);
      var owner = R.isOwnerRole(s.role);
      var isActive = s.isActive !== false;
      var name = s.fullName || '';
      var photo = s.profilePhotoUrl
        ? '<img class="staff-av-img" src="' + esc(s.profilePhotoUrl) + '" alt="">'
        : '<div class="staff-av" style="background:' + ac.bg + ';color:' + ac.fg + '">' + initials(name) + '</div>';
      return '<tr data-id="' + esc(staffId(s)) + '">' +
        '<td><div class="staff-cell">' + photo + '<div><div class="staff-name">' + esc(name) + '</div>' +
          (s.email ? '<div class="muted" style="font-size:12px">' + esc(s.email) + '</div>' : '') +
        '</div></div></td>' +
        '<td class="mono-cell">' + esc(s.staffNumber || '—') + '</td>' +
        '<td>' + esc(s.jobTitle || '—') + '</td>' +
        '<td><span class="role-badge ' + role.cls + '"><i class="ti ' + role.icon + '"></i>' + role.label + '</span></td>' +
        '<td>' + esc(s.department || '—') + '</td>' +
        '<td><span class="status-badge ' + (isActive ? 'active' : 'inactive') + '"><span class="dot"></span>' + (isActive ? 'Active' : 'Inactive') + '</span></td>' +
        '<td><div class="login-info ' + login.cls + '"><i class="ti ' + (login.cls === 'never' ? 'ti-clock-x' : 'ti-clock') + '"></i>' + login.text + '</div></td>' +
        '<td><div class="act-group">' +
          '<button class="act-btn" title="View" data-action="view" data-id="' + esc(staffId(s)) + '"><i class="ti ti-eye"></i></button>' +
          '<button class="act-btn ' + (owner ? 'disabled' : '') + '" title="Edit" data-action="edit" data-id="' + esc(staffId(s)) + '" ' + (owner ? 'disabled' : '') + '><i class="ti ti-edit"></i></button>' +
          '<button class="act-btn key ' + (owner ? 'disabled' : '') + '" title="Reset password" data-action="reset" data-id="' + esc(staffId(s)) + '" data-name="' + esc(name) + '" ' + (owner ? 'disabled' : '') + '><i class="ti ti-key"></i></button>' +
          '<button class="act-btn deact ' + (owner ? 'disabled' : '') + '" title="' + (isActive ? 'Deactivate' : 'Reactivate') + '" data-action="deact" data-id="' + esc(staffId(s)) + '" data-name="' + esc(name) + '" data-active="' + isActive + '" ' + (owner ? 'disabled' : '') + '><i class="ti ' + (isActive ? 'ti-user-off' : 'ti-user-check') + '"></i></button>' +
        '</div></td></tr>';
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('.act-btn')) return;
        open360(row.getAttribute('data-id'));
      });
    });
    tbody.querySelectorAll('.act-btn:not(.disabled)').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var action = this.dataset.action;
        var id = this.dataset.id;
        if (action === 'view') open360(id);
        else if (action === 'edit') openEditDrawer(id);
        else if (action === 'reset') showResetModal(id, this.dataset.name);
        else if (action === 'deact') showDeactConfirm(id, this.dataset.name, this.dataset.active === 'true');
      });
    });
  }

  async function open360(id) {
    openStaffId = id;
    var s = allStaff.find(function (x) { return staffId(x) === id; }) || {};
    var detail = await apiGet('/admin/staff/' + id);
    if (!detail) { toast('Could not load staff', 'error'); return; }
    s = detail;
    var owner = R.isOwnerRole(s.role);
    var isActive = s.isActive !== false;
    var ac = colors(s);
    var role = roleMeta(s);
    var login = R.formatLastLogin(s.lastLoginAt);
    var perms = R.permissionsFromCatalog(s.role, roleCatalog);
    var photo = s.profilePhotoUrl
      ? '<img class="staff-av-img lg" src="' + esc(s.profilePhotoUrl) + '" alt="">'
      : '<div class="staff-av" style="width:64px;height:64px;font-size:20px;background:' + ac.bg + ';color:' + ac.fg + ';margin:0 auto">' + initials(s.fullName) + '</div>';

    var drawer = document.getElementById('drawerContent');
    drawer.className = 'drawer drawer-360';
    drawer.innerHTML =
      '<div class="drawer-hdr"><div><h2>Staff 360</h2><div class="modal-hdr-sub">' + esc(s.staffNumber || 'Identity account') + '</div></div>' +
      '<button class="modal-close" id="drawerClose"><i class="ti ti-x"></i></button></div>' +
      '<div class="drawer-body">' +
        '<div class="staff360-hero">' + photo +
        '<div class="staff-name" style="font-size:18px;margin-top:8px">' + esc(s.fullName) + '</div>' +
        '<div class="muted">' + esc(s.email) + '</div></div>' +
        '<div class="staff360-sec"><h3>Profile</h3>' +
          kv('Staff number', s.staffNumber) +
          kv('Full name', s.fullName) +
          kv('Phone', s.phoneNumber) +
          kv('Email', s.email) +
          kv('Job title', s.jobTitle) +
          kv('Department', s.department) +
          kv('Hire date', s.hireDate ? fmtDate(s.hireDate) : '') +
          (s.notes ? '<div class="staff360-notes">' + esc(s.notes) + '</div>' : '') +
        '</div>' +
        '<div class="staff360-sec"><h3>Account</h3>' +
          '<div class="kv"><span>Status</span><span class="status-badge ' + (isActive ? 'active' : 'inactive') + '"><span class="dot"></span>' + (isActive ? 'Active' : 'Inactive') + '</span></div>' +
          kv('Created', fmtDate(s.createdAtUtc)) +
          '<div class="kv"><span>Last login</span><b>' + login.text + '</b></div>' +
          (isActive ? '' : '<p class="hint">This account cannot log in or refresh its session. Existing access tokens may remain valid until their normal expiry.</p>') +
        '</div>' +
        '<div class="staff360-sec"><h3>Access</h3>' +
          '<div class="kv"><span>Role</span><span class="role-badge ' + role.cls + '"><i class="ti ' + role.icon + '"></i>' + role.label + '</span></div>' +
          '<div class="kv"><span>Tasks</span><b>' + perms.length + '</b></div>' +
          '<p class="hint">Tasks come with the job for this gym. Change them on <a href="/dashboard/roles/">Roles</a>.</p>' +
          perms.map(function (p) {
            return '<div class="perm-row"><i class="ti ti-check"></i>' + esc(R.PERMISSION_LABELS[p] || p) + '</div>';
          }).join('') +
        '</div>' +
        '<div class="staff360-sec" id="staffActivity"><h3>Activity</h3><p class="hint">Loading…</p></div>' +
      '</div>' +
      '<div class="drawer-footer">' +
        (owner
          ? '<span class="hint">Owner is view-only in Staff Management.</span>'
          : '<button class="btn-cancel" id="from360Edit">Edit</button>' +
            '<button class="btn-cancel" id="from360Reset">Reset password</button>' +
            '<button class="' + (isActive ? 'btn-danger' : 'btn-primary') + '" id="from360Deact">' + (isActive ? 'Deactivate' : 'Reactivate') + '</button>') +
      '</div>';

    openOverlay('drawerOverlay');
    document.getElementById('drawerClose').addEventListener('click', function () { closeOverlay('drawerOverlay'); });
    if (!owner) {
      document.getElementById('from360Edit').addEventListener('click', function () { closeOverlay('drawerOverlay'); openEditDrawer(id); });
      document.getElementById('from360Reset').addEventListener('click', function () { closeOverlay('drawerOverlay'); showResetModal(id, s.fullName); });
      document.getElementById('from360Deact').addEventListener('click', function () { closeOverlay('drawerOverlay'); showDeactConfirm(id, s.fullName, isActive); });
    }
    loadActivity(id);
  }

  async function loadActivity(identityUserId) {
    var box = document.getElementById('staffActivity');
    if (!box) return;
    var items = await apiGet('/admin/staff/' + encodeURIComponent(identityUserId) + '/activity');
    if (!Array.isArray(items) || !items.length) {
      box.innerHTML = '<h3>Activity</h3><p class="hint">No activity recorded yet.</p>';
      return;
    }
    box.innerHTML = '<h3>Activity</h3>' + items.map(function (ev) {
      return '<div class="activity-row"><span>' + esc(ev.label || ev.action) + '</span><span class="muted">' + fmtDate(ev.createdAtUtc) + '</span></div>';
    }).join('');
  }

  document.getElementById('btnAddStaff').addEventListener('click', showAddModal);

  function showAddModal() {
    var modal = document.getElementById('addModalContent');
    modal.innerHTML =
      '<div class="modal-hdr"><div><h2><i class="ti ti-user-plus"></i> Add staff</h2>' +
      '<div class="modal-hdr-sub">Owner and Member cannot be created here.</div></div>' +
      '<button class="modal-close" id="addClose"><i class="ti ti-x"></i></button></div>' +
      '<form id="addForm" class="modal-form"><div class="modal-body">' +
        '<div class="fg"><label>Full name <span class="req">*</span></label><input name="fullName" required placeholder="e.g. Sara Ahmed"></div>' +
        '<div class="fg" id="emailGroup"><label>Email <span class="req">*</span></label>' +
          '<input type="email" name="email" id="addEmail" required placeholder="sara@gymflow.test">' +
          '<div class="error-text" id="emailError">Email is already registered</div>' +
          '<div class="hint">Must be unique across HyMotion, not only this gym.</div></div>' +
        '<div class="fg"><label>Password <span class="req">*</span></label>' +
          '<input type="password" name="password" id="addPassword" required placeholder="6+ characters, upper, lower, digit">' +
          '<div class="pw-strength"><div class="pw-bar"><div class="pw-fill" id="pwFill"></div></div><div class="pw-label" id="pwLabel"></div></div>' +
          passwordChecklistHtml('pw') +
        '</div>' +
        '<div class="fg"><label>Role <span class="req">*</span></label></div>' +
        '<div class="role-selector">' + roleCardsHtml('Trainer') + '</div>' +
        roleTasksHtml('Trainer') +
        workFieldsHtml({}) +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn-cancel" id="addCancel">Cancel</button>' +
        '<button type="submit" class="btn-primary" id="addSubmit"><i class="ti ti-user-plus"></i> Create account</button>' +
      '</div></form>';

    openOverlay('addModalOverlay');
    document.getElementById('addClose').addEventListener('click', function () { closeOverlay('addModalOverlay'); });
    document.getElementById('addCancel').addEventListener('click', function () { closeOverlay('addModalOverlay'); });
    bindRoleCards(modal);
    document.getElementById('addPassword').addEventListener('input', function () {
      paintPassword(this.value, 'pwFill', 'pwLabel', '#pwChecklist');
    });
    document.getElementById('addForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var pw = document.getElementById('addPassword').value;
      if (!R.passwordMeetsPolicy(pw)) {
        toast('Password must be 6+ characters with upper, lower, and a number', 'error');
        return;
      }
      var btn = document.getElementById('addSubmit');
      btn.disabled = true;
      document.getElementById('emailGroup').classList.remove('has-error');
      var fd = new FormData(this);
      var body = {
        fullName: fd.get('fullName'),
        email: fd.get('email'),
        password: fd.get('password'),
        role: R.canonicalRole(fd.get('role'))
      };
      Object.assign(body, collectWork(fd));
      var res = await apiPost('/admin/staff', body);
      if (res && res.ok) {
        toast('Staff member created');
        closeOverlay('addModalOverlay');
        loadStaff();
      } else if (res && res.status === 402) {
        toast((res.data && (res.data.detail || res.data.title)) || 'Staff seat limit reached', 'error');
      } else if (res && res.status === 400 && String((res.data && (res.data.message || res.data.error)) || '').toLowerCase().indexOf('email') !== -1) {
        document.getElementById('emailGroup').classList.add('has-error');
        document.getElementById('emailError').textContent = (res.data && (res.data.message || res.data.error)) || 'Email is already registered';
        document.getElementById('emailError').style.display = 'block';
      } else {
        toast(apiErr(res, 'Failed to create staff'), 'error');
      }
      btn.disabled = false;
    });
  }

  async function openEditDrawer(id) {
    var s = allStaff.find(function (x) { return staffId(x) === id; });
    if (!s || R.isOwnerRole(s.role)) return;
    var detail = await apiGet('/admin/staff/' + id);
    if (detail) s = detail;
    var ac = colors(s);
    var isActive = s.isActive !== false;
    var photo = s.profilePhotoUrl
      ? '<img class="staff-av-img lg" src="' + esc(s.profilePhotoUrl) + '" alt="">'
      : '<div class="staff-av" style="width:56px;height:56px;font-size:18px;background:' + ac.bg + ';color:' + ac.fg + ';margin:0 auto 8px">' + initials(s.fullName) + '</div>';
    var drawer = document.getElementById('drawerContent');
    drawer.className = 'drawer';
    drawer.innerHTML =
      '<div class="drawer-hdr"><h2><i class="ti ti-edit"></i> Edit staff</h2>' +
      '<button class="modal-close" id="drawerClose"><i class="ti ti-x"></i></button></div>' +
      '<div class="drawer-body">' +
        '<div style="text-align:center;margin-bottom:24px">' + photo +
          '<div style="font-family:var(--fd);font-size:16px;font-weight:700;margin-top:8px">' + esc(s.fullName) + '</div>' +
          '<div style="font-size:12px;color:var(--ltt)">' + esc(s.staffNumber || s.email) + '</div>' +
          '<label class="photo-upload">Change photo<input type="file" id="staffPhoto" accept="image/jpeg,image/png,image/webp,image/gif"></label>' +
        '</div>' +
        '<form id="editForm">' +
          '<div class="fg"><label>Full name</label><input name="fullName" value="' + esc(s.fullName) + '" required></div>' +
          workFieldsHtml(s) +
          '<div class="fg"><label>Role</label></div>' +
          '<div class="role-selector">' + roleCardsHtml(roleKey(s)) + '</div>' +
          roleTasksHtml(roleKey(s)) +
          '<div class="toggle-row">' +
            '<div><div class="toggle-label">Account status</div>' +
            '<div class="toggle-sub">' + (isActive
              ? 'Inactive accounts cannot log in or refresh. Open access tokens may last ~15 minutes.'
              : 'This account cannot log in or refresh its session.') + '</div></div>' +
            '<label class="toggle"><input type="checkbox" name="isActive" ' + (isActive ? 'checked' : '') + '>' +
            '<span class="toggle-track"></span><span class="toggle-knob"></span></label>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '<div class="drawer-footer">' +
        '<button class="btn-cancel" id="editCancel">Cancel</button>' +
        '<button class="btn-primary" id="editSave"><i class="ti ti-check"></i> Save changes</button>' +
      '</div>';

    openOverlay('drawerOverlay');
    document.getElementById('drawerClose').addEventListener('click', function () { closeOverlay('drawerOverlay'); });
    document.getElementById('editCancel').addEventListener('click', function () { closeOverlay('drawerOverlay'); });
    bindRoleCards(drawer);
    var photoInput = document.getElementById('staffPhoto');
    if (photoInput) {
      photoInput.addEventListener('change', async function () {
        var file = this.files && this.files[0];
        if (!file) return;
        var res = await apiUpload('/admin/staff/' + id + '/photo', file);
        if (res && res.ok) { toast('Photo updated'); loadStaff(); }
        else toast((res && res.data && (res.data.error || res.data.message)) || 'Could not upload photo', 'error');
      });
    }
    document.getElementById('editSave').addEventListener('click', async function () {
      this.disabled = true;
      var form = document.getElementById('editForm');
      var fd = new FormData(form);
      var body = {
        fullName: fd.get('fullName'),
        role: R.canonicalRole(fd.get('role')),
        isActive: form.querySelector('[name=isActive]').checked
      };
      Object.assign(body, collectWork(fd));
      var res = await apiPut('/admin/staff/' + id, body);
      if (res && res.ok) { toast('Staff updated'); closeOverlay('drawerOverlay'); loadStaff(); }
      else if (res && res.status === 403) toast((res.data && res.data.detail) || 'Owner accounts cannot be changed this way', 'error');
      else toast((res && res.data && (res.data.message || res.data.error)) || 'Failed to update', 'error');
      this.disabled = false;
    });
  }

  function showResetModal(id, name) {
    var s = allStaff.find(function (x) { return staffId(x) === id; });
    if (s && R.isOwnerRole(s.role)) return;
    var modal = document.getElementById('resetModalContent');
    modal.innerHTML =
      '<div class="modal-hdr"><div><h2><i class="ti ti-key"></i> Reset password</h2>' +
      '<div class="modal-hdr-sub">Set a new password for ' + esc(name) + '</div></div>' +
      '<button class="modal-close" id="resetClose"><i class="ti ti-x"></i></button></div>' +
      '<form id="resetForm"><div class="modal-body">' +
        '<div class="fg"><label>New password <span class="req">*</span></label>' +
          '<input type="password" id="newPw" required placeholder="6+ characters, upper, lower, digit">' +
          '<div class="pw-strength"><div class="pw-bar"><div class="pw-fill" id="rpwFill"></div></div><div class="pw-label" id="rpwLabel"></div></div>' +
          passwordChecklistHtml('rpw') +
        '</div>' +
        '<div class="fg" id="confirmGroup"><label>Confirm password <span class="req">*</span></label>' +
          '<input type="password" id="confirmPw" required placeholder="Re-enter password">' +
          '<div class="error-text" id="confirmError">Passwords do not match</div></div>' +
        '<p class="hint">After reset, existing refresh sessions are revoked. Current access tokens expire on their own (~15 min).</p>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn-cancel" id="resetCancel">Cancel</button>' +
        '<button type="submit" class="btn-primary" id="resetSubmit"><i class="ti ti-key"></i> Reset password</button>' +
      '</div></form>';

    openOverlay('resetModalOverlay');
    document.getElementById('resetClose').addEventListener('click', function () { closeOverlay('resetModalOverlay'); });
    document.getElementById('resetCancel').addEventListener('click', function () { closeOverlay('resetModalOverlay'); });
    document.getElementById('newPw').addEventListener('input', function () {
      paintPassword(this.value, 'rpwFill', 'rpwLabel', '#rpwChecklist');
    });
    document.getElementById('resetForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var pw = document.getElementById('newPw').value;
      var cpw = document.getElementById('confirmPw').value;
      if (pw !== cpw) {
        document.getElementById('confirmGroup').classList.add('has-error');
        return;
      }
      if (!R.passwordMeetsPolicy(pw)) {
        toast('Password must be 6+ characters with upper, lower, and a number', 'error');
        return;
      }
      document.getElementById('confirmGroup').classList.remove('has-error');
      var btn = document.getElementById('resetSubmit');
      btn.disabled = true;
      var res = await apiPost('/admin/staff/' + id + '/reset-password', { newPassword: pw });
      if (res && res.ok) { toast('Password reset successfully'); closeOverlay('resetModalOverlay'); }
      else if (res && res.status === 403) toast((res.data && res.data.detail) || 'Not allowed', 'error');
      else toast((res && res.data && (res.data.message || res.data.error)) || 'Failed to reset password', 'error');
      btn.disabled = false;
    });
  }

  function showDeactConfirm(id, name, isActive) {
    var s = allStaff.find(function (x) { return staffId(x) === id; });
    if (s && R.isOwnerRole(s.role)) return;
    var dlg = document.getElementById('deactDialog');
    var action = isActive ? 'Deactivate' : 'Reactivate';
    dlg.innerHTML =
      '<div class="confirm-icon ' + (isActive ? 'danger' : 'warn') + '"><i class="ti ' + (isActive ? 'ti-user-off' : 'ti-user-check') + '"></i></div>' +
      '<div class="confirm-title">' + action + ' ' + esc(name) + '?</div>' +
      '<div class="confirm-msg">' + (isActive
        ? 'This account cannot log in or refresh its session. Existing access tokens may remain valid until their normal expiry. History stays in place. This is not a delete.'
        : 'This will restore sign-in access for this staff member.') + '</div>' +
      '<div class="confirm-actions">' +
        '<button class="btn-cancel" id="deactCancel">Cancel</button>' +
        '<button class="' + (isActive ? 'btn-danger' : 'btn-primary') + '" id="deactConfirm"><i class="ti ' + (isActive ? 'ti-user-off' : 'ti-user-check') + '"></i> ' + action + '</button>' +
      '</div>';

    openOverlay('deactOverlay');
    document.getElementById('deactCancel').addEventListener('click', function () { closeOverlay('deactOverlay'); });
    document.getElementById('deactConfirm').addEventListener('click', async function () {
      this.disabled = true;
      var body = {
        fullName: (s && s.fullName) || name,
        role: R.canonicalRole((s && s.role) || 'Trainer'),
        isActive: !isActive
      };
      var res = await apiPut('/admin/staff/' + id, body);
      closeOverlay('deactOverlay');
      if (res && res.ok) { toast(isActive ? 'Staff deactivated' : 'Staff reactivated'); loadStaff(); }
      else if (res && res.status === 403) toast((res.data && res.data.detail) || 'Owner accounts cannot be changed this way', 'error');
      else toast((res && res.data && (res.data.message || res.data.error)) || 'Failed', 'error');
    });
  }

  document.getElementById('staffSearch').addEventListener('input', renderTable);
  document.getElementById('staffRoleFilter').addEventListener('change', renderTable);
  document.getElementById('staffStatusFilter').addEventListener('change', renderTable);
  var deptFilter = document.getElementById('staffDeptFilter');
  if (deptFilter) deptFilter.addEventListener('change', renderTable);

  (async function boot() {
    try {
      var cat = await apiGet('/admin/roles');
      if (cat && Array.isArray(cat.roles)) roleCatalog = cat;
    } catch (e) {
      roleCatalog = null;
    }
    loadStaff();
  })();
})();
