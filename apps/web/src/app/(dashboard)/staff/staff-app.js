(function(){
  if (user.role!=='Owner' && user.role!=='owner') return;

  const tbody = document.getElementById('staffBody');
  let allStaff = [];

  // ── Role config ──
  // Wire values verified against CreateStaffRequest / AdminService: lowercase manager|trainer|receptionist.
  // Identity seed stores PascalCase ("Manager"); normalize for display. Never offer "owner" as creatable.
  const ROLE_META = {
    owner:        { icon:'ti-crown',      cls:'owner',        label:'Owner',        wire:null },
    manager:      { icon:'ti-briefcase',  cls:'manager',      label:'Manager',      wire:'manager' },
    trainer:      { icon:'ti-barbell',    cls:'trainer',      label:'Trainer',      wire:'trainer' },
    receptionist: { icon:'ti-desk',       cls:'receptionist', label:'Receptionist', wire:'receptionist' }
  };
  const CREATABLE_ROLES = ['manager','trainer','receptionist']; // NOT owner
  const avColors = {
    owner:        {bg:'rgba(217,119,6,.12)',fg:'#D97706'},
    manager:      {bg:'rgba(59,130,246,.12)',fg:'#3B82F6'},
    trainer:      {bg:'rgba(13,148,136,.12)',fg:'#0D9488'},
    receptionist: {bg:'rgba(139,92,246,.12)',fg:'#7C3AED'}
  };
  function normRole(r){ return String(r||'trainer').toLowerCase(); }
  function roleMeta(r){ return ROLE_META[normRole(r)] || ROLE_META.trainer; }
  function wireRole(r){
    const n = normRole(r);
    if (n === 'owner') return 'manager'; // never send owner on update/create
    return CREATABLE_ROLES.includes(n) ? n : 'trainer';
  }

  // ── Helpers ──
  function toast(msg, type='success') {
    const t = document.getElementById('toast');
    t.innerHTML = '<i class="ti '+(type==='success'?'ti-check':'ti-alert-circle')+'"></i>'+msg;
    t.className = 'toast '+type+' show';
    setTimeout(() => t.classList.remove('show'), 3500);
  }
  function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
  function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase(); }
  function fmtDate(d) { if(!d) return '—'; return new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }

  function loginAgo(d) {
    if (!d) return { text:'Never logged in', cls:'never', days:-1 };
    const now = new Date(), dt = new Date(d);
    const diff = Math.floor((now-dt)/(1000*60*60*24));
    if (diff === 0) {
      const h = dt.getHours(), m = dt.getMinutes();
      const ampm = h>=12?'PM':'AM';
      const h12 = h%12||12;
      return { text:'Today at '+h12+':'+m.toString().padStart(2,'0')+' '+ampm, cls:'recent', days:0 };
    }
    if (diff === 1) return { text:'Yesterday', cls:'recent', days:1 };
    if (diff <= 3) return { text:diff+' days ago', cls:'recent', days:diff };
    if (diff <= 13) return { text:diff+' days ago', cls:'moderate', days:diff };
    return { text:diff+' days ago', cls:'old', days:diff };
  }

  function roleCardsHtml(selectedWire) {
    const sel = wireRole(selectedWire || 'trainer');
    return CREATABLE_ROLES.map(w => {
      const m = ROLE_META[w];
      const ac = avColors[w];
      const on = sel === w;
      return `<div class="role-card ${on?'selected':''}" data-role="${w}">
          <input type="radio" name="role" value="${w}" ${on?'checked':''}>
          <div class="role-card-icon" style="background:${ac.bg};color:${ac.fg}"><i class="ti ${m.icon}"></i></div>
          <div class="role-card-name">${m.label}</div>
          <div class="role-card-desc">${w==='manager'?'Full ops':w==='receptionist'?'Front desk':'Floor'}</div>
        </div>`;
    }).join('');
  }

  // ── Modal helpers ──
  function openOverlay(id) { document.getElementById(id).classList.add('show'); }
  function closeOverlay(id) { document.getElementById(id).classList.remove('show'); }

  ['addModalOverlay','resetModalOverlay','deactOverlay','drawerOverlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
      if (e.target === this) closeOverlay(id);
    });
  });

  // ── Load Staff ──
  async function loadStaff() {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell"><div class="loader"></div>Loading staff...</td></tr>';
    const data = await apiGet('/admin/staff');
    allStaff = Array.isArray(data) ? data : [];
    renderTable(allStaff);
    updateStats(allStaff);
  }

  function updateStats(staff) {
    document.getElementById('statTotal').textContent = staff.length;
    document.getElementById('statOwner').textContent = staff.filter(s=>normRole(s.role)==='owner').length;
    document.getElementById('statManager').textContent = staff.filter(s=>normRole(s.role)==='manager').length;
    document.getElementById('statTrainer').textContent = staff.filter(s=>normRole(s.role)==='trainer').length;
    const rec = document.getElementById('statReceptionist');
    if (rec) rec.textContent = staff.filter(s=>normRole(s.role)==='receptionist').length;
  }

  // ── Render Table ──
  function renderTable(staff) {
    if (!staff.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell"><i class="ti ti-users-group" style="font-size:36px;display:block;margin-bottom:8px;color:var(--ls4)"></i>No staff members found</td></tr>';
      return;
    }
    tbody.innerHTML = staff.map(s => {
      const rk = normRole(s.role);
      const role = roleMeta(s.role);
      const ac = avColors[rk] || avColors.trainer;
      const login = loginAgo(s.lastLoginAt || s.lastLoginAtUtc);
      const isOwner = rk === 'owner';
      const isActive = s.isActive !== false;

      return `<tr>
        <td><div class="staff-cell">
          <div class="staff-av" style="background:${ac.bg};color:${ac.fg}">${initials(s.fullName||s.firstName+' '+s.lastName)}</div>
          <div><div class="staff-name">${esc(s.fullName||((s.firstName||'')+' '+(s.lastName||'')).trim())}</div><div class="staff-id">${esc(s.staffNumber||'')}</div></div>
        </div></td>
        <td style="font-size:12px;color:var(--lts)">${esc(s.email)}</td>
        <td><span class="role-badge ${role.cls}"><i class="ti ${role.icon}"></i>${role.label}</span></td>
        <td><span class="status-badge ${isActive?'active':'inactive'}"><span class="dot"></span>${isActive?'Active':'Inactive'}</span></td>
        <td><div class="login-info ${login.cls}"><i class="ti ${login.cls==='never'?'ti-clock-x':'ti-clock'}"></i>${login.text}${login.days<0?'<button class="nudge-btn" data-email="'+esc(s.email)+'">Send invite</button>':''}</div></td>
        <td><span class="created-cell">${fmtDate(s.createdAtUtc)}</span></td>
        <td><div class="act-group">
          <button class="act-btn ${isOwner?'disabled':''}" title="Edit" data-action="edit" data-id="${s.id}"><i class="ti ti-edit"></i></button>
          <button class="act-btn key ${isOwner?'disabled':''}" title="Reset Password" data-action="reset" data-id="${s.id}" data-name="${esc(s.fullName||s.firstName)}"><i class="ti ti-key"></i></button>
          <button class="act-btn deact ${isOwner?'disabled':''}" title="${isActive?'Deactivate':'Activate'}" data-action="deact" data-id="${s.id}" data-name="${esc(s.fullName||s.firstName)}" data-active="${isActive}"><i class="ti ${isActive?'ti-user-off':'ti-user-check'}"></i></button>
        </div></td>
      </tr>`;
    }).join('');

    // Bind actions
    tbody.querySelectorAll('.act-btn:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', function() {
        const action = this.dataset.action;
        const id = this.dataset.id;
        if (action === 'edit') openEditDrawer(id);
        else if (action === 'reset') showResetModal(id, this.dataset.name);
        else if (action === 'deact') showDeactConfirm(id, this.dataset.name, this.dataset.active==='true');
      });
    });

    // Nudge buttons
    tbody.querySelectorAll('.nudge-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        toast('Invitation sent to '+this.dataset.email);
      });
    });
  }

  // ── Add Staff Modal ──
  document.getElementById('btnAddStaff').addEventListener('click', showAddModal);

  function showAddModal() {
    const modal = document.getElementById('addModalContent');
    modal.innerHTML = `
    <div class="modal-hdr">
      <div><h2><i class="ti ti-user-plus"></i> Add Staff Member</h2><div class="modal-hdr-sub">Create a new team member account</div></div>
      <button class="modal-close" id="addClose"><i class="ti ti-x"></i></button>
    </div>
    <form id="addForm">
    <div class="modal-body">
      <div class="fg"><label>Full Name <span class="req">*</span></label><input name="fullName" id="addName" required placeholder="e.g. Sara Ahmed"></div>
      <div class="fg" id="emailGroup"><label>Email <span class="req">*</span></label><input type="email" name="email" id="addEmail" required placeholder="sara@gymflow.test"><div class="error-text" id="emailError">Email already registered</div></div>
      <div class="fg"><label>Password <span class="req">*</span></label><input type="password" name="password" id="addPassword" required placeholder="Min 8 characters">
        <div class="pw-strength"><div class="pw-bar"><div class="pw-fill" id="pwFill"></div></div><div class="pw-label" id="pwLabel"></div></div>
        <div class="pw-checklist" id="pwChecklist">
          <div class="pw-req" data-req="length"><i class="ti ti-circle"></i> 8+ characters</div>
          <div class="pw-req" data-req="upper"><i class="ti ti-circle"></i> Uppercase letter</div>
          <div class="pw-req" data-req="number"><i class="ti ti-circle"></i> Number</div>
          <div class="pw-req" data-req="special"><i class="ti ti-circle"></i> Special character</div>
        </div>
      </div>
      <div class="fg"><label>Role <span class="req">*</span></label></div>
      <p class="role-wire-hint">API roles are lowercase (<code>manager</code> / <code>trainer</code> / <code>receptionist</code>). Owner cannot be created here.</p>
      <div class="role-selector">
        ${roleCardsHtml('trainer')}
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-cancel" id="addCancel">Cancel</button>
      <button type="submit" class="btn-primary" id="addSubmit"><i class="ti ti-user-plus"></i> Create Account</button>
    </div>
    </form>`;

    openOverlay('addModalOverlay');
    document.getElementById('addClose').addEventListener('click', () => closeOverlay('addModalOverlay'));
    document.getElementById('addCancel').addEventListener('click', () => closeOverlay('addModalOverlay'));

    // Role cards
    modal.querySelectorAll('.role-card').forEach(card => {
      card.addEventListener('click', function() {
        modal.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
        this.querySelector('input').checked = true;
      });
    });

    // Password strength
    document.getElementById('addPassword').addEventListener('input', function() {
      updatePasswordStrength(this.value);
    });

    // Form submit
    document.getElementById('addForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('addSubmit');
      btn.disabled = true;
      btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Creating...';
      document.getElementById('emailGroup').classList.remove('has-error');

      const fd = new FormData(this);
      const body = {
        fullName: fd.get('fullName'),
        email: fd.get('email'),
        password: fd.get('password'),
        role: wireRole(fd.get('role'))
      };

      const res = await apiPost('/admin/staff', body);
      if (res && res.ok) {
        toast('Staff member created');
        closeOverlay('addModalOverlay');
        loadStaff();
      } else if (res?.status === 400 && (res?.data?.message||'').toLowerCase().includes('email')) {
        document.getElementById('emailGroup').classList.add('has-error');
        document.getElementById('emailError').textContent = res.data.message || 'Email already registered';
        document.getElementById('emailError').style.display = 'block';
      } else {
        toast(res?.data?.message || 'Failed to create staff', 'error');
      }
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-user-plus"></i> Create Account';
    });
  }

  function updatePasswordStrength(pw) {
    const checks = {
      length: pw.length >= 8,
      upper: /[A-Z]/.test(pw),
      number: /[0-9]/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw)
    };
    const met = Object.values(checks).filter(Boolean).length;
    const levels = ['','weak','fair','strong','very-strong'];
    const labels = ['','Weak','Fair','Strong','Very Strong'];
    const level = levels[met] || '';
    const label = labels[met] || '';

    const fill = document.getElementById('pwFill');
    const lbl = document.getElementById('pwLabel');
    fill.className = 'pw-fill ' + level;
    lbl.className = 'pw-label ' + level;
    lbl.textContent = pw.length > 0 ? label : '';

    document.querySelectorAll('.pw-req').forEach(el => {
      const req = el.dataset.req;
      if (checks[req]) { el.classList.add('met'); el.querySelector('i').className = 'ti ti-circle-check-filled'; }
      else { el.classList.remove('met'); el.querySelector('i').className = 'ti ti-circle'; }
    });
  }

  // ── Edit Drawer ──
  async function openEditDrawer(id) {
    const s = allStaff.find(x => x.id === id);
    if (!s) return;
    const rk = normRole(s.role);
    const ac = avColors[rk] || avColors.trainer;
    const isActive = s.isActive !== false;

    const drawer = document.getElementById('drawerContent');
    drawer.innerHTML = `
    <div class="drawer-hdr">
      <h2><i class="ti ti-edit"></i> Edit Staff</h2>
      <button class="modal-close" id="drawerClose"><i class="ti ti-x"></i></button>
    </div>
    <div class="drawer-body">
      <div style="text-align:center;margin-bottom:24px">
        <div class="staff-av" style="width:56px;height:56px;font-size:18px;background:${ac.bg};color:${ac.fg};margin:0 auto 8px">${initials(s.fullName||s.firstName)}</div>
        <div style="font-family:var(--fd);font-size:16px;font-weight:700">${esc(s.fullName||((s.firstName||'')+' '+(s.lastName||'')))}</div>
        <div style="font-size:12px;color:var(--ltt)">${esc(s.email)}</div>
      </div>
      <form id="editForm">
        <div class="fg"><label>Full Name</label><input name="fullName" value="${esc(s.fullName||((s.firstName||'')+' '+(s.lastName||'')))}" required></div>
        <div class="fg"><label>Role</label></div>
        <p class="role-wire-hint">Sends lowercase role strings. Owner role cannot be assigned here.</p>
        <div class="role-selector" style="margin-bottom:0">
          ${roleCardsHtml(rk === 'owner' ? 'manager' : rk)}
        </div>
        <div class="toggle-row">
          <div><div class="toggle-label">Account Status</div><div class="toggle-sub">${isActive?'Staff can sign in (open sessions stay valid ≤15 min after deactivate)':'Account is deactivated'}</div></div>
          <label class="toggle"><input type="checkbox" name="isActive" ${isActive?'checked':''}><span class="toggle-track"></span><span class="toggle-knob"></span></label>
        </div>
      </form>
    </div>
    <div class="drawer-footer">
      <button class="btn-cancel" id="editCancel">Cancel</button>
      <button class="btn-primary" id="editSave"><i class="ti ti-check"></i> Save Changes</button>
    </div>`;

    openOverlay('drawerOverlay');
    document.getElementById('drawerClose').addEventListener('click', () => closeOverlay('drawerOverlay'));
    document.getElementById('editCancel').addEventListener('click', () => closeOverlay('drawerOverlay'));

    // Role cards
    drawer.querySelectorAll('.role-card').forEach(card => {
      card.addEventListener('click', function() {
        drawer.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
        this.querySelector('input').checked = true;
      });
    });

    document.getElementById('editSave').addEventListener('click', async function() {
      this.disabled = true;
      this.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Saving...';
      const form = document.getElementById('editForm');
      const fd = new FormData(form);
      const body = {
        fullName: fd.get('fullName'),
        role: wireRole(fd.get('role')),
        isActive: form.querySelector('[name=isActive]').checked
      };
      const res = await apiPut('/admin/staff/'+id, body);
      if (res && res.ok) { toast('Staff updated'); closeOverlay('drawerOverlay'); loadStaff(); }
      else toast(res?.data?.message||'Failed to update','error');
      this.disabled = false;
      this.innerHTML = '<i class="ti ti-check"></i> Save Changes';
    });
  }

  // ── Reset Password Modal ──
  function showResetModal(id, name) {
    const modal = document.getElementById('resetModalContent');
    modal.innerHTML = `
    <div class="modal-hdr">
      <div><h2><i class="ti ti-key"></i> Reset Password</h2><div class="modal-hdr-sub">Set a new password for ${esc(name)}</div></div>
      <button class="modal-close" id="resetClose"><i class="ti ti-x"></i></button>
    </div>
    <form id="resetForm">
    <div class="modal-body">
      <div class="fg"><label>New Password <span class="req">*</span></label><input type="password" id="newPw" name="newPassword" required placeholder="Min 8 characters">
        <div class="pw-strength"><div class="pw-bar"><div class="pw-fill" id="rpwFill"></div></div><div class="pw-label" id="rpwLabel"></div></div>
        <div class="pw-checklist" id="rpwChecklist">
          <div class="pw-req" data-req="length"><i class="ti ti-circle"></i> 8+ characters</div>
          <div class="pw-req" data-req="upper"><i class="ti ti-circle"></i> Uppercase letter</div>
          <div class="pw-req" data-req="number"><i class="ti ti-circle"></i> Number</div>
          <div class="pw-req" data-req="special"><i class="ti ti-circle"></i> Special character</div>
        </div>
      </div>
      <div class="fg" id="confirmGroup"><label>Confirm Password <span class="req">*</span></label><input type="password" id="confirmPw" name="confirmPassword" required placeholder="Re-enter password"><div class="error-text" id="confirmError">Passwords do not match</div></div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-cancel" id="resetCancel">Cancel</button>
      <button type="submit" class="btn-primary" id="resetSubmit"><i class="ti ti-key"></i> Reset Password</button>
    </div>
    </form>`;

    openOverlay('resetModalOverlay');
    document.getElementById('resetClose').addEventListener('click', () => closeOverlay('resetModalOverlay'));
    document.getElementById('resetCancel').addEventListener('click', () => closeOverlay('resetModalOverlay'));

    document.getElementById('newPw').addEventListener('input', function() {
      updateResetStrength(this.value);
    });

    document.getElementById('resetForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const pw = document.getElementById('newPw').value;
      const cpw = document.getElementById('confirmPw').value;
      if (pw !== cpw) {
        document.getElementById('confirmGroup').classList.add('has-error');
        return;
      }
      document.getElementById('confirmGroup').classList.remove('has-error');
      const btn = document.getElementById('resetSubmit');
      btn.disabled = true;
      btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Resetting...';

      const res = await apiPost('/admin/staff/'+id+'/reset-password', { newPassword:pw });
      if (res && res.ok) { toast('Password reset successfully'); closeOverlay('resetModalOverlay'); }
      else toast(res?.data?.message||'Failed to reset password','error');
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-key"></i> Reset Password';
    });
  }

  function updateResetStrength(pw) {
    const checks = { length:pw.length>=8, upper:/[A-Z]/.test(pw), number:/[0-9]/.test(pw), special:/[^A-Za-z0-9]/.test(pw) };
    const met = Object.values(checks).filter(Boolean).length;
    const levels = ['','weak','fair','strong','very-strong'];
    const labels = ['','Weak','Fair','Strong','Very Strong'];
    document.getElementById('rpwFill').className = 'pw-fill '+(levels[met]||'');
    document.getElementById('rpwLabel').className = 'pw-label '+(levels[met]||'');
    document.getElementById('rpwLabel').textContent = pw.length>0 ? (labels[met]||'') : '';
    document.querySelectorAll('#rpwChecklist .pw-req').forEach(el => {
      const req = el.dataset.req;
      if (checks[req]) { el.classList.add('met'); el.querySelector('i').className='ti ti-circle-check-filled'; }
      else { el.classList.remove('met'); el.querySelector('i').className='ti ti-circle'; }
    });
  }

  // ── Deactivate Confirm ──
  function showDeactConfirm(id, name, isActive) {
    const dlg = document.getElementById('deactDialog');
    const action = isActive ? 'Deactivate' : 'Activate';
    const actionLower = isActive ? 'deactivate' : 'activate';

    dlg.innerHTML = `
    <div class="confirm-icon ${isActive?'danger':'warn'}"><i class="ti ${isActive?'ti-user-off':'ti-user-check'}"></i></div>
    <div class="confirm-title">${action} ${esc(name)}?</div>
    <div class="confirm-msg">${isActive
      ? 'Deactivation is not an instant lockout — open sessions remain valid for up to ~15 minutes until the access token expires. They will not get a new session after that.'
      : 'This will restore sign-in access for this staff member.'}</div>
    <div class="confirm-actions">
      <button class="btn-cancel" id="deactCancel">Cancel</button>
      <button class="${isActive?'btn-danger':'btn-primary'}" id="deactConfirm"><i class="ti ${isActive?'ti-user-off':'ti-user-check'}"></i> ${action}</button>
    </div>`;

    openOverlay('deactOverlay');
    document.getElementById('deactCancel').addEventListener('click', () => closeOverlay('deactOverlay'));
    document.getElementById('deactConfirm').addEventListener('click', async function() {
      this.disabled = true;
      const s = allStaff.find(x => x.id === id);
      const body = { fullName: s?.fullName || name, role: wireRole(s?.role || 'trainer'), isActive: !isActive };
      const res = await apiPut('/admin/staff/'+id, body);
      closeOverlay('deactOverlay');
      if (res && res.ok) { toast('Staff '+actionLower+'d'); loadStaff(); }
      else toast(res?.data?.message||'Failed','error');
    });
  }

  // ── Init ──
  loadStaff();
})();
