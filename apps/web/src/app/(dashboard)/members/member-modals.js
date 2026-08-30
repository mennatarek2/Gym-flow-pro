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
  const API_BASE = window.API_BASE || 'https://reach-lullaby-tighten.ngrok-free.dev/api';
  function getAuthHeaders(){
    const t=(Gfp&&Gfp.tokens?Gfp.tokens.getAccess():null)||localStorage.getItem('gfp_access_token')||sessionStorage.getItem('gfp_access_token');
    const h={'Content-Type':'application/json'};
    if(t) h['Authorization']='Bearer '+t;
    return h;
  }

  // ══════════════════════════════════════════════════════════════
  //  1. ADD MEMBER ONBOARDING (Info → Membership → Payment → Done)
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
    let onboardStep=1;
    let createdMember=null;
    let selectedPlan=null;
    let onboardPlans=[];
    let onboardSale=null;
    let onboardInvoiceId=null;
    let onboardInvoiceNumber=null;

    function setOnboardStep(step){
      onboardStep=step;
      ['1','2','3','4'].forEach(function(s){
        const el=overlay.querySelector('#onboardStep'+s);
        if(el) el.style.display=String(step)===s?'':'none';
      });
      overlay.querySelectorAll('.ob-step').forEach(function(chip){
        const act=Number(chip.getAttribute('data-step'))===step;
        chip.style.background=act?'var(--l100)':'var(--ls2)';
        chip.style.color=act?'var(--l600)':'var(--ltt)';
      });
      const btnSkip=overlay.querySelector('#btnOnboardSkip');
      const btnView=overlay.querySelector('#btnOnboardViewMember');
      const btnCancel=overlay.querySelector('#btnOnboardCancel');
      const btnDone=overlay.querySelector('#btnOnboardDone');
      const label=btnCreate&&btnCreate.querySelector('.btn-label');
      if(btnSkip) btnSkip.style.display=(step===2)?'':'none';
      if(btnView) btnView.style.display=(step===4)?'inline-flex':'none';
      if(btnDone) btnDone.style.display=(step===4)?'':'none';
      if(btnCreate) btnCreate.style.display=(step===4)?'none':'';
      if(btnCancel) btnCancel.style.display=(step===4)?'none':'';
      if(label){
        if(step===1) label.innerHTML='<i class="ti ti-arrow-right"></i> Continue';
        else if(step===2) label.innerHTML='<i class="ti ti-arrow-right"></i> Continue';
        else if(step===3) label.innerHTML='<i class="ti ti-check"></i> Complete payment';
      }
      if(btnCreate) btnCreate.disabled=step===1?!validateAddForm():(step===2?!selectedPlan:false);
    }

    function onboardApiBase(){
      return (window.API_BASE || API_BASE || '').replace(/\/$/,'');
    }
    async function onboardFetchHtml(path){
      const token=(Gfp&&Gfp.tokens?Gfp.tokens.getAccess():null)
        ||localStorage.getItem('gfp_access_token')||sessionStorage.getItem('gfp_access_token');
      const headers={ 'ngrok-skip-browser-warning':'true' };
      if(token) headers.Authorization='Bearer '+token;
      const res=await fetch(onboardApiBase()+path,{ method:'GET', headers:headers });
      if(res.status===401){ window.location.href='/auth/login/'; return { ok:false, status:401, text:'' }; }
      const text=await res.text();
      return { ok:res.ok, status:res.status, text:text };
    }
    function closeOnboardPrint(){
      const ov=document.getElementById('onboardPrintOverlay');
      if(ov) ov.hidden=true;
      const frame=document.getElementById('onboardPrintFrame');
      if(frame) frame.srcdoc='';
    }
    async function openOnboardPrintHtml(title, htmlPath, autoPrint){
      const overlay=document.getElementById('onboardPrintOverlay');
      const frame=document.getElementById('onboardPrintFrame');
      const titleEl=document.getElementById('onboardPrintTitle');
      if(!overlay||!frame){ toast('Print view not available','error'); return; }
      if(titleEl) titleEl.textContent=title||'Print';
      overlay.hidden=false;
      frame.srcdoc='<p style="padding:16px;font-family:sans-serif;color:#666">Loading…</p>';
      const res=await onboardFetchHtml(htmlPath);
      if(!res.ok){
        const msg='Could not load print view'+(res.status?' (HTTP '+res.status+')':'');
        toast(msg,'error');
        frame.srcdoc='<p style="padding:16px;font-family:sans-serif;color:#991b1b">'+msg+'</p>';
        return;
      }
      frame.srcdoc=res.text||'';
      if(autoPrint){
        setTimeout(function(){
          try{ frame.contentWindow.focus(); frame.contentWindow.print(); }
          catch(e){ toast('Allow pop-ups / try Print again','error'); }
        }, 450);
      }
    }
    async function resolveOnboardInvoice(sale){
      if(!sale||!Gfp) return null;
      const readyId=sale.invoiceId||sale.InvoiceId||null;
      const readyNum=sale.invoiceNumber||sale.InvoiceNumber||null;
      if(readyId) return { invoiceId:readyId, invoiceNumber:readyNum };
      const saleId=sale.saleId||sale.id||sale.SaleId;
      if(!saleId) return null;
      for(let i=0;i<8;i++){
        const r=await Gfp.get('/sales/'+encodeURIComponent(saleId)+'/invoice');
        if(r.ok&&r.data&&(r.data.invoiceId||r.data.InvoiceId)){
          return {
            invoiceId: r.data.invoiceId||r.data.InvoiceId,
            invoiceNumber: r.data.invoiceNumber||r.data.InvoiceNumber||null
          };
        }
        await new Promise(function(resolve){ setTimeout(resolve, 500); });
      }
      return null;
    }
    async function prepareOnboardPrintStep(result){
      onboardSale=result&&result.sale?result.sale:null;
      onboardInvoiceId=null;
      onboardInvoiceNumber=null;
      const invStatus=document.getElementById('onboardInvoiceStatus');
      const btnInv=document.getElementById('btnOnboardPrintInvoice');
      const btnCard=document.getElementById('btnOnboardPrintCard');
      const cardStatus=document.getElementById('onboardCardStatus');
      const btnRf=document.getElementById('btnOnboardRefund');
      function showOnboardRefund(){
        const RA=window.GfpRefundAction;
        const saleId=onboardSale&&(onboardSale.saleId||onboardSale.id||onboardSale.SaleId);
        const show=!!(saleId && RA && RA.isEnabled() && RA.canRequest());
        if(!btnRf) return;
        btnRf.hidden=!show;
        if(!show) return;
        btnRf.onclick=function(){
          RA.open({
            saleId: saleId,
            saleTotal: onboardSale.totals && onboardSale.totals.total,
            paid: onboardSale.totals && onboardSale.totals.paid,
            memberName: createdMember && createdMember.fullName,
            lines: selectedPlan ? [{ description: selectedPlan.name, lineTotal: selectedPlan.price }] : []
          });
        };
      }

      if(btnCard&&createdMember&&createdMember.id){
        btnCard.disabled=false;
        if(cardStatus) cardStatus.textContent='Ready — print the member barcode card.';
      } else if(btnCard){
        btnCard.disabled=true;
        if(cardStatus) cardStatus.textContent='Member id missing — card unavailable.';
      }

      if(!onboardSale){
        if(invStatus) invStatus.textContent='No sale invoice (membership assigned without POS sale).';
        if(btnInv) btnInv.disabled=true;
        showOnboardRefund();
        return;
      }
      const skipped=onboardSale.invoiceStatus==='skipped'||onboardSale.invoiceStatus==='not_applicable';
      if(skipped){
        if(invStatus) invStatus.textContent='No invoice for this sale.';
        if(btnInv) btnInv.disabled=true;
        showOnboardRefund();
        return;
      }
      if(invStatus) invStatus.textContent='Preparing invoice…';
      if(btnInv) btnInv.disabled=true;
      const inv=await resolveOnboardInvoice(onboardSale);
      if(inv&&inv.invoiceId){
        onboardInvoiceId=inv.invoiceId;
        onboardInvoiceNumber=inv.invoiceNumber;
        if(invStatus){
          invStatus.textContent=onboardInvoiceNumber
            ?('Invoice '+onboardInvoiceNumber+' ready to print')
            :'Invoice ready to print';
        }
        if(btnInv) btnInv.disabled=false;
      } else {
        if(invStatus) invStatus.textContent='Invoice not ready yet — try Print again in a moment.';
        if(btnInv) btnInv.disabled=false; // allow retry via click handler re-resolve
      }
      showOnboardRefund();
    }

    function addDaysIso(iso, days){
      const d=new Date(iso+'T00:00:00');
      d.setDate(d.getDate()+days);
      return d.toISOString().slice(0,10);
    }
    function fmtObDate(iso){
      if(!iso) return '—';
      return new Date(iso+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    }

    async function loadOnboardPlans(){
      const host=overlay.querySelector('#onboardPlanCards');
      const loading=overlay.querySelector('#onboardPlanLoading');
      if(loading) loading.style.display='block';
      if(host) host.innerHTML='';
      try{
        if(!Gfp) throw new Error('API missing');
        const r=await Gfp.get('/membership-plans');
        if(!r.ok) throw new Error(apiMsg(r,'Failed to load plans'));
        onboardPlans=(Array.isArray(r.data)?r.data:[]).filter(function(p){
          return p&&p.isActive!==false&&String(p.planType||'').toLowerCase()!=='trial';
        });
        if(!onboardPlans.length){
          if(host) host.innerHTML='<div class="mdl-error-banner show"><i class="ti ti-alert-circle"></i><div class="error-text">No active membership plans</div></div>';
        } else if(host){
          host.innerHTML=onboardPlans.map(function(p){
            return '<button type="button" class="plan-card" data-plan-id="'+p.id+'" style="text-align:left;width:100%;border:1px solid var(--ls3);background:var(--ls1);border-radius:var(--rmd);padding:12px;cursor:pointer">'
              +'<div style="display:flex;justify-content:space-between;gap:8px"><strong>'+(p.name||'')+'</strong><span>EGP '+(p.price||0).toLocaleString()+'</span></div>'
              +'<div style="font-size:12px;color:var(--ltt);margin-top:4px">'+(p.durationDays||0)+' days'
              +(p.sessionCount?' · '+p.sessionCount+' sessions':'')+'</div></button>';
          }).join('');
          host.querySelectorAll('[data-plan-id]').forEach(function(btn){
            btn.addEventListener('click',function(){
              host.querySelectorAll('[data-plan-id]').forEach(function(b){ b.style.borderColor='var(--ls3)'; b.style.boxShadow='none'; });
              btn.style.borderColor='var(--l500)';
              btn.style.boxShadow='0 0 0 1px var(--l500)';
              selectedPlan=onboardPlans.find(function(p){ return p.id===btn.getAttribute('data-plan-id'); })||null;
              if(btnCreate) btnCreate.disabled=!selectedPlan;
            });
          });
        }
      }catch(e){
        if(host) host.innerHTML='<div class="mdl-error-banner show"><i class="ti ti-alert-circle"></i><div class="error-text">'+(e.message||'Cannot load plans (plans.manage may be required)')+'</div></div>';
      }
      if(loading) loading.style.display='none';
    }

    function renderOnboardSummary(){
      const box=overlay.querySelector('#onboardSummary');
      const startEl=overlay.querySelector('#onboardStartDate');
      const amtEl=overlay.querySelector('#onboardAmountPaid');
      if(!box||!selectedPlan||!createdMember) return;
      const start=(startEl&&startEl.value)||new Date().toISOString().slice(0,10);
      const end=addDaysIso(start, Number(selectedPlan.durationDays)||0);
      box.innerHTML=
        '<div class="plan-detail-row"><span class="plan-detail-label">Member</span><span class="plan-detail-val">'+(createdMember.fullName||'')+'</span></div>'+
        '<div class="plan-detail-row"><span class="plan-detail-label">Plan</span><span class="plan-detail-val">'+(selectedPlan.name||'')+'</span></div>'+
        '<div class="plan-detail-row"><span class="plan-detail-label">Start</span><span class="plan-detail-val">'+fmtObDate(start)+'</span></div>'+
        '<div class="plan-detail-row"><span class="plan-detail-label">End</span><span class="plan-detail-val">'+fmtObDate(end)+'</span></div>'+
        '<div class="plan-detail-row"><span class="plan-detail-label">Price</span><span class="plan-price"><span class="currency">EGP</span> '+(selectedPlan.price||0).toLocaleString()+'</span></div>';
      if(amtEl && (amtEl.value===''||amtEl.value==null)) amtEl.value=String(selectedPlan.price||0);
    }

    async function completeOnboardPayment(){
      if(!createdMember||!selectedPlan||!Gfp) return false;
      const pay=(overlay.querySelector('input[name="onboardPayment"]:checked')||{}).value||'cash';
      const amount=Number((overlay.querySelector('#onboardAmountPaid')||{}).value)||0;
      const canSell=Authz?Authz.useCan('sales.sell'):false;
      const canMgr=Authz?Authz.useCanRole('ManagerOrAbove'):false;

      if(canSell){
        const map={ cash:'cash', paymob:'card_paymob', fawry:'fawry', vodafone_cash:'vodafone' };
        const method=map[pay]||'cash';
        const body={
          planId: selectedPlan.id,
          memberId: createdMember.id,
          payments:[{ method: method, amount: amount }]
        };
        if(method==='cash'&&amount>0){
          const sh=await Gfp.get('/shifts/current');
          if(!sh.ok||!sh.data||!sh.data.id){
            showAddError('Open a shift before accepting cash payment.');
            return false;
          }
        }
        const key=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():('ob-'+Date.now());
        const r=await Gfp.post('/sales', body, { headers: { 'X-Idempotency-Key': key } });
        if(!r.ok){ showAddError(apiMsg(r,'Sale failed')); return false; }
        return { sale:r.data, payMethod:pay, amount:amount };
      }
      if(canMgr){
        const r=await Gfp.post('/memberships/'+createdMember.id+'/assign',{
          planId: selectedPlan.id,
          paymentMethod: pay==='vodafone_cash'?'fawry':pay,
          amountPaid: pay==='cash'?amount:undefined
        });
        if(!(r.ok||r.status===201)){ showAddError(apiMsg(r,'Assign failed')); return false; }
        return { membership:r.data, payMethod:pay, amount:amount };
      }
      showAddError('Missing sales.sell or manager permission to complete membership payment');
      return false;
    }

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
      if(btnCreate && onboardStep===1) btnCreate.disabled=!valid;
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

    // Multi-step Continue / Complete
    if(btnCreate){
      btnCreate.addEventListener('click',async function(){
        errorBanner&&errorBanner.classList.remove('show');
        btnCreate.classList.add('loading');
        btnCreate.disabled=true;
        try{
          if(onboardStep===1){
            if(!validateAddForm()) return;
            if(!canCreate()){ showAddError('Missing members.create permission'); return; }
            if(!Gfp){ showAddError('API client missing'); return; }
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
            const r=await Gfp.post('/members', body);
            if(!r.ok){ showAddError(apiMsg(r,'Failed to create member')); return; }
            createdMember=r.data||{};
            if(!createdMember.id&&r.data) createdMember=r.data;
            // Some APIs return only id string / nested member / PascalCase Id
            if(!createdMember.id&&createdMember.Id) createdMember.id=createdMember.Id;
            if(!createdMember.id&&typeof r.data==='string') createdMember={ id:r.data, fullName:body.fullName };
            if(!createdMember.fullName) createdMember.fullName=body.fullName||createdMember.FullName;
            toast('Member created — select a membership');
            const startEl=overlay.querySelector('#onboardStartDate');
            if(startEl&&!startEl.value) startEl.value=new Date().toISOString().slice(0,10);
            setOnboardStep(2);
            await loadOnboardPlans();
            if(typeof window.loadMembers==='function') window.loadMembers();
            if(typeof window.loadStats==='function') window.loadStats();
          } else if(onboardStep===2){
            if(!selectedPlan){ showAddError('Select a membership plan'); return; }
            renderOnboardSummary();
            setOnboardStep(3);
          } else if(onboardStep===3){
            const result=await completeOnboardPayment();
            if(!result) return;
            const startEl=overlay.querySelector('#onboardStartDate');
            const start=(startEl&&startEl.value)||new Date().toISOString().slice(0,10);
            const end=addDaysIso(start, Number(selectedPlan.durationDays)||0);
            const conf=overlay.querySelector('#onboardConfirmText');
            if(conf){
              conf.innerHTML=
                '<div><strong>'+(createdMember.fullName||'')+'</strong></div>'+
                '<div>'+(selectedPlan.name||'')+'</div>'+
                '<div>'+fmtObDate(start)+' → '+fmtObDate(end)+'</div>'+
                '<div>Paid: EGP '+(result.amount||0).toLocaleString()+' ('+result.payMethod+')</div>';
            }
            const view=overlay.querySelector('#btnOnboardViewMember');
            if(view&&createdMember.id) view.href='/dashboard/members/'+encodeURIComponent(createdMember.id)+'/';
            setOnboardStep(4);
            toast('Onboarding complete — print invoice & card');
            await prepareOnboardPrintStep(result);
            if(typeof window.loadMembers==='function') window.loadMembers();
          }
        }catch(e){
          showAddError('Network error — please try again');
        } finally {
          btnCreate.classList.remove('loading');
          if(onboardStep===1) validateAddForm();
          else if(onboardStep===2) btnCreate.disabled=!selectedPlan;
          else if(onboardStep===3) btnCreate.disabled=false;
        }
      });
    }

    const btnSkip=overlay.querySelector('#btnOnboardSkip');
    if(btnSkip){
      btnSkip.addEventListener('click',function(){
        closeOverlay('addMemberModal');
        resetAddForm();
        toast('Member created without membership');
        if(typeof window.loadMembers==='function') window.loadMembers();
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

    const btnPrintInvoice=document.getElementById('btnOnboardPrintInvoice');
    if(btnPrintInvoice){
      btnPrintInvoice.addEventListener('click',async function(){
        if(!onboardInvoiceId&&onboardSale){
          const inv=await resolveOnboardInvoice(onboardSale);
          if(inv&&inv.invoiceId){
            onboardInvoiceId=inv.invoiceId;
            onboardInvoiceNumber=inv.invoiceNumber;
          }
        }
        if(!onboardInvoiceId){
          toast('Invoice not ready yet','error');
          return;
        }
        await openOnboardPrintHtml(
          onboardInvoiceNumber?('Invoice '+onboardInvoiceNumber):'Invoice',
          '/invoices/'+encodeURIComponent(onboardInvoiceId)+'/receipt-html',
          true
        );
      });
    }
    const btnPrintCard=document.getElementById('btnOnboardPrintCard');
    if(btnPrintCard){
      btnPrintCard.addEventListener('click',async function(){
        if(!createdMember||!createdMember.id){
          toast('Member id missing','error');
          return;
        }
        await openOnboardPrintHtml(
          'Member card',
          '/members/'+encodeURIComponent(createdMember.id)+'/access-card-html',
          true
        );
      });
    }
    const btnPrintDo=document.getElementById('btnOnboardPrintDo');
    if(btnPrintDo){
      btnPrintDo.addEventListener('click',function(){
        const frame=document.getElementById('onboardPrintFrame');
        try{ if(frame&&frame.contentWindow){ frame.contentWindow.focus(); frame.contentWindow.print(); } }
        catch(e){ toast('Allow pop-ups / try Print again','error'); }
      });
    }
    const btnPrintClose=document.getElementById('btnOnboardPrintClose');
    if(btnPrintClose) btnPrintClose.addEventListener('click',closeOnboardPrint);
    const printOv=document.getElementById('onboardPrintOverlay');
    if(printOv){
      printOv.addEventListener('click',function(e){ if(e.target===printOv) closeOnboardPrint(); });
    }

    function resetAddForm(){
      createdMember=null; selectedPlan=null; onboardPlans=[];
      onboardSale=null; onboardInvoiceId=null; onboardInvoiceNumber=null;
      closeOnboardPrint();
      const invStatus=document.getElementById('onboardInvoiceStatus');
      const cardStatus=document.getElementById('onboardCardStatus');
      const btnInv=document.getElementById('btnOnboardPrintInvoice');
      const btnCard=document.getElementById('btnOnboardPrintCard');
      if(invStatus) invStatus.textContent='Preparing invoice…';
      if(cardStatus) cardStatus.textContent='Member access card with barcode.';
      if(btnInv) btnInv.disabled=true;
      if(btnCard) btnCard.disabled=true;
      setOnboardStep(1);
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

  window.openAssignModal=async function(memberId){
    if(!memberId){ toast('Member id required','error'); return; }
    const canMgr=Authz?Authz.useCanRole('ManagerOrAbove'):false;
    if(!canMgr){ toast('Manager or above required to assign','error'); return; }
    assignMemberId=memberId;
    const overlay=assignModalEl();
    if(!overlay){ toast('Assign modal missing','error'); return; }
    overlay.classList.add('open');
    const err=overlay.querySelector('#assignErrorBanner');
    if(err) err.classList.remove('show');
    const sel=overlay.querySelector('#assignPlanSelect');
    if(sel) sel.value='';
    const detail=overlay.querySelector('#planDetailCard');
    if(detail) detail.classList.remove('show');
    overlay.querySelectorAll('input[name="assignPayment"]').forEach(function(r){ r.checked=false; });
    const amtWrap=overlay.querySelector('#assignAmountWrap');
    if(amtWrap) amtWrap.hidden=true;
    const amt=overlay.querySelector('#assignAmountPaid');
    if(amt) amt.value='';
    const dueHint=overlay.querySelector('#assignDueHint');
    if(dueHint){ dueHint.textContent=''; dueHint.classList.remove('has-due'); }
    const payNote=overlay.querySelector('#assignPaymentNote');
    if(payNote) payNote.classList.remove('show');
    const btn=overlay.querySelector('#btnAssignMembership');
    if(btn) btn.disabled=true;
    await loadPlans();
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
        (plansCache||[]).filter(p=>p&&p.isActive!==false&&String(p.planType||'').toLowerCase()!=='trial').forEach(p=>{
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

    function selectedPlanPrice(){
      if(!select||!select.value) return 0;
      try{
        const p=JSON.parse(select.options[select.selectedIndex].dataset.plan||'{}');
        return Number(p.price)||0;
      }catch(e){ return 0; }
    }
    function selectedPayMethod(){
      const el=overlay.querySelector('input[name="assignPayment"]:checked');
      return el?el.value:'';
    }
    function updateAssignDueHint(){
      const wrap=overlay.querySelector('#assignAmountWrap');
      const amtEl=overlay.querySelector('#assignAmountPaid');
      const hint=overlay.querySelector('#assignDueHint');
      const isCash=selectedPayMethod()==='cash';
      if(wrap) wrap.hidden=!isCash;
      if(!hint||!amtEl) return;
      if(!isCash){
        hint.textContent='';
        hint.classList.remove('has-due');
        return;
      }
      const price=selectedPlanPrice();
      if(amtEl.value===''&&price>0) amtEl.value=String(price);
      const paid=parseFloat(amtEl.value);
      const cash=Number.isFinite(paid)?paid:0;
      const due=Math.max(0, price-cash);
      if(due>0.004){
        hint.textContent='EGP '+due.toLocaleString()+' stays outstanding — Collect Payment on this member.';
        hint.classList.add('has-due');
      } else {
        hint.textContent='Leave as the plan price to pay in full. Pay less if they cannot pay everything now.';
        hint.classList.remove('has-due');
      }
    }

    // Plan selection
    if(select){
      select.addEventListener('change',function(){
        if(!this.value){detail&&detail.classList.remove('show');validateAssignForm();updateAssignDueHint();return;}
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
          const amtEl=overlay.querySelector('#assignAmountPaid');
          if(amtEl) amtEl.value=String(p.price||0);
        }catch(e){}
        validateAssignForm();
        updateAssignDueHint();
      });
    }

    // Payment radios
    overlay.querySelectorAll('input[name="assignPayment"]').forEach(radio=>{
      radio.addEventListener('change',function(){
        if(paymentNote){
          if(this.value==='cash'){
            paymentNote.innerHTML='<i class="ti ti-info-circle"></i> Cash activates the membership now. Pay less than the plan price and the rest stays Outstanding.';
            paymentNote.className='payment-note show';
          } else {
            paymentNote.innerHTML='<i class="ti ti-alert-triangle"></i> Membership will be created as "pending" and activated automatically when payment is confirmed via webhook.';
            paymentNote.className='payment-note warning show';
          }
        }
        validateAssignForm();
        updateAssignDueHint();
      });
    });
    const amtInput=overlay.querySelector('#assignAmountPaid');
    if(amtInput) amtInput.addEventListener('input',updateAssignDueHint);

    function validateAssignForm(){
      const planOk=select&&select.value;
      const payOk=overlay.querySelector('input[name="assignPayment"]:checked');
      if(btnAssign) btnAssign.disabled=!(planOk&&payOk);
      return !!(planOk&&payOk);
    }

    // Submit — POST /memberships/{id}/assign (ManagerOrAbove)
    if(btnAssign){
      btnAssign.addEventListener('click',async function(){
        if(!assignMemberId||!validateAssignForm()) return;
        btnAssign.classList.add('loading');
        btnAssign.disabled=true;
        errorBanner&&errorBanner.classList.remove('show');

        const payMethod=overlay.querySelector('input[name="assignPayment"]:checked').value;
        const amtEl=overlay.querySelector('#assignAmountPaid');
        const amountPaid=payMethod==='cash'?(parseFloat(amtEl&&amtEl.value)||0):undefined;
        const body={planId:select.value,paymentMethod:payMethod};
        if(amountPaid!=null) body.amountPaid=amountPaid;
        const refEl=overlay.querySelector('#assignReferralCode');
        if(refEl&&refEl.value.trim()) body.referralCode=refEl.value.trim().toUpperCase();

        try{
          if(payMethod==='cash'&&amountPaid>0&&Gfp){
            const sh=await Gfp.get('/shifts/current');
            if(!sh.ok||!sh.data||!sh.data.id){
              if(errorBanner){
                const te=errorBanner.querySelector('.error-text');
                if(te) te.textContent='Open a shift before accepting cash.';
                errorBanner.classList.add('show');
              }
              btnAssign.classList.remove('loading');
              validateAssignForm();
              return;
            }
          }
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
            const price=selectedPlanPrice();
            const due=payMethod==='cash'?Math.max(0,price-(amountPaid||0)):0;
            toast(
              payMethod==='cash'
                ?(due>0.004
                  ?'Assigned. EGP '+due.toLocaleString()+' outstanding — Collect Payment on this member.'
                  :'Membership assigned & activated!')
                :'Assigned — waiting for payment. Refresh the membership panel (no live push).',
              pending?'error':'success'
            );
            closeOverlay(overlay.id);
            if(typeof window.loadMember==='function') window.loadMember();
            if(typeof window.loadMembers==='function') window.loadMembers();
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
  function openAddMemberModal(){
    if(!canCreate()){ toast('Missing members.create permission','error'); return; }
    const m=document.getElementById('addMemberModal');
    if(m) m.classList.add('open');
  }
  if(btnAdd){
    btnAdd.addEventListener('click',openAddMemberModal);
  }
  try{
    var params=new URLSearchParams(location.search);
    if(params.get('action')==='new' && btnAdd){
      openAddMemberModal();
      params.delete('action');
      var qs=params.toString();
      history.replaceState({},'',location.pathname+(qs?'?'+qs:'')+location.hash);
    }
  }catch(e){ /* ignore */ }

  // ── Init all components ──
  initAddMemberModal();
  initEditDrawer();
  initAssignModal();

})();
