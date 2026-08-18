/**
 * Roles desk — Option B tenant overlay.
 * Owner is locked. Manager / Receptionist / Trainer save via PUT /api/admin/roles/{role}.
 * Defaults remain DefaultPermissionProvider (GfpStaffRules). Per-user override column is unused.
 */
(function () {
  'use strict';

  var R = window.GfpStaffRules;
  var guard = document.getElementById('ownerGuard');
  var content = document.getElementById('rolesContent');
  var tbody = document.getElementById('rolesBody');

  if (!R || typeof R.isOwnerRole !== 'function') {
    if (guard) {
      guard.hidden = true;
      guard.classList.remove('is-on');
    }
    if (content) content.style.removeProperty('display');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell" role="alert">Could not load role access. Refresh and try again.</td></tr>';
    }
    return;
  }

  var role = user && user.role;
  if (window.GfpAuthz && typeof window.GfpAuthz.getUserRole === 'function') {
    role = window.GfpAuthz.getUserRole() || role;
  }
  var isOwner = R.isOwnerRole(role);
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

  var overlay = document.getElementById('drawerOverlay');
  var drawer = document.getElementById('drawerContent');
  var catalog = null;
  var staffCounts = null;
  var lastFocus = null;
  var openRoleId = null;
  var saving = false;

  var avColors = {
    Owner: { bg: 'rgba(217,119,6,.12)', fg: '#D97706' },
    Manager: { bg: 'rgba(59,130,246,.12)', fg: '#3B82F6' },
    Trainer: { bg: 'rgba(13,148,136,.12)', fg: '#0D9488' },
    Receptionist: { bg: 'rgba(139,92,246,.12)', fg: '#7C3AED' }
  };

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function toast(msg, type) {
    type = type || 'success';
    var t = document.getElementById('toast');
    if (!t) return;
    t.innerHTML = '<i class="ti ' + (type === 'success' ? 'ti-check' : 'ti-alert-circle') + '"></i>' + esc(msg);
    t.className = 'toast ' + type + ' show';
    setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  function universe() {
    if (catalog && catalog.universe && catalog.universe.length)
      return catalog.universe.length;
    return R.permissionUniverseCount();
  }

  function roleRow(id) {
    if (!catalog || !catalog.roles) return null;
    var i;
    for (i = 0; i < catalog.roles.length; i++) {
      if (catalog.roles[i].id === id) return catalog.roles[i];
    }
    return null;
  }

  function usedByText(id) {
    if (!staffCounts || !Object.prototype.hasOwnProperty.call(staffCounts, id)) return '';
    return '<span class="roles-used">Used by ' + staffCounts[id] + ' staff</span>';
  }

  function renderError(msg) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell" role="alert">' + esc(msg) + '</td></tr>';
  }

  function renderList() {
    var ids = (catalog && catalog.roles) ? catalog.roles.map(function (r) { return r.id; }) : (R.STAFF_ROLES || []);
    if (!ids.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No roles to show</td></tr>';
      return;
    }
    tbody.innerHTML = ids.map(function (id) {
      var meta = R.ROLE_META[id] || { icon: 'ti-user', cls: '', label: id };
      var ac = avColors[id] || avColors.Trainer;
      var row = roleRow(id);
      var n = row ? row.permissions.length : R.permissionCount(id);
      var editable = row ? row.editable : id !== 'Owner';
      var customized = !!(row && row.isCustomized);
      var desc = R.roleDescription(id);
      var type = id === 'Owner' ? 'Locked' : (customized ? 'Custom' : 'Default');
      var action = editable ? 'Edit tasks' : 'View';
      return '<tr data-role="' + esc(id) + '" tabindex="0">' +
        '<td><div class="staff-cell">' +
          '<div class="staff-av" style="background:' + ac.bg + ';color:' + ac.fg + '" aria-hidden="true"><i class="ti ' + esc(meta.icon) + '"></i></div>' +
          '<div><div class="staff-name">' + esc(meta.label || id) + '</div>' +
          '<div class="roles-sys">' + (id === 'Owner' ? 'System role' : 'This gym') + '</div>' +
          usedByText(id) +
        '</div></div></td>' +
        '<td class="role-desc">' + esc(desc) + '</td>' +
        '<td class="perm-count">' + n + ' of ' + universe() + '</td>' +
        '<td class="type-cell">' + type + '</td>' +
        '<td><button type="button" class="roles-view-btn" data-role="' + esc(id) + '" aria-label="' + esc(action + ' ' + id) + '">' + action + '</button></td>' +
      '</tr>';
    }).join('');
  }

  function closeDrawer() {
    if (!overlay) return;
    overlay.classList.remove('show');
    openRoleId = null;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  function collectedKeys() {
    return Array.prototype.map.call(
      drawer.querySelectorAll('input[name="perm"]:checked'),
      function (el) { return el.value; }
    );
  }

  function openDrawer(id) {
    var row = roleRow(id);
    if (!row && !R.isStaffRole(id)) return;
    var meta = R.ROLE_META[id] || { icon: 'ti-user', label: id };
    var keys = row ? row.permissions : R.permissionsForRole(id);
    var editable = row ? row.editable : false;
    var n = keys.length;
    var groups = R.groupsForKeys(keys, !editable);
    var notes = (catalog && catalog.notes) || [];
    var effect = (catalog && catalog.effectCopy) || 'Takes effect on next login, or within about 15 minutes.';
    var warn = id === 'Owner'
      ? 'Locked. Owner always has full access.'
      : effect;
    var groupsHtml = groups.map(function (g) {
      var rows = g.items.map(function (item) {
        if (!editable) {
          return '<div class="roles-perm">' +
            '<span class="roles-perm-label">' + esc(item.label) + '</span>' +
            '<span class="roles-perm-state ' + (item.allowed ? 'is-yes' : 'is-no') + '">' +
              (item.allowed ? 'Allowed' : 'Not included') +
            '</span></div>';
        }
        return '<label class="roles-check">' +
          '<input type="checkbox" name="perm" value="' + esc(item.key) + '"' + (item.allowed ? ' checked' : '') + '>' +
          '<span>' + esc(item.label) + '</span>' +
        '</label>';
      }).join('');
      return '<div class="roles-grp"><h3>' + esc(g.label) + '</h3>' + rows + '</div>';
    }).join('');
    var notesHtml = notes.length
      ? '<ul class="roles-notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
      : '';
    var footer = editable
      ? '<div class="drawer-footer">' +
          ((row && row.isCustomized)
            ? '<button type="button" class="btn-cancel" id="btnResetRole">Reset to default</button>'
            : '') +
          '<button type="button" class="btn-primary" id="btnSaveRole"><i class="ti ti-check"></i> Save tasks</button>' +
        '</div>'
      : '';
    drawer.innerHTML =
      '<div class="drawer-hdr">' +
        '<div>' +
          '<button type="button" class="roles-drawer-back" id="btnBackRoles"><i class="ti ti-arrow-left" aria-hidden="true"></i> Back to Roles</button>' +
          '<h2 id="drawerTitle"><i class="ti ' + esc(meta.icon) + '" aria-hidden="true"></i> ' + esc(meta.label || id) + '</h2>' +
          '<div class="roles-sys">' + (editable ? (row && row.isCustomized ? 'Custom for this gym' : 'Gym default') : 'System Role') + '</div>' +
          (id === 'Owner' ? '<div class="roles-full">Full Access</div>' : '') +
          '<div class="muted">' + n + ' of ' + universe() + ' permissions</div>' +
        '</div>' +
        '<button type="button" class="modal-close" id="btnCloseDrawer" aria-label="Close"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="drawer-body">' +
        '<div class="roles-warn">' + esc(warn) + '</div>' +
        groupsHtml +
        notesHtml +
      '</div>' + footer;
    overlay.classList.add('show');
    openRoleId = id;
    var closeBtn = document.getElementById('btnCloseDrawer');
    if (closeBtn) closeBtn.focus();
  }

  function onRowActivate(id, fromEl) {
    lastFocus = fromEl || document.activeElement;
    openDrawer(id);
  }

  async function saveOpenRole() {
    if (saving || !openRoleId) return;
    saving = true;
    var btn = document.getElementById('btnSaveRole');
    if (btn) btn.disabled = true;
    var res = await apiPut('/admin/roles/' + encodeURIComponent(openRoleId), { permissions: collectedKeys() });
    saving = false;
    if (btn) btn.disabled = false;
    if (res && res.ok && res.data) {
      var i;
      for (i = 0; i < catalog.roles.length; i++) {
        if (catalog.roles[i].id === openRoleId) {
          catalog.roles[i] = res.data;
          break;
        }
      }
      toast('Tasks saved. Staff pick them up on next login or within about 15 minutes.');
      renderList();
      openDrawer(openRoleId);
      return;
    }
    toast((res && res.data && (res.data.detail || res.data.error || res.data.message)) || 'Could not save', 'error');
  }

  async function resetOpenRole() {
    if (saving || !openRoleId) return;
    saving = true;
    var res = await apiPost('/admin/roles/' + encodeURIComponent(openRoleId) + '/reset');
    saving = false;
    if (res && res.ok && res.data) {
      var i;
      for (i = 0; i < catalog.roles.length; i++) {
        if (catalog.roles[i].id === openRoleId) {
          catalog.roles[i] = res.data;
          break;
        }
      }
      toast('Restored gym default for this job.');
      renderList();
      openDrawer(openRoleId);
      return;
    }
    toast((res && res.data && (res.data.detail || res.data.error)) || 'Could not reset', 'error');
  }

  tbody.addEventListener('click', function (e) {
    var btn = e.target.closest('.roles-view-btn');
    var tr = e.target.closest('tr[data-role]');
    var id = (btn && btn.getAttribute('data-role')) || (tr && tr.getAttribute('data-role'));
    if (!id) return;
    onRowActivate(id, btn || tr);
  });

  tbody.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest('tr[data-role]');
    if (!tr) return;
    e.preventDefault();
    onRowActivate(tr.getAttribute('data-role'), tr);
  });

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeDrawer();
    if (e.target.closest('#btnCloseDrawer') || e.target.closest('#btnBackRoles')) closeDrawer();
    if (e.target.closest('#btnSaveRole')) saveOpenRole();
    if (e.target.closest('#btnResetRole')) resetOpenRole();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('show')) {
      e.preventDefault();
      closeDrawer();
    }
  });

  (async function boot() {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell"><div class="loader"></div>Loading roles…</td></tr>';
    try {
      catalog = await apiGet('/admin/roles');
    } catch (err) {
      catalog = null;
    }
    if (!catalog || !Array.isArray(catalog.roles)) {
      renderError('Could not load roles. Refresh and try again.');
      return;
    }
    renderList();
    try {
      var data = await apiGet('/admin/staff');
      staffCounts = R.countStaffByRole(Array.isArray(data) ? data : null);
      if (staffCounts) renderList();
    } catch (err) {
      staffCounts = null;
    }
  })();
})();
