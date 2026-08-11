/**
 * Membership Plans (§3) — list + type-driven create/edit + soft-delete (409 plan-in-use).
 * Perm: plans.manage for all reads/writes. No read-only plans API for lower roles.
 */
(function () {
  const Gfp = window.GfpApi;
  const Authz = window.GfpAuthz;
  const SESSION_PACK_COUNTS = [10, 20, 50];

  function getUser() {
    if (Gfp && Gfp.tokens) return Gfp.tokens.getUser();
    try {
      return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user'));
    } catch (e) {
      return null;
    }
  }

  const user = getUser();
  if (!user) {
    window.location.href = '/auth/login/';
    return;
  }

  const canManage = Authz ? Authz.useCan('plans.manage') : false;
  if (!canManage) {
    window.location.href = '/dashboard/';
    return;
  }

  const ini = (user.fullName || 'U')
    .split(' ')
    .map(function (w) {
      return w[0];
    })
    .join('')
    .substring(0, 2)
    .toUpperCase();
  const avatarEl = document.getElementById('userAvatar');
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  if (avatarEl) avatarEl.textContent = ini;
  if (nameEl) nameEl.textContent = user.fullName || 'User';
  if (roleEl) roleEl.textContent = user.role || 'Staff';
  if (Authz && Authz.useCanRole('OwnerOnly')) {
    const ns = document.getElementById('navStaff');
    if (ns) ns.style.display = 'flex';
  }
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', function () {
      if (Gfp) Gfp.logout();
      else {
        ['gfp_access_token', 'gfp_refresh_token', 'gfp_user', 'gfp_expires_at'].forEach(function (k) {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
        window.location.href = '/auth/login/';
      }
    });
  }

  (async function loadGymHeader() {
    if (!Gfp) return;
    const r = await Gfp.get('/settings');
    if (r.ok && r.data) {
      const gn = document.getElementById('gymName');
      const ga = document.getElementById('gymNameAr');
      if (gn) gn.textContent = r.data.gymName || '';
      if (ga) ga.textContent = r.data.gymNameAr || '';
    }
  })();

  const grid = document.getElementById('plansGrid');

  const PT = {
    monthly_unlimited: {
      label: 'Monthly Unlimited',
      labelAr: 'شهري غير محدود',
      icon: 'ti-calendar-repeat',
      color: 'var(--inf500)',
      accent: '#3B82F6',
      bg: 'var(--inf100)',
      short: 'Monthly'
    },
    session_pack: {
      label: 'Session Pack',
      labelAr: 'باقة جلسات',
      icon: 'ti-bolt',
      color: 'var(--wrn500)',
      accent: '#F59E0B',
      bg: 'var(--wrn100)',
      short: 'Sessions'
    },
    time_limited: {
      label: 'Time Limited',
      labelAr: 'محدود بالوقت',
      icon: 'ti-clock-hour-4',
      color: 'var(--purple)',
      accent: '#8B5CF6',
      bg: 'var(--purple100)',
      short: 'Time'
    },
    pt_credits: {
      label: 'PT Credits',
      labelAr: 'رصيد تدريب',
      icon: 'ti-barbell',
      color: 'var(--t500)',
      accent: '#148F8F',
      bg: 'var(--t100)',
      short: 'PT'
    },
    family: {
      label: 'Family',
      labelAr: 'عائلية',
      icon: 'ti-users-group',
      color: 'var(--coral)',
      accent: '#F97316',
      bg: 'var(--coral100)',
      short: 'Family'
    },
    trial: {
      label: 'Trial',
      labelAr: 'تجريبي',
      icon: 'ti-flask',
      color: 'var(--inf500)',
      accent: '#06B6D4',
      bg: 'var(--inf100)',
      short: 'Trial'
    },
    day_pass: {
      label: 'Day Pass',
      labelAr: 'يوم واحد',
      icon: 'ti-sun',
      color: 'var(--wrn500)',
      accent: '#EAB308',
      bg: 'var(--wrn100)',
      short: 'Day'
    }
  };

  function toast(msg, type) {
    type = type || 'success';
    const t = document.getElementById('toast');
    const icon = type === 'success' ? 'ti-check' : 'ti-alert-circle';
    t.innerHTML = '<i class="ti ' + icon + '"></i>' + msg;
    t.className = 'toast ' + type + ' show';
    setTimeout(function () {
      t.classList.remove('show');
    }, 4000);
  }

  function errMsg(r) {
    if (!r) return 'Request failed';
    if (r.error && r.error.message) return r.error.message;
    if (r.data) return r.data.message || r.data.error || 'Request failed';
    return 'Request failed';
  }

  function openModal() {
    document.getElementById('modalOverlay').classList.add('show');
  }
  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
  }
  function openDelete() {
    document.getElementById('deleteOverlay').classList.add('show');
  }
  function closeDelete() {
    document.getElementById('deleteOverlay').classList.remove('show');
  }

  document.getElementById('modalOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });
  document.getElementById('deleteOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeDelete();
  });

  /** TimeOnly → "HH:mm:ss" for JSON; HTML time inputs are HH:mm. */
  function toTimeOnly(v) {
    if (!v) return null;
    var s = String(v).trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
    if (/^\d{2}:\d{2}:\d{2}\./.test(s)) return s.slice(0, 8);
    return s;
  }

  function toTimeInputValue(v) {
    if (!v) return '';
    var s = String(v);
    if (s.length >= 5) return s.slice(0, 5);
    return s;
  }

  let allPlans = [];

  async function loadPlans() {
    grid.innerHTML =
      '<div class="loading-state"><div class="loader"></div><p>Loading plans...</p></div>';
    if (!Gfp) {
      grid.innerHTML =
        '<div class="empty-state"><div class="empty-title">API client missing</div></div>';
      return;
    }
    const r = await Gfp.get('/membership-plans');
    if (!r.ok) {
      grid.innerHTML =
        '<div class="empty-state"><div class="empty-icon"><i class="ti ti-alert-circle"></i></div><div class="empty-title">Could not load plans</div><div class="empty-desc">' +
        esc(errMsg(r)) +
        '</div></div>';
      return;
    }
    allPlans = Array.isArray(r.data) ? r.data : [];
    // List DTO is lean — enrich active cards with detail for features + membership counts
    await enrichPlanDetails(allPlans);
    renderPlans(allPlans);
    updateStats(allPlans);
  }

  async function enrichPlanDetails(plans) {
    if (!plans.length || !Gfp) return;
    await Promise.all(
      plans.map(async function (p) {
        try {
          const d = await Gfp.get('/membership-plans/' + p.id);
          if (d.ok && d.data) {
            Object.assign(p, {
              sessionCount: d.data.sessionCount,
              timeRestrictionStart: d.data.timeRestrictionStart,
              timeRestrictionEnd: d.data.timeRestrictionEnd,
              invitationQuota: d.data.invitationQuota,
              referralRewardType: d.data.referralRewardType,
              referralRewardValue: d.data.referralRewardValue,
              trialVisitLimit: d.data.trialVisitLimit,
              description: d.data.description,
              descriptionAr: d.data.descriptionAr,
              activeMemberships: d.data.activeMemberships,
              totalMemberships: d.data.totalMemberships
            });
          }
        } catch (e) {
          /* leave lean list item */
        }
      })
    );
  }

  function updateStats(plans) {
    document.getElementById('statTotal').textContent = plans.length;
    document.getElementById('statActive').textContent = plans.filter(function (p) {
      return p.isActive;
    }).length;
    document.getElementById('statInactive').textContent = plans.filter(function (p) {
      return !p.isActive;
    }).length;
  }

  function renderPlans(plans) {
    if (!plans.length) {
      grid.innerHTML =
        '<div class="empty-state"><div class="empty-icon"><i class="ti ti-package-off"></i></div><div class="empty-title">No Plans Yet</div><div class="empty-desc">Create your first membership plan to get started.</div><button class="btn-create" id="emptyCreate"><i class="ti ti-plus"></i> Create Plan</button></div>';
      const ec = document.getElementById('emptyCreate');
      if (ec) ec.addEventListener('click', function () {
        showPlanModal();
      });
      return;
    }

    grid.innerHTML = plans.map(buildCard).join('');

    grid.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const action = this.dataset.action;
        const id = this.dataset.id;
        if (action === 'edit') showPlanModal(id);
        else if (action === 'delete') showDeleteConfirm(id);
      });
    });
  }

  function buildCard(p) {
    const pt = PT[p.planType] || PT.monthly_unlimited;
    const features = buildFeatures(p);

    return (
      '<div class="plan-card ' +
      (p.isActive ? '' : 'inactive') +
      '">' +
      '<div class="card-accent" style="background:' +
      pt.accent +
      '"></div>' +
      '<div class="card-body">' +
      '<span class="type-badge type-' +
      p.planType +
      '"><i class="ti ' +
      pt.icon +
      '"></i>' +
      pt.label +
      '</span>' +
      '<div class="plan-name">' +
      esc(p.name) +
      '</div>' +
      '<div class="plan-name-ar">' +
      esc(p.nameAr || '') +
      '</div>' +
      '<div class="plan-price">' +
      '<span class="price-currency">' +
      esc(p.currency || 'EGP') +
      '</span>' +
      '<span class="price-amount">' +
      formatPrice(p.price) +
      '</span>' +
      '</div>' +
      '<div class="plan-duration"><i class="ti ti-calendar"></i>' +
      p.durationDays +
      ' days</div>' +
      features +
      '<div class="card-stats">' +
      '<div class="card-stat"><div class="card-stat-val">' +
      (p.activeMemberships || 0) +
      '</div><div class="card-stat-lbl">Active</div></div>' +
      '<div class="card-stat"><div class="card-stat-val">' +
      (p.totalMemberships || 0) +
      '</div><div class="card-stat-lbl">Total</div></div>' +
      '</div>' +
      '<div class="card-actions">' +
      '<button class="card-btn" data-action="edit" data-id="' +
      p.id +
      '"><i class="ti ti-edit"></i> Edit</button>' +
      '<button class="card-btn del" data-action="delete" data-id="' +
      p.id +
      '"><i class="ti ti-trash"></i> Soft delete</button>' +
      '</div></div></div>'
    );
  }

  function buildFeatures(p) {
    const items = [];
    if (p.planType === 'session_pack' && p.sessionCount) {
      items.push(
        '<div class="plan-feature"><i class="ti ti-bolt"></i>' + p.sessionCount + ' sessions included</div>'
      );
    }
    if (p.planType === 'time_limited' && p.timeRestrictionStart) {
      items.push(
        '<div class="plan-feature"><i class="ti ti-clock-hour-4"></i>' +
          toTimeInputValue(p.timeRestrictionStart) +
          ' – ' +
          toTimeInputValue(p.timeRestrictionEnd) +
          '</div>'
      );
    }
    if (p.invitationQuota != null && p.invitationQuota > 0) {
      items.push(
        '<div class="plan-feature"><i class="ti ti-ticket"></i>' +
          p.invitationQuota +
          ' guest invitations/month</div>'
      );
    }
    if (p.planType === 'trial' && p.trialVisitLimit) {
      items.push(
        '<div class="plan-feature"><i class="ti ti-flask"></i>' +
          p.trialVisitLimit +
          ' visit limit</div>'
      );
    }
    if (p.description) {
      items.push(
        '<div class="plan-feature"><i class="ti ti-info-circle"></i>' + esc(p.description) + '</div>'
      );
    }
    return items.length ? '<div class="plan-features">' + items.join('') + '</div>' : '';
  }

  function formatPrice(v) {
    return Number(v || 0).toLocaleString('en-EG');
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  /** Soft-delete — always call API; distinct 409 "plan in use" UX. */
  async function showDeleteConfirm(id) {
    const plan = allPlans.find(function (p) {
      return p.id === id;
    });
    if (!plan) return;
    const dlg = document.getElementById('deleteDialog');
    const active = plan.activeMemberships || 0;

    dlg.innerHTML =
      '<div class="del-icon warn"><i class="ti ti-trash"></i></div>' +
      '<div class="del-title">Soft-delete &quot;' +
      esc(plan.name) +
      '&quot;?</div>' +
      '<div class="del-msg">This deactivates the plan (soft delete). It will no longer be assignable.' +
      (active > 0
        ? '<br><br><strong>Note:</strong> This plan currently shows <strong>' +
          active +
          ' active membership' +
          (active > 1 ? 's' : '') +
          '</strong>. If still in use, the server will reject with conflict.'
        : '') +
      '</div>' +
      '<div class="del-actions">' +
      '<button class="btn-cancel" id="delCancel">Cancel</button>' +
      '<button class="btn-primary" style="background:var(--dng500);box-shadow:0 2px 8px rgba(239,68,68,.3)" id="delConfirm"><i class="ti ti-trash"></i> Soft delete</button>' +
      '</div>';
    openDelete();
    document.getElementById('delCancel').addEventListener('click', closeDelete);
    document.getElementById('delConfirm').addEventListener('click', async function () {
      const btn = document.getElementById('delConfirm');
      btn.disabled = true;
      const res = await Gfp.del('/membership-plans/' + id);
      if (res.ok || res.status === 204) {
        closeDelete();
        toast('Plan soft-deleted (inactive)');
        loadPlans();
        return;
      }
      if (res.status === 409) {
        const serverMsg = errMsg(res);
        dlg.innerHTML =
          '<div class="del-icon conflict"><i class="ti ti-alert-triangle"></i></div>' +
          '<div class="del-title">Plan in use</div>' +
          '<div class="del-msg">This plan cannot be deleted while it has active or frozen memberships.<br><br>' +
          esc(serverMsg) +
          '</div>' +
          '<div class="del-actions"><button class="btn-cancel" id="delClose">Understood</button></div>';
        document.getElementById('delClose').addEventListener('click', closeDelete);
        return;
      }
      closeDelete();
      toast(errMsg(res), 'error');
    });
  }

  async function showPlanModal(editId) {
    const isEdit = !!editId;
    let plan = {};
    if (isEdit) {
      const r = await Gfp.get('/membership-plans/' + editId);
      if (!r.ok || !r.data) {
        toast(errMsg(r) || 'Failed to load plan', 'error');
        return;
      }
      plan = r.data;
    }

    const modal = document.getElementById('modalContent');
    modal.innerHTML = buildModalHTML(plan, isEdit);
    openModal();

    const typeCards = modal.querySelectorAll('.type-card');
    typeCards.forEach(function (tc) {
      tc.addEventListener('click', function () {
        if (isEdit) return; // plan type locked on edit to avoid orphaned field mismatches
        typeCards.forEach(function (c) {
          c.classList.remove('selected');
        });
        this.classList.add('selected');
        this.querySelector('input').checked = true;
        updateConditionalFields(this.querySelector('input').value);
        applyTrialPriceLock();
        updatePreview();
      });
    });

    modal.querySelectorAll('.session-opt').forEach(function (so) {
      so.addEventListener('click', function () {
        modal.querySelectorAll('.session-opt').forEach(function (s) {
          s.classList.remove('selected');
        });
        this.classList.add('selected');
        this.querySelector('input').checked = true;
        const customInput = document.getElementById('sessionCustom');
        if (customInput) customInput.value = this.querySelector('input').value;
        updatePreview();
      });
    });

    updateConditionalFields(plan.planType || 'monthly_unlimited');
    applyTrialPriceLock();

    modal.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.addEventListener('input', updatePreview);
      el.addEventListener('change', updatePreview);
    });
    updatePreview();

    modal.querySelector('.modal-close')?.addEventListener('click', closeModal);

    document.getElementById('planForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = this.querySelector('.btn-primary');
      const collected = collectFormData();
      if (collected.error) {
        toast(collected.error, 'error');
        return;
      }
      btn.disabled = true;
      btn.innerHTML =
        '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Saving...';

      const res = isEdit
        ? await Gfp.put('/membership-plans/' + editId, collected.body)
        : await Gfp.post('/membership-plans', collected.body);

      if (res && res.ok) {
        toast(isEdit ? 'Plan updated' : 'Plan created');
        closeModal();
        loadPlans();
      } else {
        toast(errMsg(res) || 'Failed to save plan', 'error');
        btn.disabled = false;
        btn.innerHTML = isEdit
          ? '<i class="ti ti-check"></i> Update Plan'
          : '<i class="ti ti-plus"></i> Create Plan';
      }
    });
  }

  function applyTrialPriceLock() {
    const f = document.getElementById('planForm');
    if (!f) return;
    const fd = new FormData(f);
    const type = fd.get('planType');
    const priceInput = f.querySelector('[name="price"]');
    if (!priceInput) return;
    if (type === 'trial') {
      priceInput.value = '0';
      priceInput.readOnly = true;
      priceInput.title = 'Trial plans must be free (price 0)';
    } else {
      priceInput.readOnly = false;
      priceInput.title = '';
    }
  }

  function collectFormData() {
    const f = document.getElementById('planForm');
    const fd = new FormData(f);
    const body = {
      name: (fd.get('name') || '').trim(),
      nameAr: (fd.get('nameAr') || '').trim(),
      planType: fd.get('planType'),
      price: parseFloat(fd.get('price')) || 0,
      durationDays: parseInt(fd.get('durationDays'), 10) || 30
    };

    const desc = fd.get('description');
    const descAr = fd.get('descriptionAr');
    if (desc) body.description = desc;
    if (descAr) body.descriptionAr = descAr;

    if (body.planType === 'session_pack') {
      const sc = parseInt(fd.get('sessionCustom'), 10);
      if (SESSION_PACK_COUNTS.indexOf(sc) === -1) {
        return { error: 'Session pack count must be 10, 20, or 50' };
      }
      body.sessionCount = sc;
    }

    if (body.planType === 'time_limited') {
      const start = fd.get('timeStart');
      const end = fd.get('timeEnd');
      if (!start || !end) {
        return { error: 'Time-limited plans require both start and end times' };
      }
      body.timeRestrictionStart = toTimeOnly(start);
      body.timeRestrictionEnd = toTimeOnly(end);
    }

    // Guest-pass monthly quota applies to every plan type (not only family).
    body.invitationQuota = parseInt(fd.get('invitationQuota'), 10) || 0;

    const rType = (fd.get('referralRewardType') || '').toString().trim();
    if (rType === 'credit' || rType === 'free_days') {
      body.referralRewardType = rType;
      const rv = parseFloat(fd.get('referralRewardValue'));
      if (!isNaN(rv) && rv > 0) body.referralRewardValue = rv;
    } else {
      body.referralRewardType = null;
      body.referralRewardValue = null;
    }

    if (body.planType === 'trial') {
      body.price = 0;
      const tv = fd.get('trialVisitLimit');
      if (tv !== null && tv !== '') {
        const n = parseInt(tv, 10);
        if (!isNaN(n) && n > 0) body.trialVisitLimit = n;
      }
    }

    return { body: body };
  }

  function updateConditionalFields(type) {
    document.querySelectorAll('.cond-section').forEach(function (s) {
      if (s.id === 'cond-referral-rewards' || s.id === 'cond-guest-quota') {
        s.classList.add('visible');
        return;
      }
      s.classList.remove('visible');
    });
    const sec = document.getElementById('cond-' + type);
    if (sec) sec.classList.add('visible');
  }

  function updatePreview() {
    const prev = document.getElementById('previewCard');
    if (!prev) return;
    const f = document.getElementById('planForm');
    if (!f) return;
    const fd = new FormData(f);
    const name = fd.get('name') || 'Plan Name';
    const nameAr = fd.get('nameAr') || '';
    const type = fd.get('planType') || 'monthly_unlimited';
    const price = type === 'trial' ? '0' : fd.get('price') || '0';
    const dur = fd.get('durationDays') || '30';
    const pt = PT[type] || PT.monthly_unlimited;

    let feats = '';
    if (type === 'session_pack') {
      const sc = fd.get('sessionCustom') || '10';
      feats =
        '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--lts);padding:8px 16px"><i class="ti ti-bolt" style="color:var(--l600)"></i>' +
        sc +
        ' sessions</div>';
    }
    if (type === 'time_limited') {
      const ts = fd.get('timeStart') || '08:00';
      const te = fd.get('timeEnd') || '17:00';
      feats =
        '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--lts);padding:8px 16px"><i class="ti ti-clock-hour-4" style="color:var(--l600)"></i>' +
        ts +
        ' – ' +
        te +
        '</div>';
    }
    if (type === 'family') {
      feats = '';
    }
    const iqPreview = parseInt(fd.get('invitationQuota'), 10) || 0;
    if (iqPreview > 0) {
      feats +=
        '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--lts);padding:8px 16px"><i class="ti ti-ticket" style="color:var(--l600)"></i>' +
        iqPreview +
        ' guest invitations/month</div>';
    }
    if (type === 'trial') {
      const tv = fd.get('trialVisitLimit') || '';
      feats = tv
        ? '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--lts);padding:8px 16px"><i class="ti ti-flask" style="color:var(--l600)"></i>' +
          tv +
          ' visits</div>'
        : '';
      if (iqPreview > 0) {
        feats +=
          '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--lts);padding:8px 16px"><i class="ti ti-ticket" style="color:var(--l600)"></i>' +
          iqPreview +
          ' guest invitations/month</div>';
      }
    }

    prev.innerHTML =
      '<div style="height:4px;background:' +
      pt.accent +
      '"></div>' +
      '<div style="padding:16px">' +
      '<span class="type-badge type-' +
      type +
      '" style="font-size:9px;padding:3px 8px"><i class="ti ' +
      pt.icon +
      '"></i>' +
      pt.label +
      '</span>' +
      '<div style="font-family:var(--fd);font-size:16px;font-weight:700;margin-top:8px">' +
      esc(name) +
      '</div>' +
      (nameAr
        ? '<div style="font-family:var(--fa);font-size:11px;color:var(--ltt);direction:rtl">' +
          esc(nameAr) +
          '</div>'
        : '') +
      '<div style="margin:10px 0 4px;display:flex;align-items:baseline;gap:3px">' +
      '<span style="font-size:12px;color:var(--ltt)">EGP</span>' +
      '<span style="font-family:var(--fd);font-size:26px;font-weight:700;color:var(--l600)">' +
      formatPrice(price) +
      '</span></div>' +
      '<div style="font-size:11px;color:var(--ltt);display:flex;align-items:center;gap:4px"><i class="ti ti-calendar" style="font-size:13px"></i>' +
      dur +
      ' days</div>' +
      feats +
      '</div>';
  }

  function buildModalHTML(p, isEdit) {
    const v = p || {};
    const selType = v.planType || 'monthly_unlimited';
    let sessCount = v.sessionCount || 20;
    if (SESSION_PACK_COUNTS.indexOf(sessCount) === -1) sessCount = 20;

    return (
      '<div class="modal-header">' +
      '<div><h2>' +
      (isEdit ? 'Edit Plan' : 'Create New Plan') +
      '</h2>' +
      '<div class="modal-header-sub">' +
      (isEdit ? 'Update plan details' : 'Add a new membership plan') +
      '</div></div>' +
      '<button type="button" class="modal-close"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<form id="planForm">' +
      '<div class="modal-body">' +
      '<div class="form-row">' +
      '<div class="fg"><label>Plan Name (English) <span class="req">*</span></label><input name="name" value="' +
      esc(v.name || '') +
      '" required placeholder="e.g. Monthly Unlimited"></div>' +
      '<div class="fg"><label>Plan Name (Arabic) <span class="req">*</span></label><input name="nameAr" value="' +
      esc(v.nameAr || '') +
      '" required placeholder="مثال: شهري غير محدود" dir="rtl" style="font-family:var(--fa)"></div>' +
      '</div>' +
      '<div class="fg"><label>Plan Type <span class="req">*</span></label>' +
      (isEdit
        ? '<div class="modal-header-sub" style="margin-bottom:8px">Type is fixed after create</div>'
        : '') +
      '</div>' +
      '<div class="type-selector">' +
      Object.keys(PT)
        .filter(function (key) {
          // Trials / PT Credits removed from product — hide except when editing legacy plans
          if (key === 'trial' || key === 'pt_credits') {
            return isEdit && key === selType;
          }
          return true;
        })
        .map(function (key) {
          const cfg = PT[key];
          const locked = isEdit && key !== selType;
          return (
            '<div class="type-card ' +
            (key === selType ? 'selected' : '') +
            (locked ? ' locked' : '') +
            '"' +
            (locked ? ' style="opacity:.4;pointer-events:none"' : '') +
            '>' +
            '<input type="radio" name="planType" value="' +
            key +
            '" ' +
            (key === selType ? 'checked' : '') +
            (isEdit && key !== selType ? ' disabled' : '') +
            '>' +
            '<div class="type-card-icon" style="background:' +
            cfg.bg +
            ';color:' +
            cfg.color +
            '"><i class="ti ' +
            cfg.icon +
            '"></i></div>' +
            '<div class="type-card-name">' +
            cfg.short +
            '</div></div>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="form-row">' +
      '<div class="fg"><label>Price (EGP) <span class="req">*</span></label><input type="number" name="price" step="0.01" min="0" value="' +
      (selType === 'trial' ? '0' : v.price != null ? v.price : '') +
      '" required placeholder="500" ' +
      (selType === 'trial' ? 'readonly' : '') +
      '></div>' +
      '<div class="fg"><label>Duration (days) <span class="req">*</span></label><input type="number" name="durationDays" min="1" value="' +
      (v.durationDays != null ? v.durationDays : '') +
      '" required placeholder="30"></div>' +
      '</div>' +
      '<div class="cond-section" id="cond-session_pack">' +
      '<div class="cond-title"><i class="ti ti-bolt"></i> Session Pack Options</div>' +
      '<label style="font-size:12px;font-weight:600;color:var(--lts);margin-bottom:8px;display:block">Number of Sessions (10 / 20 / 50)</label>' +
      '<div class="session-options">' +
      SESSION_PACK_COUNTS.map(function (n) {
        return (
          '<div class="session-opt ' +
          (sessCount == n ? 'selected' : '') +
          '"><input type="radio" name="sessionRadio" value="' +
          n +
          '" ' +
          (sessCount == n ? 'checked' : '') +
          '><div class="session-opt-val">' +
          n +
          '</div><div class="session-opt-lbl">sessions</div></div>'
        );
      }).join('') +
      '</div>' +
      '<input type="hidden" name="sessionCustom" id="sessionCustom" value="' +
      sessCount +
      '">' +
      '</div>' +
      '<div class="cond-section" id="cond-time_limited">' +
      '<div class="cond-title"><i class="ti ti-clock-hour-4"></i> Time Restriction (both required)</div>' +
      '<div class="form-row">' +
      '<div class="fg"><label>Start Time <span class="req">*</span></label><input type="time" name="timeStart" value="' +
      toTimeInputValue(v.timeRestrictionStart || '08:00') +
      '"></div>' +
      '<div class="fg"><label>End Time <span class="req">*</span></label><input type="time" name="timeEnd" value="' +
      toTimeInputValue(v.timeRestrictionEnd || '17:00') +
      '"></div>' +
      '</div></div>' +
      '<div class="cond-section" id="cond-family">' +
      '<div class="cond-title"><i class="ti ti-users-group"></i> Family Plan Options</div>' +
      '<div class="modal-header-sub">Family plan uses a higher referral reward multiplier when friends join on this plan type. Guest invites are configured below for every plan.</div></div>' +
      '<div class="cond-section visible" id="cond-guest-quota" style="display:block">' +
      '<div class="cond-title"><i class="ti ti-ticket"></i> Guest invitations (train free)</div>' +
      '<div class="fg"><label>Guest invitations per month</label><input type="number" name="invitationQuota" min="0" value="' +
      (v.invitationQuota != null ? v.invitationQuota : 0) +
      '" placeholder="0 = none"><div class="modal-header-sub">How many friends a member on this plan may invite per Cairo month. Desk redeems visits on Attendance. Set 0 to disable guest passes.</div></div></div>' +
      '<div class="cond-section visible" id="cond-referral-rewards" style="display:block">' +
      '<div class="cond-title"><i class="ti ti-gift"></i> Referral rewards (when a friend becomes a paying member)</div>' +
      '<div class="form-row">' +
      '<div class="fg"><label>Reward type</label><select name="referralRewardType">' +
      '<option value="">— Not set (use defaults later) —</option>' +
      '<option value="credit"' +
      (v.referralRewardType === 'credit' ? ' selected' : '') +
      '>Account credit (EGP)</option>' +
      '<option value="free_days"' +
      (v.referralRewardType === 'free_days' ? ' selected' : '') +
      '>Free membership days</option>' +
      '</select></div>' +
      '<div class="fg"><label>Reward value</label><input type="number" name="referralRewardValue" min="0" step="0.01" value="' +
      (v.referralRewardValue != null ? v.referralRewardValue : '') +
      '" placeholder="EGP or days"></div></div>' +
      '<div class="modal-header-sub">Referral share codes are uncapped; only rewarded conversions use the monthly reward cap.</div></div>' +
      '<div class="cond-section" id="cond-trial">' +
      '<div class="cond-title"><i class="ti ti-flask"></i> Trial Options</div>' +
      '<div class="fg"><label>Visit limit (optional)</label><input type="number" name="trialVisitLimit" min="1" value="' +
      (v.trialVisitLimit != null ? v.trialVisitLimit : '') +
      '" placeholder="e.g. 3"><div class="modal-header-sub">Price is always 0 for trial plans</div></div></div>' +
      '<div class="form-row">' +
      '<div class="fg"><label>Description (English)</label><textarea name="description" placeholder="Optional plan description...">' +
      esc(v.description || '') +
      '</textarea></div>' +
      '<div class="fg"><label>Description (Arabic)</label><textarea name="descriptionAr" placeholder="وصف الباقة..." dir="rtl" style="font-family:var(--fa)">' +
      esc(v.descriptionAr || '') +
      '</textarea></div></div>' +
      '<div class="preview-section">' +
      '<div class="preview-label"><i class="ti ti-eye"></i> Live Preview</div>' +
      '<div class="preview-card" id="previewCard"></div></div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button type="button" class="btn-cancel" id="modalCancel">Cancel</button>' +
      '<button type="submit" class="btn-primary">' +
      (isEdit
        ? '<i class="ti ti-check"></i> Update Plan'
        : '<i class="ti ti-plus"></i> Create Plan') +
      '</button></div></form>'
    );
  }

  // Wire cancel after first paint of create button
  document.getElementById('btnCreate').addEventListener('click', function () {
    showPlanModal();
  });
  document.getElementById('modalOverlay').addEventListener('click', function (e) {
    if (e.target && e.target.id === 'modalCancel') closeModal();
  });
  document.addEventListener('click', function (e) {
    if (e.target && (e.target.id === 'modalCancel' || e.target.closest('#modalCancel'))) {
      closeModal();
    }
  });

  loadPlans();
})();
