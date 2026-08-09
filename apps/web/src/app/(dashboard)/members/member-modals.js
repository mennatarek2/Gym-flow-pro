// ═══════════════════════════════════════════════════════════════
//  Member Modals — Add Member, Edit Member Drawer, Assign Membership
//  API: POST /api/members, PUT /api/members/{id}, POST /api/memberships/{id}/assign
// ═══════════════════════════════════════════════════════════════
(function(){
  const Gfp = window.GfpApi;
  const Authz = window.GfpAuthz;
  function canCreate(){ return Authz ? Authz.useCan('members.create') : !!window.__gfpCanCreateMember; }
  function canEdit(){ return Authz ? Authz.useCan('members.edit') : !!window.__gfpCanEditMember; }
  function apiMsg(r, fallback){
    if(window.GfpI18n&&window.GfpI18n.displayApiError){
      const m=window.GfpI18n.displayApiError(r);
      if(m) return m;
    }
    // ASP.NET FluentValidation ProblemDetails: { errors: { Phone: ["..."], DateOfBirth: ["..."] } }
    const errs=(r&&r.data&&r.data.errors)
      ||(r&&r.error&&r.error.errors)
      ||(r&&r.error&&r.error.raw&&r.error.raw.errors);
    if(errs&&typeof errs==='object'){
      const parts=[];
      Object.keys(errs).forEach(k=>{
        const v=errs[k];
        if(Array.isArray(v)) parts.push.apply(parts,v);
        else if(v) parts.push(String(v));
      });
      if(parts.length) return parts.join(' · ');
    }
    return (r&&r.error&&r.error.message)||(r&&r.data&&r.data.title)||fallback;
  }

  function maxDobIso(){
    const d=new Date();
    d.setFullYear(d.getFullYear()-10);
    return d.toISOString().slice(0,10);
  }
  function validateDob(val){
    if(!val) return false;
    return val<=maxDobIso();
  }

  // ── Toast helper ──
  function toast(msg,type='success'){
    let t=document.getElementById('toast');
    if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t);}
    t.className='toast '+type;
    t.innerHTML=`<i class="ti ti-${type==='success'?'circle-check':'circle-x'}"></i>${msg}`;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),3500);
  }

  // ── Phone validation (Egyptian) ──
  // UI shows local 01x…; API stores canonical +20XXXXXXXXXX (no leading 0 after +20).
  function validatePhone(val){
    const clean=val.replace(/[\s\-()]/g,'');
    // Local 01x… (11) or national without leading 0 (10) or full +20… / 20…
    return /^(010|011|012|015)\d{8}$/.test(clean)
      || /^(10|11|12|15)\d{8}$/.test(clean)
      || /^\+?20(10|11|12|15)\d{8}$/.test(clean);
  }
  function formatPhoneForApi(val){
    let clean=val.replace(/[\s\-()]/g,'');
    if(clean.startsWith('+')) clean=clean.slice(1);
    if(clean.startsWith('00')) clean=clean.slice(2);
    if(clean.startsWith('20') && clean.length===12) return '+'+clean;
    if(clean.startsWith('0') && clean.length===11) clean=clean.slice(1);
    return '+20'+clean;
  }
  /** Display phone in the +20-prefixed input (local 01x… preferred). */
  function phoneToLocalInput(apiPhone){
    let p=(apiPhone||'').replace(/[\s\-()]/g,'');
    if(p.startsWith('+20')) p=p.slice(3);
    else if(p.startsWith('20')&&p.length===12) p=p.slice(2);
    if(/^(10|11|12|15)\d{8}$/.test(p)) return '0'+p;
    return p;
  }

  // Compat for remaining non-§2 calls (assign uses memberships API)
  const API_BASE = window.API_BASE || 'https://localhost:5001/api';
  function getAuthHeaders(){
    const t=(Gfp&&Gfp.tokens?Gfp.tokens.getAccess():null)||localStorage.getItem('gfp_access_token')||sessionStorage.getItem('gfp_access_token');
    const h={'Content-Type':'application/json'};
    if(t) h['Authorization']='Bearer '+t;
    return h;
  }

  // ══════════════════════════════════════════════════════════════
  //  1. ADD MEMBER MODAL
  // ══════════════════════════════════════════════════════════════
  function initAddMemberModal(){
    const overlay=document.getElementById('addMemberModal');
    if(!overlay) return;
    const form={
      nameEn: overlay.querySelector('#addNameEn'),
      nameAr: overlay.querySelector('#addNameAr'),
      phone:  overlay.querySelector('#addPhone'),
      dob:    overlay.querySelector('#addDob'),
      email:  overlay.querySelector('#addEmail'),
      nationalId: overlay.querySelector('#addNationalId'),
      emergency:  overlay.querySelector('#addEmergency'),
      notes:  overlay.querySelector('#addNotes'),
      referralCode: overlay.querySelector('#addReferralCode'),
    };
    const btnCreate=overlay.querySelector('#btnCreateMember');
    const errorBanner=overlay.querySelector('#addErrorBanner');
    const phoneWrap=overlay.querySelector('#addPhoneWrap');

    // Collapsible section
    const toggleBtn=overlay.querySelector('#addSectionToggle');
    const sectionBody=overlay.querySelector('#addSectionBody');
    if(toggleBtn&&sectionBody){
      toggleBtn.addEventListener('click',()=>{
        sectionBody.classList.toggle('collapsed');
        toggleBtn.classList.toggle('collapsed');
      });
    }

    // Real-time phone validation
    if(form.phone){
      form.phone.addEventListener('input',function(){
        const v=this.value.replace(/[\s\-()]/g,'');
        const phoneErr=overlay.querySelector('#addPhoneError');
        if(v.length>0 && v.length>=10){
          if(!validatePhone(v)){
            phoneWrap&&phoneWrap.classList.add('error');
            phoneErr&&phoneErr.classList.add('show');
            phoneErr&&(phoneErr.querySelector('.field-error-text').textContent='Invalid Egyptian phone format');
          } else {
            phoneWrap&&phoneWrap.classList.remove('error');
            phoneErr&&phoneErr.classList.remove('show');
          }
        } else if(v.length===0){
          phoneWrap&&phoneWrap.classList.remove('error');
          phoneErr&&phoneErr.classList.remove('show');
        }
        validateAddForm();
      });
    }

    // Cap DOB to API rule: member must be at least 10 years old
    if(form.dob){
      form.dob.max=maxDobIso();
      form.dob.addEventListener('change',function(){
        const dobErr=overlay.querySelector('#addDobError');
        if(this.value&&!validateDob(this.value)){
          this.classList.add('error');
          if(dobErr){
            dobErr.classList.add('show');
            const t=dobErr.querySelector('.field-error-text');
            if(t) t.textContent='Member must be at least 10 years old';
          }
        } else {
          this.classList.remove('error');
          dobErr&&dobErr.classList.remove('show');
        }
        validateAddForm();
      });
    }

    // Validate required fields
    function validateAddForm(){
      const valid = form.nameEn&&form.nameEn.value.trim()
        && form.nameAr&&form.nameAr.value.trim()
        && form.phone&&validatePhone(form.phone.value.replace(/[\s\-()]/g,''))
        && form.dob&&validateDob(form.dob.value);
      if(btnCreate) btnCreate.disabled=!valid;
      return !!valid;
    }

    // Bind validation to required inputs
    ['nameEn','nameAr','dob'].forEach(k=>{
      if(form[k]) form[k].addEventListener('input',validateAddForm);
    });

    // Show/hide field errors on blur
    ['nameEn','nameAr'].forEach(k=>{
      if(!form[k]) return;
      form[k].addEventListener('blur',function(){
        const errEl=overlay.querySelector(`#add${k.charAt(0).toUpperCase()+k.slice(1)}Error`);
        if(!this.value.trim()){
          this.classList.add('error');
          if(errEl){errEl.classList.add('show');errEl.querySelector('.field-error-text').textContent='This field is required';}
        } else {
          this.classList.remove('error');
          if(errEl) errEl.classList.remove('show');
        }
      });
    });

    // Submit
    if(btnCreate){
      btnCreate.addEventListener('click',async function(){
        if(!validateAddForm()) return;
        btnCreate.classList.add('loading');
        btnCreate.disabled=true;
        errorBanner&&errorBanner.classList.remove('show');

        const body={
          fullName: form.nameEn.value.trim(),
          fullNameAr: form.nameAr.value.trim(),
          phone: formatPhoneForApi(form.phone.value),
          dateOfBirth: form.dob.value,
        };
        if(form.email&&form.email.value.trim()) body.email=form.email.value.trim();
        if(form.nationalId&&form.nationalId.value.trim()) body.nationalId=form.nationalId.value.trim();
        if(form.emergency&&form.emergency.value.trim()) body.emergencyContact=formatPhoneForApi(form.emergency.value);
        if(form.notes&&form.notes.value.trim()) body.notes=form.notes.value.trim();
        if(form.referralCode&&form.referralCode.value.trim())
          body.referralCode=form.referralCode.value.trim().toUpperCase();

        try{
          if(!canCreate()){ showAddError('Missing members.create permission'); return; }
          if(!Gfp){ showAddError('API client missing'); return; }
          const r=await Gfp.post('/members', body);
          if(r.ok){
            toast('Member created successfully');
            closeOverlay('addMemberModal');
            resetAddForm();
            // Re-fetch list — ActivePlan/MembershipStatus are server-derived
            if(typeof window.loadMembers==='function') window.loadMembers();
            if(typeof window.loadStats==='function') window.loadStats();
          } else {
            showAddError(apiMsg(r,'Failed to create member'));
          }
        }catch(e){
          showAddError('Network error — please try again');
        }
        btnCreate.classList.remove('loading');
        btnCreate.disabled=false;
        validateAddForm();
      });
    }

    function showAddError(msg){
      if(!errorBanner) return;
      const textEl=errorBanner.querySelector('.error-text');
      const arEl=errorBanner.querySelector('.error-text-ar');
      // Check for known bilingual errors
      if(msg.includes('Phone number already registered')||msg.includes('phone')||msg.includes('رقم')){
        if(textEl) textEl.textContent='Phone number already registered';
        if(arEl){arEl.textContent='رقم الهاتف مسجل مسبقاً';arEl.style.display='block';}
        phoneWrap&&phoneWrap.classList.add('error');
      } else {
        if(textEl) textEl.textContent=msg;
        if(arEl) arEl.style.display='none';
      }
      errorBanner.classList.add('show');
    }

    function resetAddForm(){
      Object.values(form).forEach(el=>{if(el){el.value='';el.classList.remove('error');}});
      overlay.querySelectorAll('.field-error').forEach(e=>e.classList.remove('show'));
      errorBanner&&errorBanner.classList.remove('show');
      phoneWrap&&phoneWrap.classList.remove('error');
      if(btnCreate) btnCreate.disabled=true;
      // Re-expand additional section
      sectionBody&&sectionBody.classList.remove('collapsed');
      toggleBtn&&toggleBtn.classList.remove('collapsed');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  2. EDIT MEMBER DRAWER
  // ══════════════════════════════════════════════════════════════
  let editMemberId=null;

  window.openEditDrawer=function(memberDataOrId){
    if(!canEdit()){ toast('Missing members.edit permission','error'); return; }
    const overlay=document.getElementById('editMemberDrawer');
    if(!overlay) return;
    if(typeof memberDataOrId==='string'){
      editMemberId=memberDataOrId;
      loadMemberForEdit(memberDataOrId);
    } else if(memberDataOrId&&memberDataOrId.id){
      editMemberId=memberDataOrId.id;
      populateEditForm(memberDataOrId);
    }
    overlay.classList.add('open');
  };

  async function loadMemberForEdit(id){
    const overlay=document.getElementById('editMemberDrawer');
    if(!overlay) return;
    try{
      if(!Gfp){ toast('API client missing','error'); return; }
      const r=await Gfp.get('/members/'+id);
      if(!r.ok) throw new Error('Not found');
      populateEditForm(r.data);
    }catch(e){
      toast('Failed to load member data','error');
    }
  }

  function populateEditForm(m){
    const overlay=document.getElementById('editMemberDrawer');
    if(!overlay) return;
    const f={
      nameEn: overlay.querySelector('#editNameEn'),
      nameAr: overlay.querySelector('#editNameAr'),
      phone:  overlay.querySelector('#editPhone'),
      dob:    overlay.querySelector('#editDob'),
      email:  overlay.querySelector('#editEmail'),
      nationalId: overlay.querySelector('#editNationalId'),
      emergency:  overlay.querySelector('#editEmergency'),
      notes:  overlay.querySelector('#editNotes'),
    };
    if(f.nameEn) f.nameEn.value=m.fullName||'';
    if(f.nameAr) f.nameAr.value=m.fullNameAr||'';
    if(f.phone){
      f.phone.value=phoneToLocalInput(m.phone);
    }
    if(f.dob){
      const dobRaw=(m.dateOfBirth||'').toString();
      f.dob.value=dobRaw.length>=10?dobRaw.slice(0,10):'';
      f.dob.max=maxDobIso();
    }
    if(f.email) f.email.value=m.email||'';
    if(f.nationalId) f.nationalId.value=m.nationalId||'';
    if(f.emergency){
      f.emergency.value=phoneToLocalInput(m.emergencyContact);
    }
    if(f.notes) f.notes.value=m.notes||'';
    // Timestamp
    const ts=overlay.querySelector('#editTimestamp');
    if(ts&&m.updatedAtUtc){
      ts.textContent='Last updated: '+new Date(m.updatedAtUtc).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
      ts.style.display='flex';
    } else if(ts&&m.createdAtUtc){
      ts.textContent='Created: '+new Date(m.createdAtUtc).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
      ts.style.display='flex';
    }
    validateEditForm();
  }

  function initEditDrawer(){
    const overlay=document.getElementById('editMemberDrawer');
    if(!overlay) return;
    const form={
      nameEn: overlay.querySelector('#editNameEn'),
      nameAr: overlay.querySelector('#editNameAr'),
      phone:  overlay.querySelector('#editPhone'),
      dob:    overlay.querySelector('#editDob'),
      email:  overlay.querySelector('#editEmail'),
    };
    const btnSave=overlay.querySelector('#btnSaveEdit');
    const errorBanner=overlay.querySelector('#editErrorBanner');
    const phoneWrap=overlay.querySelector('#editPhoneWrap');

    // Real-time phone validation
    if(form.phone){
      form.phone.addEventListener('input',function(){
        const v=this.value.replace(/[\s\-()]/g,'');
        const phoneErr=overlay.querySelector('#editPhoneError');
        if(v.length>0&&v.length>=10){
          if(!validatePhone(v)){
            phoneWrap&&phoneWrap.classList.add('error');
            phoneErr&&phoneErr.classList.add('show');
          } else {
            phoneWrap&&phoneWrap.classList.remove('error');
            phoneErr&&phoneErr.classList.remove('show');
          }
        } else {
          phoneWrap&&phoneWrap.classList.remove('error');
          phoneErr&&phoneErr.classList.remove('show');
        }
        validateEditForm();
      });
    }

    // Cap DOB (same rule as create)
    if(form.dob){
      form.dob.max=maxDobIso();
      form.dob.addEventListener('change',function(){
        const dobErr=overlay.querySelector('#editDobError');
        if(this.value&&!validateDob(this.value)){
          this.classList.add('error');
          if(dobErr){ dobErr.classList.add('show'); const t=dobErr.querySelector('.field-error-text'); if(t) t.textContent='Member must be at least 10 years old'; }
        } else {
          this.classList.remove('error');
          dobErr&&dobErr.classList.remove('show');
        }
        validateEditForm();
      });
    }

    function validateEditForm(){
      const valid=form.nameEn&&form.nameEn.value.trim()
        &&form.nameAr&&form.nameAr.value.trim()
        &&form.phone&&validatePhone(form.phone.value.replace(/[\s\-()]/g,''))
        &&form.dob&&validateDob(form.dob.value);
      if(btnSave) btnSave.disabled=!valid;
      return !!valid;
    }
    window.validateEditForm=validateEditForm;

    ['nameEn','nameAr','dob'].forEach(k=>{
      if(form[k]) form[k].addEventListener('input',validateEditForm);
    });

    // Collapsible section
    const toggleBtn=overlay.querySelector('#editSectionToggle');
    const sectionBody=overlay.querySelector('#editSectionBody');
    if(toggleBtn&&sectionBody){
      toggleBtn.addEventListener('click',()=>{
        sectionBody.classList.toggle('collapsed');
        toggleBtn.classList.toggle('collapsed');
      });
    }

    // Save
    if(btnSave){
      btnSave.addEventListener('click',async function(){
        if(!validateEditForm()||!editMemberId) return;
        btnSave.classList.add('loading');
        btnSave.disabled=true;
        errorBanner&&errorBanner.classList.remove('show');

        const body={
          fullName: form.nameEn.value.trim(),
          fullNameAr: overlay.querySelector('#editNameAr').value.trim(),
          phone: formatPhoneForApi(form.phone.value),
          dateOfBirth: form.dob.value,
        };
        const email=overlay.querySelector('#editEmail');
        const nationalId=overlay.querySelector('#editNationalId');
        const emergency=overlay.querySelector('#editEmergency');
        const notes=overlay.querySelector('#editNotes');
        if(email&&email.value.trim()) body.email=email.value.trim();
        if(nationalId&&nationalId.value.trim()) body.nationalId=nationalId.value.trim();
        if(emergency&&emergency.value.trim()) body.emergencyContact=formatPhoneForApi(emergency.value);
        if(notes) body.notes=notes.value.trim();

        try{
          if(!canEdit()){ showEditError('Missing members.edit permission'); return; }
          if(!Gfp){ showEditError('API client missing'); return; }
          const r=await Gfp.put('/members/'+editMemberId, body);
          if(r.ok){
            toast('Member updated successfully');
            closeOverlay('editMemberDrawer');
            // Re-fetch — ActivePlan/MembershipStatus are server-derived
            if(typeof window.loadMembers==='function') window.loadMembers();
            if(typeof window.loadMember==='function') window.loadMember();
          } else {
            showEditError(apiMsg(r,'Failed to update member'));
          }
        }catch(e){
          showEditError('Network error — please try again');
        }
        btnSave.classList.remove('loading');
        validateEditForm();
      });
    }

    function showEditError(msg){
      if(!errorBanner) return;
      const textEl=errorBanner.querySelector('.error-text');
      const arEl=errorBanner.querySelector('.error-text-ar');
      if(/already registered|مسجل/i.test(msg)||(/phone|Phone|رقم/.test(msg)&&/already|مسجل|duplicate|موجود/i.test(msg))){
        if(textEl) textEl.textContent='Phone number already registered';
        if(arEl){arEl.textContent='رقم الهاتف مسجل مسبقاً';arEl.style.display='block';}
      } else {
        if(textEl) textEl.textContent=msg;
        if(arEl) arEl.style.display='none';
      }
      errorBanner.classList.add('show');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  3. ASSIGN MEMBERSHIP MODAL
  // ══════════════════════════════════════════════════════════════
  let assignMemberId=null;
  let plansCache=null;

  function assignModalEl(){
    return document.getElementById('modalAssign')||document.getElementById('assignMembershipModal');
  }

  window.openAssignModal=function(memberId){
    // P12-R2 Opt B: Assign workflow owned by Memberships — deep-link only from Members
    if(!memberId){ toast('Member id required','error'); return; }
    window.location.href='/dashboard/memberships/?member='+encodeURIComponent(memberId);
  };

  async function loadPlans(){
    const overlay=assignModalEl();
    if(!overlay) return;
    const select=overlay.querySelector('#assignPlanSelect');
    const loading=overlay.querySelector('#planLoading');
    const detail=overlay.querySelector('#planDetailCard');
    if(loading) loading.style.display='flex';
    if(select) select.style.display='none';
    if(detail) detail.classList.remove('show');

    try{
      if(!plansCache){
        if(Gfp){
          const r=await Gfp.get('/membership-plans');
          if(!r.ok) throw new Error(r.error&&r.error.message||'Failed');
          plansCache=r.data;
        } else {
          const res=await fetch(API_BASE+'/membership-plans',{headers:getAuthHeaders()});
          if(!res.ok) throw new Error('Failed');
          plansCache=await res.json();
        }
      }
      if(select){
        select.innerHTML='<option value="">— Select a plan —</option>';
        (plansCache||[]).filter(p=>p&&p.isActive!==false).forEach(p=>{
          const opt=document.createElement('option');
          opt.value=p.id;
          opt.textContent=`${p.name} — EGP ${p.price} (${p.durationDays} days)`;
          opt.dataset.plan=JSON.stringify(p);
          select.appendChild(opt);
        });
        select.style.display='';
      }
    }catch(e){
      if(select){select.innerHTML='<option value="">Failed to load plans (needs plans.manage)</option>';select.style.display='';}
    }
    if(loading) loading.style.display='none';
  }

  function initAssignModal(){
    const overlay=assignModalEl();
    if(!overlay) return;
    const select=overlay.querySelector('#assignPlanSelect');
    const detail=overlay.querySelector('#planDetailCard');
    const btnAssign=overlay.querySelector('#btnAssignMembership');
    const errorBanner=overlay.querySelector('#assignErrorBanner');
    const paymentNote=overlay.querySelector('#assignPaymentNote');

    // Plan selection
    if(select){
      select.addEventListener('change',function(){
        if(!this.value){detail&&detail.classList.remove('show');validateAssignForm();return;}
        const opt=this.options[this.selectedIndex];
        try{
          const p=JSON.parse(opt.dataset.plan);
          if(detail){
            detail.querySelector('.pdc-name').textContent=p.name||'';
            detail.querySelector('.pdc-name-ar').textContent=p.nameAr||'';
            const typeEl=detail.querySelector('.pdc-type');
            if(typeEl) typeEl.textContent=(p.planType||'').replace(/_/g,' ');
            detail.querySelector('.pdc-price').innerHTML=`<span class="currency">EGP</span> ${(p.price||0).toLocaleString()}`;
            detail.querySelector('.pdc-duration').textContent=(p.durationDays||0)+' days';
            detail.classList.add('show');
          }
        }catch(e){}
        validateAssignForm();
      });
    }

    // Payment radios
    overlay.querySelectorAll('input[name="assignPayment"]').forEach(radio=>{
      radio.addEventListener('change',function(){
        if(paymentNote){
          if(this.value==='cash'){
            paymentNote.textContent='';
            paymentNote.innerHTML='<i class="ti ti-info-circle"></i> Membership will be activated immediately upon cash payment.';
            paymentNote.className='payment-note show';
          } else {
            paymentNote.innerHTML='<i class="ti ti-alert-triangle"></i> Membership will be created as "pending" and activated automatically when payment is confirmed via webhook.';
            paymentNote.className='payment-note warning show';
          }
        }
        validateAssignForm();
      });
    });

    function validateAssignForm(){
      const planOk=select&&select.value;
      const payOk=overlay.querySelector('input[name="assignPayment"]:checked');
      if(btnAssign) btnAssign.disabled=!(planOk&&payOk);
      return !!(planOk&&payOk);
    }

    // Submit
    if(btnAssign){
      btnAssign.addEventListener('click',async function(){
        // P12-R2: never POST assign from Members-hosted modal
        if(assignMemberId){
          window.location.href='/dashboard/memberships/?member='+encodeURIComponent(assignMemberId);
          return;
        }
        window.location.href='/dashboard/memberships/';
        return;
        btnAssign.classList.add('loading');
        btnAssign.disabled=true;
        errorBanner&&errorBanner.classList.remove('show');

        const payMethod=overlay.querySelector('input[name="assignPayment"]:checked').value;
        const body={planId:select.value,paymentMethod:payMethod};
        const refEl=overlay.querySelector('#assignReferralCode');
        if(refEl&&refEl.value.trim()) body.referralCode=refEl.value.trim().toUpperCase();

        try{
          let res;
          if(Gfp){
            res=await Gfp.post('/memberships/'+assignMemberId+'/assign',body);
          } else {
            const raw=await fetch(`${API_BASE}/memberships/${assignMemberId}/assign`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(body)});
            const data=await raw.json().catch(()=>null);
            res={ok:raw.ok,status:raw.status,data:data};
          }
          if(res.status===201||res.ok){
            const pending=res.data&&String(res.data.status||'').toLowerCase()==='pending';
            const statusMsg=payMethod==='cash'
              ?'Membership assigned & activated!'
              :'Assigned — waiting for payment. Refresh the membership panel (no live push).';
            toast(statusMsg, pending?'error':'success');
            closeOverlay(overlay.id);
            if(typeof window.loadMember==='function') window.loadMember();
          } else if(res.status===409){
            const msg=(res.data&&(res.data.message||res.data.error))||'Already has an active membership — cannot assign another.';
            if(errorBanner){
              const te=errorBanner.querySelector('.error-text');
              if(te) te.textContent='Active membership conflict: '+msg;
              errorBanner.classList.add('show');
            }
            toast('Blocked: active membership exists','error');
          } else {
            const msg=(res.data&&(res.data.message||res.data.error))||(res.error&&res.error.message)||'Failed to assign membership';
            if(errorBanner){
              errorBanner.querySelector('.error-text').textContent=msg;
              errorBanner.classList.add('show');
            }
          }
        }catch(e){
          if(errorBanner){errorBanner.querySelector('.error-text').textContent='Network error';errorBanner.classList.add('show');}
        }
        btnAssign.classList.remove('loading');
        validateAssignForm();
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  Overlay Controls
  // ══════════════════════════════════════════════════════════════
  function closeOverlay(id){
    const el=document.getElementById(id);
    if(el) el.classList.remove('open');
  }
  window.closeOverlay=closeOverlay;

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(o=>{
    o.addEventListener('click',function(e){if(e.target===this) this.classList.remove('open');});
  });
  // Close buttons
  document.querySelectorAll('.mdl-close').forEach(b=>{
    b.addEventListener('click',function(){this.closest('.modal-overlay').classList.remove('open');});
  });

  // Wire "Add Member" button on members list page
  const btnAdd=document.getElementById('btnAddMember');
  if(btnAdd){
    btnAdd.addEventListener('click',function(){
      if(!canCreate()){ toast('Missing members.create permission','error'); return; }
      const m=document.getElementById('addMemberModal');
      if(m) m.classList.add('open');
    });
  }

  // ── Init all components ──
  initAddMemberModal();
  initEditDrawer();
  initAssignModal();

})();
