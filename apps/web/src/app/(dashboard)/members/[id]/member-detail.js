// ═══════════════════════════════════════════════════════════════
//  Member Detail Page — /members/[id]/
//  API: GET /api/members/{id} → MemberDetailDto
// ═══════════════════════════════════════════════════════════════
(function(){
  const API_BASE = window.API_BASE || 'https://reach-lullaby-tighten.ngrok-free.dev/api';

  function t(en, ar){
    if(window.GfpI18n && typeof window.GfpI18n.tLabel === 'function'){
      return window.GfpI18n.tLabel(en, ar);
    }
    try{
      const loc = localStorage.getItem('gfp_locale') || 'en';
      return loc === 'ar' ? ar : en;
    }catch(e){ return en; }
  }
  function applyLocaleBits(root){
    if(window.GfpI18n && window.GfpI18n.applyDocumentLocale){
      window.GfpI18n.applyDocumentLocale();
      return;
    }
    const loc = (function(){ try{ return localStorage.getItem('gfp_locale')||'en'; }catch(e){ return 'en'; } })();
    (root || document).querySelectorAll('[data-en]').forEach(function(el){
      el.textContent = loc === 'ar' ? (el.getAttribute('data-ar') || el.getAttribute('data-en')) : el.getAttribute('data-en');
    });
  }

  function getAuthHeaders(){
    const t=localStorage.getItem('gfp_access_token')||sessionStorage.getItem('gfp_access_token');
    const h={'Content-Type':'application/json'};
    if(t) h['Authorization']='Bearer '+t;
    return h;
  }
  function getUser(){
    try{return JSON.parse(localStorage.getItem('gfp_user')||sessionStorage.getItem('gfp_user'));}
    catch(e){return null;}
  }

  // ── Sidebar user ──
  const user=getUser();
  if(!user){window.location.href='/auth/login/';return;}
  const Gfp=window.GfpApi;
  const Authz=window.GfpAuthz;
  const canView=Authz?Authz.useCan('members.view'):true;
  const canEdit=Authz?Authz.useCan('members.edit'):false;
  const canFreeze=Authz?Authz.useCan('memberships.freeze'):false;
  const isOwner=Authz?Authz.useCanRole('OwnerOnly'):(user.role==='Owner'||user.role==='owner');
  if(!canView){window.location.href='/dashboard/';return;}
  const ini=(user.fullName||'U').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('userAvatar').textContent=ini;
  document.getElementById('userName').textContent=user.fullName||'User';
  document.getElementById('userRole').textContent=user.role||'Staff';
  if(isOwner){const ns=document.getElementById('navStaff');if(ns) ns.style.display='flex';}
  document.getElementById('btnLogout').addEventListener('click',function(){
    if(Gfp) Gfp.logout();
    else {
      ['gfp_access_token','gfp_refresh_token','gfp_user','gfp_expires_at'].forEach(k=>{localStorage.removeItem(k);sessionStorage.removeItem(k);});
      window.location.href='/auth/login/';
    }
  });
  document.getElementById('mobToggle').addEventListener('click',function(){
    document.getElementById('sidebar').classList.toggle('open');
  });

  function apiErr(r){
    if(window.GfpI18n&&window.GfpI18n.displayApiError) return window.GfpI18n.displayApiError(r)||'Request failed';
    return (r&&r.error&&r.error.message)||'Request failed';
  }

  // ── Get member ID from URL ──
  // URL pattern: /members/[id]/  or  ?id=xxx
  function getMemberId(){
    const parts=window.location.pathname.split('/').filter(Boolean);
    const mi=parts.indexOf('members');
    if(mi>=0 && parts[mi+1] && parts[mi+1]!=='[id]') return parts[mi+1];
    const params=new URLSearchParams(window.location.search);
    return params.get('id') || 'DEMO';
  }
  const memberId=getMemberId();

  // ── Helpers ──
  function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function fmtDate(d){if(!d) return '—';return new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});}
  function fmtTime(d){if(!d) return '—';const dt=new Date(d);return dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}
  function calcAge(dob){if(!dob) return '';const d=new Date(dob),now=new Date();let a=now.getFullYear()-d.getFullYear();if(now<new Date(now.getFullYear(),d.getMonth(),d.getDate())) a--;return a;}
  function daysRemaining(end){if(!end) return 0;return Math.max(0,Math.ceil((new Date(end)-new Date())/(1000*60*60*24)));}
  function totalDays(start,end){if(!start||!end) return 30;return Math.max(1,Math.ceil((new Date(end)-new Date(start))/(1000*60*60*24)));}
  function toast(msg,type='success'){
    const t=document.getElementById('toast');
    t.className='toast '+type;
    t.innerHTML=`<i class="ti ti-${type==='success'?'circle-check':'circle-x'}"></i>${msg}`;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),3000);
  }
  function fmtEGP(v){return 'EGP '+(v||0).toLocaleString();}
  function calcDuration(cin,cout){
    if(!cin||!cout) return '—';
    const m=Math.round((new Date(cout)-new Date(cin))/60000);
    return m>=60?Math.floor(m/60)+'h '+(m%60)+'m':m+'m';
  }

  // ── Modal helpers ──
  function openModal(id){document.getElementById(id).classList.add('open');}
  function closeModal(id){document.getElementById(id).classList.remove('open');}
  document.querySelectorAll('.modal-overlay').forEach(o=>{
    o.addEventListener('click',function(e){if(e.target===this) this.classList.remove('open');});
  });
  document.querySelectorAll('.modal-close').forEach(b=>{
    b.addEventListener('click',function(){this.closest('.modal-overlay').classList.remove('open');});
  });

  // ── Tab switching ──
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',function(){
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('act'));
      document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('act'));
      this.classList.add('act');
      document.getElementById(this.dataset.tab).classList.add('act');
      // Lazy load attendance/history on first open
      if(this.dataset.tab==='tabAtt' && !window._attLoaded){loadAttendance();window._attLoaded=true;}
      if(this.dataset.tab==='tabOrders' && !window._ordersLoaded){loadMemberOrders();window._ordersLoaded=true;}
      if(this.dataset.tab==='tabHist' && !window._histLoaded){loadHistory();window._histLoaded=true;}
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Load Member Detail — GET /api/members/{id}
  //  currentMembership: null is valid; recentAttendance = last 5
  // ═══════════════════════════════════════════════════════════════
  let memberData=null;

  function showMemberLoadError(msg){
    const host=document.querySelector('.content')||document.querySelector('.main');
    if(!host) return;
    host.innerHTML='<div class="no-data" style="padding:48px;text-align:center"><i class="ti ti-user-off" style="font-size:40px;display:block;margin-bottom:12px"></i><p style="margin-bottom:16px">'+msg+'</p><a href="/dashboard/members/">Back to list</a></div>';
  }

  async function loadMember(){
    if(memberId==='DEMO'||memberId==='[id]'){
      showMemberLoadError('Invalid member id');
      return;
    }
    if(!Gfp){
      toast('API client missing — hard-refresh','error');
      return;
    }
    try{
      const r=await Gfp.get('/members/'+memberId);
      if(r.status===401){window.location.href='/auth/login/';return;}
      if(r.status===404){
        showMemberLoadError('Member not found');
        return;
      }
      if(!r.ok){
        toast(apiErr(r),'error');
        document.getElementById('skeletonProfile').style.display='none';
        document.getElementById('skeletonTabs').innerHTML='<div class="no-data"><i class="ti ti-alert-circle"></i><p>'+apiErr(r)+'</p></div>';
        document.getElementById('skeletonTabs').style.display='';
        return;
      }
      renderMember(r.data);
    }catch(e){
      toast('Unable to load member','error');
    }
  }

  function renderMember(m){
    memberData=m;
    document.getElementById('breadcrumbName').textContent=m.fullName;
    document.title='GymFlowPro — '+m.fullName;

    document.getElementById('profileAv').textContent=(m.fullName||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    if(m.profilePhotoUrl){
      document.getElementById('profileAv').innerHTML=`<img src="${m.profilePhotoUrl}" alt="${m.fullName}">`;
    }
    document.getElementById('profileMemberNum').textContent='#'+m.memberNumber;
    renderAccessBarcode(m.memberNumber);
    document.getElementById('profileNameEn').textContent=m.fullName;
    document.getElementById('profileNameAr').textContent=m.fullNameAr||'';
    document.getElementById('profilePhone').href='tel:'+m.phone;
    document.getElementById('profilePhone').textContent=m.phone;
    document.getElementById('profileEmail').textContent=m.email||'—';
    if(m.email) document.getElementById('profileEmail').href='mailto:'+m.email;
    const age=calcAge(m.dateOfBirth);
    document.getElementById('profileDob').textContent=m.dateOfBirth?fmtDate(m.dateOfBirth)+' ('+age+' yrs)':'—';
    document.getElementById('profileJoin').textContent=fmtDate(m.createdAtUtc);
    document.getElementById('profileQuota').textContent=m.invitationQuotaRemaining||0;
    const toggle=document.getElementById('statusToggle');
    toggle.checked=!!m.isActive;
    document.getElementById('statusLabel').textContent=m.isActive?'Active':'Archived';
    document.getElementById('statusLabel').style.color=m.isActive?'var(--suc500)':'var(--dng500)';
    document.getElementById('profileStatusDot').className='status-dot '+(m.isActive?'active':'inactive');

    // Deactivate — OwnerOnly role policy (not members.*). Managers must not attempt DELETE.
    const btnDeact=document.getElementById('btnDeactivate');
    const statusWrap=toggle.closest('.status-toggle')||toggle.parentElement;
    if(!isOwner){
      if(btnDeact) btnDeact.style.display='none';
      if(statusWrap) statusWrap.style.display='none';
      toggle.disabled=true;
    } else {
      if(btnDeact) btnDeact.style.display='';
      if(statusWrap) statusWrap.style.display='';
      toggle.disabled=false;
      // Account flag ≠ membership status — label the action correctly.
      if(m.isActive){
        btnDeact.innerHTML='<i class="ti ti-user-off"></i> Deactivate';
        btnDeact.classList.add('danger');
        btnDeact.classList.remove('primary');
      } else {
        btnDeact.innerHTML='<i class="ti ti-user-check"></i> Activate account';
        btnDeact.classList.remove('danger');
        btnDeact.classList.add('primary');
      }
    }

    // Account archived banner when IsActive=false (P12-R1 Keep Own wording)
    let accountBanner=document.getElementById('accountInactiveBanner');
    if(!accountBanner){
      accountBanner=document.createElement('div');
      accountBanner.id='accountInactiveBanner';
      const profileContent=document.getElementById('profileContent')||document.getElementById('profileCard');
      if(profileContent) profileContent.insertBefore(accountBanner, profileContent.firstChild);
    }
    const msSt=String((m.currentMembership&&m.currentMembership.status)||'').toLowerCase();
    const hasUsablePlan=['active','scheduled','frozen','pending'].includes(msSt);
    if(!m.isActive){
      accountBanner.style.display='block';
      accountBanner.className='info-banner';
      accountBanner.style.cssText='margin:0 0 12px;padding:12px;border-radius:8px;background:#FEE2E2;color:var(--dng500);font-size:12px';
      accountBanner.innerHTML=hasUsablePlan
        ?'<i class="ti ti-alert-circle"></i> <strong>Account archived</strong> — person account is inactive. Reactivate the account to restore desk use. Membership plans are unchanged by archive.'
        :'<i class="ti ti-alert-circle"></i> <strong>Account archived</strong> — person account is inactive. Reactivate the account when this person should be active again.';
    } else {
      accountBanner.style.display='none';
      accountBanner.innerHTML='';
    }

    // Edit — members.edit
    ['btnEdit','btnEdit2'].forEach(function(id){
      const el=document.getElementById(id);
      if(el) el.style.display=canEdit?'':'none';
    });

    // currentMembership on member detail may be active-only; §4 current endpoint
    // returns frozen / pending / last expired — reconcile for the panel.
    renderMembership(m.currentMembership||null);
    renderRecentAttendance(Array.isArray(m.recentAttendance)?m.recentAttendance:[]);
    renderMemberApp(m);
    reconcileCurrentMembership();

    document.getElementById('skeletonProfile').style.display='none';
    document.getElementById('skeletonTabs').style.display='none';
    document.getElementById('profileContent').style.display='';
    document.getElementById('tabsContent').style.display='';
    applyLocaleBits(document.getElementById('memberAppCard'));
  }

  // ═══════════════════════════════════════════════════════════════
  //  Access barcode + reprint card
  //  GET /api/members/{id}/access-card-html  (members.view)
  //  Barcode value = MemberNumber (desk barcode-checkin)
  // ═══════════════════════════════════════════════════════════════
  function renderAccessBarcode(memberNumber){
    const svg=document.getElementById('accessBarcodeSvg');
    const numEl=document.getElementById('accessBarcodeNum');
    const code=String(memberNumber||'').trim();
    if(numEl) numEl.textContent=code?('#'+code):'—';
    if(!svg) return;
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    if(!code){
      svg.setAttribute('width','0');
      svg.setAttribute('height','0');
      return;
    }
    if(typeof JsBarcode!=='function'){
      const t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x','10'); t.setAttribute('y','28');
      t.setAttribute('font-size','12'); t.textContent=code;
      svg.appendChild(t);
      return;
    }
    try{
      JsBarcode(svg, code, {
        format:'CODE128',
        displayValue:false,
        margin:8,
        height:48,
        width:2,
        background:'#ffffff',
        lineColor:'#0D0D0D'
      });
    }catch(e){
      if(numEl) numEl.textContent=code+' (barcode unavailable)';
    }
  }

  function closeAccessPrint(){
    const ov=document.getElementById('accessPrintOverlay');
    if(ov) ov.hidden=true;
    const frame=document.getElementById('accessPrintFrame');
    if(frame) frame.srcdoc='';
  }

  function accessApiBase(){
    if(window.GfpApi && typeof window.GfpApi.apiBase==='function'){
      return String(window.GfpApi.apiBase()).replace(/\/$/,'');
    }
    return String(window.API_BASE || API_BASE || 'https://localhost:5001/api').replace(/\/$/,'');
  }

  async function fetchAccessCardHtml(){
    if(!memberId) return { ok:false, status:0, text:'', error:'Missing member id' };
    const path='/members/'+encodeURIComponent(memberId)+'/access-card-html';
    const url=accessApiBase()+path;
    const headers={};
    const token=localStorage.getItem('gfp_access_token')||sessionStorage.getItem('gfp_access_token');
    if(token) headers['Authorization']='Bearer '+token;
    // ngrok free interstitial otherwise can hang / return HTML warning page
    headers['ngrok-skip-browser-warning']='true';
    headers['Accept']='text/html';

    const ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=ctrl?setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, 15000):null;
    try{
      const res=await fetch(url,{ method:'GET', headers:headers, signal:ctrl?ctrl.signal:undefined });
      if(timer) clearTimeout(timer);
      if(res.status===401){ window.location.href='/auth/login/'; return { ok:false, status:401, text:'' }; }
      const text=await res.text();
      return { ok:res.ok, status:res.status, text:text, url:url };
    }catch(e){
      if(timer) clearTimeout(timer);
      const aborted=e && (e.name==='AbortError' || String(e.message||'').indexOf('abort')>=0);
      return {
        ok:false,
        status:0,
        text:'',
        url:url,
        error: aborted
          ? t('Request timed out — check API / ngrok','انتهت المهلة — تأكد من الـ API / ngrok')
          : t('Network error — check API / ngrok tunnel','خطأ شبكة — تأكد من الـ API / ngrok')
      };
    }
  }

  async function openAccessCardPrint(autoPrint){
    const overlay=document.getElementById('accessPrintOverlay');
    const frame=document.getElementById('accessPrintFrame');
    const titleEl=document.getElementById('accessPrintTitle');
    if(!overlay||!frame){ toast(t('Print view not available','عرض الطباعة غير متاح'),'error'); return; }
    if(titleEl){
      titleEl.setAttribute('data-en','Barcode card');
      titleEl.setAttribute('data-ar','كارنيه الباركود');
      titleEl.textContent=t('Barcode card','كارنيه الباركود');
    }
    overlay.hidden=false;
    frame.srcdoc='<p style="padding:16px;font-family:sans-serif;color:#666">'+t('Loading card…','جاري تحميل الكارنيه…')+'</p>';
    let res;
    try{
      res=await fetchAccessCardHtml();
    }catch(e){
      res={ ok:false, status:0, error:String(e&&e.message||e) };
    }
    if(!res || !res.ok){
      let msg=res && res.error
        ? res.error
        : t('Could not load barcode card','تعذر تحميل كارنيه الباركود');
      if(res && res.status===404){
        msg=t(
          'Card endpoint missing (404). Restart the API after Access Cards deploy.',
          'مسار الكارنيه مش موجود (404). أعد تشغيل الـ API.'
        );
      } else if(res && res.status){
        msg+=' (HTTP '+res.status+')';
      }
      toast(msg,'error');
      frame.srcdoc='<p style="padding:16px;font-family:sans-serif;color:#991b1b">'+msg+
        (res&&res.url?'<br><small style="color:#666">'+String(res.url).replace(/</g,'')+'</small>':'')+
        '</p>';
      return;
    }
    if(!res.text || !String(res.text).trim()){
      const msg=t('Card returned empty HTML','الكارنيه رجع فاضي');
      toast(msg,'error');
      frame.srcdoc='<p style="padding:16px;font-family:sans-serif;color:#991b1b">'+msg+'</p>';
      return;
    }
    frame.srcdoc=res.text;
    if(autoPrint){
      setTimeout(function(){
        try{ frame.contentWindow.focus(); frame.contentWindow.print(); }
        catch(e){ toast(t('Allow pop-ups / try Print again','اسمح بالنوافذ المنبثقة أو اضغط طباعة'),'error'); }
      }, 450);
    }
  }

  function wireAccessCardButtons(){
    const reprint=function(){ openAccessCardPrint(true); };
    const b1=document.getElementById('btnReprintCard');
    const b2=document.getElementById('btnReprintCard2');
    if(b1) b1.addEventListener('click', reprint);
    if(b2) b2.addEventListener('click', reprint);
    const close1=document.getElementById('btnAccessPrintClose');
    const close2=document.getElementById('btnAccessPrintClose2');
    if(close1) close1.addEventListener('click', closeAccessPrint);
    if(close2) close2.addEventListener('click', closeAccessPrint);
    const doPrint=document.getElementById('btnAccessPrintDo');
    if(doPrint){
      doPrint.addEventListener('click', function(){
        const frame=document.getElementById('accessPrintFrame');
        try{ if(frame&&frame.contentWindow){ frame.contentWindow.focus(); frame.contentWindow.print(); } }
        catch(e){ toast(t('Allow pop-ups / try Print again','اسمح بالنوافذ المنبثقة أو اضغط طباعة'),'error'); }
      });
    }
    const ov=document.getElementById('accessPrintOverlay');
    if(ov) ov.addEventListener('click', function(e){ if(e.target===ov) closeAccessPrint(); });
  }
  wireAccessCardButtons();

  // ═══════════════════════════════════════════════════════════════
  //  Member App — activation code (staff generates; shown once)
  //  POST /api/members/{id}/app-activation-code  (members.edit)
  // ═══════════════════════════════════════════════════════════════
  function renderMemberApp(m){
    const statusEl=document.getElementById('memberAppStatus');
    const btn=document.getElementById('btnGenAppCode');
    const labelEl=btn&&btn.querySelector('.btn-label');
    const reveal=document.getElementById('memberAppReveal');
    if(!statusEl||!btn) return;

    // GET never returns plaintext — clear any previous on-screen code on status refresh
    if(reveal && !window.__gfpKeepAppCodeReveal){
      reveal.hidden=true;
      const codeEl=document.getElementById('memberAppCode');
      if(codeEl) codeEl.textContent='';
    }

    const app=m&&m.memberApp?m.memberApp:{};
    const st=String(app.status||'not_activated').toLowerCase();
    let statusText=t('Status: Not Activated','الحالة: غير مفعّل');
    if(st==='pending_code'){
      const exp=app.pendingCodeExpiresAtUtc?fmtDate(app.pendingCodeExpiresAtUtc):'—';
      statusText=t('Status: Code pending · expires ','الحالة: كود معلّق · ينتهي ')+exp;
    } else if(st==='activated'){
      const when=app.activatedAtUtc?fmtDate(app.activatedAtUtc):'';
      statusText=when
        ? t('Status: Activated · ','الحالة: مفعّل · ')+when
        : t('Status: Activated','الحالة: مفعّل');
    }
    statusEl.textContent=statusText;

    const canGen=!!canEdit && !!(m&&m.isActive);
    btn.hidden=!canGen;
    btn.disabled=!canGen;
    if(labelEl){
      if(st==='pending_code'){
        labelEl.setAttribute('data-en','Regenerate Code');
        labelEl.setAttribute('data-ar','إعادة إنشاء الكود');
        labelEl.textContent=t('Regenerate Code','إعادة إنشاء الكود');
      } else if(st==='activated'){
        labelEl.setAttribute('data-en','Generate New Code');
        labelEl.setAttribute('data-ar','إنشاء كود جديد');
        labelEl.textContent=t('Generate New Code','إنشاء كود جديد');
      } else {
        labelEl.setAttribute('data-en','Generate Activation Code');
        labelEl.setAttribute('data-ar','إنشاء كود التفعيل');
        labelEl.textContent=t('Generate Activation Code','إنشاء كود التفعيل');
      }
    }
  }

  function showActivationCodeReveal(payload){
    const reveal=document.getElementById('memberAppReveal');
    const codeEl=document.getElementById('memberAppCode');
    const expEl=document.getElementById('memberAppExpiry');
    if(!reveal||!codeEl||!expEl) return;
    const code=payload&&payload.activationCode?String(payload.activationCode):'';
    codeEl.textContent=code;
    const mins=payload&&payload.expiresInMinutes!=null?Number(payload.expiresInMinutes):null;
    const expUtc=payload&&payload.expiresAtUtc?fmtDate(payload.expiresAtUtc)+' '+fmtTime(payload.expiresAtUtc):'—';
    expEl.textContent=mins!=null&&!Number.isNaN(mins)
      ? t('Expires ','ينتهي ')+expUtc+' ('+mins+' '+t('min','دقيقة')+')'
      : t('Expires ','ينتهي ')+expUtc;
    reveal.hidden=false;
    applyLocaleBits(reveal);
  }

  function setGenAppCodeLoading(on){
    const btn=document.getElementById('btnGenAppCode');
    if(!btn) return;
    btn.classList.toggle('loading',!!on);
    btn.disabled=!!on || !(canEdit && memberData && memberData.isActive);
    const spin=btn.querySelector('.btn-spinner');
    if(spin) spin.style.display=on?'inline-block':'none';
  }

  async function generateMemberAppCode(){
    if(!canEdit){ toast(t('Missing members.edit permission','صلاحية members.edit مطلوبة'),'error'); return; }
    if(!memberData||!memberData.isActive){
      toast(t('Archived members cannot receive an activation code','لا يمكن إنشاء كود لحساب مؤرشف'),'error');
      return;
    }
    if(!Gfp||!memberId){ toast(t('API client missing','عميل الـ API غير موجود'),'error'); return; }

    const app=memberData.memberApp||{};
    const st=String(app.status||'not_activated').toLowerCase();
    if(st==='pending_code'||st==='activated'){
      const ok=confirm(
        t(
          'Previous unused code will stop working. Continue?',
          'الكود السابق غير المستخدم سيتوقف عن العمل. متابعة؟'
        )
      );
      if(!ok) return;
    }

    setGenAppCodeLoading(true);
    try{
      const r=await Gfp.post('/members/'+memberId+'/app-activation-code',{});
      if(r.status===401){ window.location.href='/auth/login/'; return; }
      if(r.status===403){
        toast(t('Missing members.edit permission','صلاحية members.edit مطلوبة'),'error');
        return;
      }
      if(r.status===404){
        toast(t('Member not found','العضو غير موجود'),'error');
        return;
      }
      if(!r.ok){
        toast(apiErr(r)||t('Could not generate code','مش قادرين ننشئ الكود'),'error');
        return;
      }
      const payload=r.data||{};
      toast(t('Activation code generated','تم إنشاء كود التفعيل'));
      // Refresh status from GET (never re-fetch plaintext code)
      window.__gfpKeepAppCodeReveal=true;
      try{
        await loadMember();
      }finally{
        window.__gfpKeepAppCodeReveal=false;
      }
      showActivationCodeReveal(payload);
    }catch(e){
      toast(t('Could not generate code','مش قادرين ننشئ الكود'),'error');
    }finally{
      setGenAppCodeLoading(false);
    }
  }

  const btnGenAppCode=document.getElementById('btnGenAppCode');
  if(btnGenAppCode){
    btnGenAppCode.addEventListener('click',function(e){
      e.preventDefault();
      generateMemberAppCode();
    });
  }
  const btnCopyAppCode=document.getElementById('btnCopyAppCode');
  if(btnCopyAppCode){
    btnCopyAppCode.addEventListener('click',async function(){
      const codeEl=document.getElementById('memberAppCode');
      const code=codeEl&&codeEl.textContent?codeEl.textContent.trim():'';
      if(!code) return;
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText){
          await navigator.clipboard.writeText(code);
        } else {
          const ta=document.createElement('textarea');
          ta.value=code; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
        }
        toast(t('Copied','تم النسخ'));
      }catch(e){
        toast(t('Could not copy','تعذّر النسخ'),'error');
      }
    });
  }
  window.addEventListener('gfp:locale',function(){
    if(memberData) renderMemberApp(memberData);
    applyLocaleBits(document.getElementById('memberAppCard'));
  });

  async function reconcileCurrentMembership(){
    if(!Gfp||!memberId) return;
    try{
      const r=await Gfp.get('/memberships/'+memberId+'/current');
      if(r.ok&&r.data){
        if(memberData) memberData.currentMembership=r.data;
        renderMembership(r.data);
      } else if(r.status===404){
        if(memberData) memberData.currentMembership=null;
        renderMembership(null);
      }
    }catch(e){ /* keep embedded snapshot */ }
  }

  function renderRecentAttendance(rows){
    const wrap=document.getElementById('recentAttWrap');
    const list=document.getElementById('recentAttList');
    if(!wrap||!list) return;
    const items=(rows||[]).slice(0,5);
    if(!items.length){
      wrap.style.display='none';
      list.innerHTML='';
      return;
    }
    wrap.style.display='block';
    list.innerHTML='<table class="att-tbl" style="width:100%"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Method</th></tr></thead><tbody>'+
      items.map(function(a){
        return '<tr><td>'+fmtDate(a.checkInAtUtc)+'</td><td>'+fmtTime(a.checkInAtUtc)+'</td><td>'+
          (a.checkOutAtUtc?fmtTime(a.checkOutAtUtc):'—')+'</td><td>'+(a.entryMethod||'—')+'</td></tr>';
      }).join('')+'</tbody></table>';
  }

  function renderMembership(ms){
    const container=document.getElementById('membershipContent');
    const canMgr=Authz?Authz.useCanRole('ManagerOrAbove'):false;
    if(!ms){
      container.innerHTML=`
        <div class="no-data">
          <i class="ti ti-id-off"></i>
          <p style="margin-bottom:16px">No membership on file</p>
          ${canMgr?`<button type="button" class="btn-ms primary" onclick="window.openAssignModal&&window.openAssignModal('${memberId}')"><i class="ti ti-plus"></i> Assign Membership</button>`:''}
        </div>`;
      return;
    }
    const st=String(ms.status||'').toLowerCase();
    const days=st==='expired'?0:daysRemaining(ms.endDate);
    const total=totalDays(ms.startDate,ms.endDate);
    const pct=total>0?Math.min(100,Math.round((Math.max(0,days)/total)*100)):0;
    const isPending=st==='pending';
    const isExpired=st==='expired';
    const isFrozen=st==='frozen';
    const canRenew=canMgr&&(st==='active'||st==='scheduled'||st==='expired'||st==='frozen'||st==='pending');
    const canAssign=canMgr&&(st==='expired'||st==='cancelled'||!st);

    const pendingBanner=isPending?`
      <div class="info-banner" style="margin:12px 0;padding:12px;border-radius:8px;background:var(--wrn100);color:var(--wrn500)">
        <strong><i class="ti ti-clock"></i> Waiting for payment</strong>
        <p style="margin:6px 0 10px;font-size:12px">Gateway methods leave a pending membership with no live push. Refresh after the customer pays.</p>
        <button type="button" class="btn-ms" onclick="refreshMembershipStatus()"><i class="ti ti-refresh"></i> Refresh status</button>
      </div>`:'';

    const expiredNote=isExpired?`
      <div class="info-banner" style="margin:12px 0;padding:12px;border-radius:8px;background:#FEE2E2;color:var(--dng500);font-size:12px">
        <i class="ti ti-info-circle"></i> Showing last expired membership (no active plan). Use Assign or Renew below.
      </div>`:'';

    const scheduledNote=st==='scheduled'?`
      <div class="info-banner" style="margin:12px 0;padding:12px;border-radius:8px;background:var(--wrn100);color:var(--wrn600,#B45309);font-size:12px">
        <i class="ti ti-calendar-event"></i> Membership starts ${fmtDate(ms.startDate)} — check-in not available yet.
      </div>`:'';

    const accountOff=memberData&&memberData.isActive===false;
    const accountNote=accountOff&&!isExpired?`
      <div class="info-banner" style="margin:12px 0;padding:12px;border-radius:8px;background:#FEF3C7;color:#B45309;font-size:12px">
        <i class="ti ti-user-off"></i> Account is archived — use <strong>Activate account</strong> here. Membership actions remain available below.
      </div>`:'';

    const due=ms.amountDue!=null?Number(ms.amountDue):(ms.balanceDue!=null?Number(ms.balanceDue):null);

    container.innerHTML=`
      <div class="ms-hero">
        <div class="ms-plan">${ms.planName||''}</div>
        <div class="ms-type-badge"><i class="ti ti-package"></i>${(ms.planType||'').replace(/_/g,' ')}</div>
        <div class="ms-status-row">
          <span class="ms-st-badge ${ms.status}">${ms.status}</span>
          ${!isPending&&!isExpired?`<span class="ms-days">${days} days remaining</span>`:''}
        </div>
        ${expiredNote}${scheduledNote}${accountNote}${pendingBanner}
        <div class="progress-wrap">
          <div class="progress-label"><span>${fmtDate(ms.startDate)}</span><span>${fmtDate(ms.endDate)}</span></div>
          <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
        </div>
        <div class="ms-meta">
          <div class="ms-meta-item"><div class="ms-meta-lbl">Amount Paid</div><div class="ms-meta-val">${fmtEGP(ms.amountPaid)}</div></div>
          ${due!=null?`<div class="ms-meta-item"><div class="ms-meta-lbl">Amount Due</div><div class="ms-meta-val">${fmtEGP(due)}</div></div>`:''}
          <div class="ms-meta-item"><div class="ms-meta-lbl">Payment</div><div class="ms-meta-val" style="text-transform:capitalize">${ms.paymentMethod||'—'}</div></div>
          ${ms.sessionsRemaining!=null?`<div class="ms-meta-item"><div class="ms-meta-lbl">Sessions Left</div><div class="ms-meta-val">${ms.sessionsRemaining}</div></div>`:''}
          ${ms.frozenUntilDate?`<div class="ms-meta-item"><div class="ms-meta-lbl">Frozen Until</div><div class="ms-meta-val">${fmtDate(ms.frozenUntilDate)}</div></div>`:''}
        </div>
      </div>
      <div class="ms-actions">
        ${canRenew?`<button type="button" class="btn-ms primary" onclick="openModal('modalRenew')"><i class="ti ti-refresh"></i> Renew</button>`:''}
        ${canAssign?`<button type="button" class="btn-ms primary" onclick="window.openAssignModal&&window.openAssignModal('${memberId}')"><i class="ti ti-plus"></i> Assign</button>`:''}
        ${canFreeze&&!isFrozen&&(st==='active'||st==='scheduled')?`<button type="button" class="btn-ms" onclick="openModal('modalFreeze')"><i class="ti ti-snowflake"></i> Freeze</button>`:''}
        ${canFreeze&&isFrozen?`<button type="button" class="btn-ms" onclick="unfreeze()"><i class="ti ti-sun"></i> Unfreeze</button>`:''}
        ${isPending?`<button type="button" class="btn-ms" onclick="refreshMembershipStatus()"><i class="ti ti-refresh"></i> Refresh</button>`:''}
      </div>`;

    setTimeout(()=>{const f=document.getElementById('progressFill');if(f) f.style.width=pct+'%';},100);
  }

  window.refreshMembershipStatus=async function(){
    if(!Gfp||!memberId) return;
    try{
      const r=await Gfp.get('/memberships/'+memberId+'/current');
      if(!r.ok){
        toast(apiErr(r)||'No membership','error');
        return;
      }
      if(memberData) memberData.currentMembership=r.data;
      renderMembership(r.data);
      const pending=r.data&&String(r.data.status||'').toLowerCase()==='pending';
      toast(pending?'Still waiting for payment':'Membership updated', 'success');
      loadHistory();
    }catch(e){ toast('Failed to refresh','error'); }
  };

  // ═══════════════════════════════════════════════════════════════
  //  Member Orders — GET /api/members/{id}/orders (fallback: /member-orders?memberId=)
  // ═══════════════════════════════════════════════════════════════
  async function loadMemberOrders(){
    const tbody=document.getElementById('ordersTbody');
    const empty=document.getElementById('ordersEmpty');
    const table=tbody&&tbody.closest('table');
    if(!tbody) return;
    tbody.innerHTML='<tr><td colspan="5" style="color:var(--ltt)">Loading…</td></tr>';
    if(empty) empty.style.display='none';
    if(table) table.style.display='';
    if(!Gfp){
      tbody.innerHTML='';
      if(table) table.style.display='none';
      if(empty){ empty.style.display='flex'; empty.querySelector('p').textContent='Unable to load member orders'; }
      return;
    }
    const Mo=window.GfpMemberOrdersApi;
    try{
      let r=null;
      if(Mo&&Mo.paths&&Mo.paths.memberOrders){
        r=await Gfp.get(Mo.paths.memberOrders(memberId,{page:1,pageSize:20}));
      }
      if(!r||r.status===404){
        r=await Gfp.get('/member-orders?memberId='+encodeURIComponent(memberId)+'&page=1&pageSize=20');
      }
      if(r.status===401){window.location.href='/auth/login/';return;}
      if(!r.ok){
        tbody.innerHTML='';
        if(table) table.style.display='none';
        if(empty){
          empty.style.display='flex';
          empty.querySelector('p').textContent=apiErr(r)||'Unable to load member orders';
        }
        return;
      }
      const paged=Mo&&Mo.extractPaged?Mo.extractPaged(r.data):{items:(r.data&&r.data.items)||(Array.isArray(r.data)?r.data:[])};
      const items=(paged.items||[]).map(function(raw){ return Mo&&Mo.normalizeOrder?Mo.normalizeOrder(raw):raw; }).filter(Boolean);
      if(!items.length){
        tbody.innerHTML='';
        if(table) table.style.display='none';
        if(empty){ empty.style.display='flex'; empty.querySelector('p').textContent='No member orders yet'; }
        return;
      }
      if(table) table.style.display='';
      if(empty) empty.style.display='none';
      tbody.innerHTML=items.map(function(o){
        const num=o.orderNumber!=null?('#'+o.orderNumber):(o.id||'').slice(0,8);
        const total=o.total!=null?Number(o.total).toLocaleString('en-EG',{style:'currency',currency:o.currency||'EGP'}):'—';
        const st=o.status||'—';
        return '<tr>'+
          '<td dir="ltr"><strong>'+escHtml(num)+'</strong></td>'+
          '<td><strong>'+escHtml(total)+'</strong></td>'+
          '<td>'+escHtml(st)+'</td>'+
          '<td>'+escHtml(o.createdAt?fmtDate(o.createdAt):'—')+'</td>'+
          '<td><a class="btn secondary" style="height:30px;padding:0 8px;font-size:12px" href="/dashboard/member-orders/?orderId='+encodeURIComponent(o.id||'')+'">View</a></td>'+
          '</tr>';
      }).join('');
    }catch(e){
      tbody.innerHTML='';
      if(table) table.style.display='none';
      if(empty){ empty.style.display='flex'; empty.querySelector('p').textContent='Unable to load member orders'; }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Attendance — GET /api/members/{id}/attendance
  // ═══════════════════════════════════════════════════════════════
  async function loadAttendance(){
    // Prefer embedded recentAttendance from detail until full page loads
    if(memberData&&Array.isArray(memberData.recentAttendance)&&memberData.recentAttendance.length&&!window._attFull){
      renderAttendance(memberData.recentAttendance.slice(0,5));
    }
    if(!Gfp){renderAttendance([]);return;}
    try{
      const r=await Gfp.get('/members/'+memberId+'/attendance?page=1&pageSize=20');
      if(r.status===401){window.location.href='/auth/login/';return;}
      if(!r.ok){
        if(!(memberData&&memberData.recentAttendance&&memberData.recentAttendance.length)){
          renderAttendance([]);
          toast(apiErr(r),'error');
        }
        return;
      }
      window._attFull=true;
      const d=r.data;
      const items=Array.isArray(d)?d:(d&&d.items)||[];
      renderAttendance(items);
    }catch(e){
      if(!(memberData&&memberData.recentAttendance&&memberData.recentAttendance.length)) renderAttendance([]);
    }
  }

  function renderAttendance(data){
    renderHeatmap(data);
    const tbody=document.getElementById('attTbody');
    const table=tbody&&tbody.closest('table');
    const empty=document.getElementById('attEmpty');
    if(!data.length){
      if(table) table.style.display='none';
      if(empty) empty.style.display='flex';
      return;
    }
    if(table) table.style.display='';
    if(empty) empty.style.display='none';
    tbody.innerHTML=data.map(a=>`
      <tr>
        <td>${fmtDate(a.checkInAtUtc)}</td>
        <td>${fmtTime(a.checkInAtUtc)}</td>
        <td>${a.checkOutAtUtc?fmtTime(a.checkOutAtUtc):'<span style="color:var(--ltt)">—</span>'}</td>
        <td><span class="method-badge ${a.entryMethod}"><i class="ti ti-${a.entryMethod==='qr'?'qrcode':'user-check'}"></i>${a.entryMethod==='qr'?'QR':'Manual'}</span></td>
        <td>${calcDuration(a.checkInAtUtc,a.checkOutAtUtc)}</td>
      </tr>`).join('');
  }

  function renderHeatmap(data){
    const attDays=new Set(data.map(a=>new Date(a.checkInAtUtc).toDateString()));
    const wrap=document.getElementById('heatmap');
    wrap.innerHTML='';
    const today=new Date();
    // 12 weeks = 84 days back
    const start=new Date(today);
    start.setDate(start.getDate()-83);
    // Align to Sunday
    start.setDate(start.getDate()-start.getDay());
    let cur=new Date(start);
    for(let w=0;w<12;w++){
      const col=document.createElement('div');
      col.className='hm-week';
      for(let d=0;d<7;d++){
        const cell=document.createElement('div');
        const present=attDays.has(cur.toDateString());
        cell.className='hm-day'+(present?' l3':'');
        cell.title=cur.toDateString()+(present?' — Present':'');
        col.appendChild(cell);
        cur.setDate(cur.getDate()+1);
      }
      wrap.appendChild(col);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Membership History — GET /api/memberships/{memberId}/history
  // ═══════════════════════════════════════════════════════════════
  let histPage=1;
  let histHasNext=false;
  let histItems=[];

  async function loadHistory(append){
    if(!Gfp){renderHistory([]);return;}
    if(!append){ histPage=1; histItems=[]; }
    try{
      const r=await Gfp.get('/memberships/'+memberId+'/history?page='+histPage+'&pageSize=20');
      if(r.status===401){window.location.href='/auth/login/';return;}
      if(!r.ok){ if(!append) renderHistory([]); return; }
      const d=r.data;
      const items=Array.isArray(d)?d:(d&&d.items)||[];
      histHasNext=!!(d&&(d.hasNext||(d.page!=null&&d.totalPages!=null&&d.page<d.totalPages)));
      if(append) histItems=histItems.concat(items);
      else histItems=items;
      renderHistory(histItems);
    }catch(e){ if(!append) renderHistory([]); }
  }

  function renderHistory(data){
    const wrap=document.getElementById('histTimeline');
    if(!data.length){wrap.innerHTML='<div class="no-data"><i class="ti ti-history"></i><p>No membership history</p></div>';return;}
    wrap.innerHTML=data.map((h,i)=>`
      <div class="tl-item">
        <div class="tl-line">
          <div class="tl-dot ${h.status}"></div>
          ${i<data.length-1?'<div class="tl-connector"></div>':''}
        </div>
        <div class="tl-body">
          <div class="tl-plan">${h.planName}</div>
          <div class="tl-dates">${fmtDate(h.startDate)} → ${fmtDate(h.endDate)}</div>
          <div class="tl-meta">
            <span class="tl-badge ${h.status}">${h.status}</span>
            <span class="tl-amount">${fmtEGP(h.amountPaid)} · ${h.paymentMethod||''}</span>
          </div>
        </div>
      </div>`).join('')+(histHasNext
        ?`<div style="text-align:center;margin-top:12px"><button class="btn-ms" type="button" id="btnHistMore">Load more</button></div>`
        :'');
    const more=document.getElementById('btnHistMore');
    if(more) more.addEventListener('click',function(){ histPage++; loadHistory(true); });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Actions — Renew / Freeze / Unfreeze / Assign (Member 360)
  // ═══════════════════════════════════════════════════════════════
  window.openModal=openModal;
  window.closeModal=closeModal;

  window.unfreeze=async function(){
    if(!canFreeze){ toast('memberships.freeze permission required','error'); return; }
    if(!Gfp||!memberId) return;
    if(!confirm('Unfreeze membership?')) return;
    const r=await Gfp.post('/members/'+memberId+'/unfreeze',{});
    if(r.ok){ toast('Unfrozen'); loadMember(); loadHistory(); }
    else toast(apiErr(r)||'Failed to unfreeze','error');
  };

  const btnFreezeEl=document.getElementById('btnFreeze');
  if(btnFreezeEl){
    btnFreezeEl.addEventListener('click',async function(e){
      e.preventDefault();
      if(!canFreeze){ toast('memberships.freeze permission required','error'); return; }
      const until=document.getElementById('freezeUntil');
      const reason=document.getElementById('freezeReason');
      if(!until||!until.value){ toast('Select freeze until date','error'); return; }
      const r=await Gfp.post('/members/'+memberId+'/freeze',{
        frozenUntil: until.value+'T00:00:00',
        reason:(reason&&reason.value)||null
      });
      if(r.ok){ closeModal('modalFreeze'); toast('Membership frozen'); loadMember(); loadHistory(); }
      else toast(apiErr(r)||'Failed to freeze','error');
    });
  }

  // Status toggle — account IsActive only (OwnerOnly). Independent of membership plan.
  document.getElementById('statusToggle').addEventListener('change',async function(){
    if(!isOwner){
      this.checked=!!(memberData&&memberData.isActive);
      toast('Only Owners can change account active status','error');
      return;
    }
    const wantActive=this.checked;
    if(!wantActive){
      this.checked=true; // revert until confirm
      document.getElementById('deactivateModalTitle').textContent='Deactivate '+((memberData&&memberData.fullName)||'Member')+'?';
      openModal('modalDeactivate');
      return;
    }
    // Reactivate account — never requires assigning a new plan.
    this.checked=false;
    if(!Gfp||!memberData) return;
    const r=await Gfp.post('/members/'+memberData.id+'/reactivate',{});
    if(r.ok){
      toast('Account reactivated');
      loadMember();
      if(typeof window.loadMembers==='function') window.loadMembers();
    } else {
      toast(apiErr(r)||'Failed to reactivate','error');
    }
  });

  document.getElementById('btnConfirmDeactivate').addEventListener('click',async function(){
    if(!isOwner){toast('Only Owners can deactivate members','error');return;}
    if(!Gfp||!memberData) return;
    const r=await Gfp.del('/members/'+memberData.id);
    if(r.ok){
      closeModal('modalDeactivate');
      toast('Member account deactivated (membership unchanged)');
      loadMember();
      if(typeof window.loadMembers==='function') window.loadMembers();
      if(typeof window.loadStats==='function') window.loadStats();
    } else toast(apiErr(r)||'Failed to deactivate','error');
  });

  document.getElementById('btnDeactivate').addEventListener('click',async function(){
    if(!isOwner){toast('Only Owners can change account status','error');return;}
    if(!memberData) return;
    if(memberData.isActive){
      document.getElementById('deactivateModalTitle').textContent='Deactivate '+memberData.fullName+'?';
      openModal('modalDeactivate');
      return;
    }
    if(!Gfp) return;
    const r=await Gfp.post('/members/'+memberData.id+'/reactivate',{});
    if(r.ok){
      toast('Account reactivated');
      loadMember();
      if(typeof window.loadMembers==='function') window.loadMembers();
    } else toast(apiErr(r)||'Failed to reactivate','error');
  });

  // Send Notification
  document.getElementById('btnNotify').addEventListener('click',function(){
    if(!memberData) return;
    document.getElementById('notifMemberName').textContent=memberData.fullName;
    openModal('modalNotify');
  });

  document.getElementById('btnSendNotif').addEventListener('click',async function(){
    const title=document.getElementById('notifTitle').value;
    const body=document.getElementById('notifBody').value;
    if(!title||!body){toast('Please fill in title and message','error');return;}
    try{
      const res=await fetch(`${API_BASE}/notifications/send-bulk`,{
        method:'POST',headers:getAuthHeaders(),
        body:JSON.stringify({memberIds:[memberData.id],title,body})
      });
      if(res.ok){closeModal('modalNotify');toast('Notification sent successfully');}
      else toast('Failed to send notification','error');
    }catch(e){toast('Failed to send notification','error');}
  });

  // Edit button — members.edit
  document.getElementById('btnEdit').addEventListener('click',function(){
    if(!canEdit){toast('Missing members.edit permission','error');return;}
    if(memberData && window.openEditDrawer) window.openEditDrawer(memberData);
  });
  const btnEdit2=document.getElementById('btnEdit2');
  if(btnEdit2){
    btnEdit2.addEventListener('click',function(){
      if(!canEdit){toast('Missing members.edit permission','error');return;}
      if(memberData && window.openEditDrawer) window.openEditDrawer(memberData);
    });
  }

  // Renew — POST /api/memberships/{id}/renew (ManagerOrAbove; transitionMode)
  let renewMode='same';
  let renewTransition='cancel_and_switch';
  let renewRollover=false;
  let renewPlansCache=[];

  function membershipCoversToday(ms){
    if(!ms) return false;
    const st=String(ms.status||'').toLowerCase();
    if(st!=='active'&&st!=='frozen') return false;
    const end=String(ms.endDate||'').slice(0,10);
    if(!end) return false;
    const now=new Date();
    const t=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    return end>=t;
  }

  function parseDateOnly(d){
    const s=String(d||'').slice(0,10).split('-');
    if(s.length!==3) return null;
    return new Date(Number(s[0]),Number(s[1])-1,Number(s[2]));
  }

  function addDaysLocal(date,days){
    const x=new Date(date.getFullYear(),date.getMonth(),date.getDate());
    x.setDate(x.getDate()+days);
    return x;
  }

  function getRenewTransitionMode(){
    const ms=memberData&&memberData.currentMembership;
    if(!membershipCoversToday(ms)) return 'cancel_and_switch';
    if(renewRollover) return 'manual_rollover';
    return renewTransition==='queue_next'?'queue_next':'cancel_and_switch';
  }

  function resolveRenewDuration(){
    if(renewMode==='diff'){
      const sel=document.getElementById('renewPlanSelect');
      const id=sel&&sel.value;
      const p=renewPlansCache.find(function(x){return x.id===id;});
      if(p&&p.durationDays!=null) return Number(p.durationDays)||0;
    }
    const ms=memberData&&memberData.currentMembership;
    const s=parseDateOnly(ms&&ms.startDate);
    const e=parseDateOnly(ms&&ms.endDate);
    if(s&&e){
      const days=Math.round((e-s)/86400000);
      if(days>0) return days;
    }
    return 30;
  }

  function updateRenewTransitionUi(){
    const ms=memberData&&memberData.currentMembership;
    const wrap=document.getElementById('renewTransitionWrap');
    const banner=document.getElementById('renewModeBanner');
    const preview=document.getElementById('renewPreview');
    const covering=membershipCoversToday(ms);
    if(wrap) wrap.style.display=covering?'block':'none';
    if(!banner||!preview) return;
    if(!covering){
      banner.textContent='No covering membership — new plan starts today for a full duration.';
      preview.textContent='';
      return;
    }
    const mode=getRenewTransitionMode();
    const duration=resolveRenewDuration();
    const today=new Date(); today.setHours(0,0,0,0);
    const priorEnd=parseDateOnly(ms.endDate)||today;
    let start=today, end=addDaysLocal(today,duration), copy='';
    if(mode==='queue_next'){
      start=addDaysLocal(priorEnd,1);
      end=addDaysLocal(start,duration);
      copy='Queue next plan — current stays active until it ends; new plan starts after.';
    } else if(mode==='manual_rollover'){
      end=addDaysLocal(priorEnd,duration);
      copy='Add remaining days onto the new plan (legacy rollover).';
    } else {
      copy='Cancel & switch — current ends today; new plan starts today.';
    }
    banner.textContent=copy;
    preview.textContent='Estimated: '+fmtDate(start)+' → '+fmtDate(end)+' (server confirms).';

    const cancelBtn=document.getElementById('renewTransCancel');
    const queueBtn=document.getElementById('renewTransQueue');
    if(cancelBtn) cancelBtn.className=!renewRollover&&renewTransition==='cancel_and_switch'?'btn-ms primary':'btn-ms';
    if(queueBtn) queueBtn.className=!renewRollover&&renewTransition==='queue_next'?'btn-ms primary':'btn-ms';
  }

  function setRenewMode(mode){
    renewMode=mode;
    const same=document.getElementById('renewModeSame');
    const diff=document.getElementById('renewModeDiff');
    const sel=document.getElementById('renewPlanSelect');
    if(same) same.className=mode==='same'?'btn-ms primary':'btn-ms';
    if(diff) diff.className=mode==='diff'?'btn-ms primary':'btn-ms';
    if(sel) sel.style.display=mode==='diff'?'block':'none';
    updateRenewTransitionUi();
  }
  async function loadRenewPlans(){
    const sel=document.getElementById('renewPlanSelect');
    if(!sel||!Gfp) return;
    try{
      const r=await Gfp.get('/membership-plans');
      if(!r.ok){ sel.innerHTML='<option value="">Cannot load plans (needs plans.manage)</option>'; return; }
      renewPlansCache=(Array.isArray(r.data)?r.data:[]).filter(p=>p&&p.isActive!==false);
      sel.innerHTML='<option value="">— Select a plan —</option>'+renewPlansCache.map(p=>
        `<option value="${p.id}">${p.name} — EGP ${p.price||0} (${p.durationDays||0}d)</option>`
      ).join('');
    }catch(e){
      sel.innerHTML='<option value="">Failed to load plans</option>';
    }
  }
  const renewModeSame=document.getElementById('renewModeSame');
  const renewModeDiff=document.getElementById('renewModeDiff');
  if(renewModeSame) renewModeSame.addEventListener('click',function(){ setRenewMode('same'); });
  if(renewModeDiff) renewModeDiff.addEventListener('click',function(){ setRenewMode('diff'); loadRenewPlans(); });
  setRenewMode('same');

  const renewTransCancel=document.getElementById('renewTransCancel');
  const renewTransQueue=document.getElementById('renewTransQueue');
  const renewRolloverEl=document.getElementById('renewRollover');
  if(renewTransCancel) renewTransCancel.addEventListener('click',function(){
    renewRollover=false;
    if(renewRolloverEl) renewRolloverEl.checked=false;
    renewTransition='cancel_and_switch';
    updateRenewTransitionUi();
  });
  if(renewTransQueue) renewTransQueue.addEventListener('click',function(){
    renewRollover=false;
    if(renewRolloverEl) renewRolloverEl.checked=false;
    renewTransition='queue_next';
    updateRenewTransitionUi();
  });
  if(renewRolloverEl) renewRolloverEl.addEventListener('change',function(){
    renewRollover=!!renewRolloverEl.checked;
    updateRenewTransitionUi();
  });
  const renewPlanSel=document.getElementById('renewPlanSelect');
  if(renewPlanSel) renewPlanSel.addEventListener('change',updateRenewTransitionUi);

  function updateRenewHint(){
    const pay=document.getElementById('renewPayment');
    const hint=document.getElementById('renewPayHint');
    if(!pay||!hint) return;
    hint.textContent=pay.value==='cash'
      ?'Cash activates immediately and posts to your open shift.'
      :'Gateway: membership stays pending until webhook — refresh status after payment (no live push).';
  }
  const renewPayEl=document.getElementById('renewPayment');
  if(renewPayEl) renewPayEl.addEventListener('change',updateRenewHint);
  updateRenewHint();

  const btnDoRenew=document.getElementById('btnDoRenew');
  if(btnDoRenew){
    btnDoRenew.addEventListener('click',async function(e){
      e.preventDefault();
      const canMgr=Authz?Authz.useCanRole('ManagerOrAbove'):false;
      if(!canMgr){ toast('Manager or above required','error'); return; }
      if(!Gfp||!memberId) return;
      const payEl=document.getElementById('renewPayment');
      const amtEl=document.getElementById('renewAmount');
      const errBanner=document.getElementById('renewErrorBanner');
      const payMethod=payEl?payEl.value:'cash';
      const amountPaid=amtEl?parseFloat(amtEl.value)||0:0;
      const body={
        planId: renewMode==='diff'?(document.getElementById('renewPlanSelect')||{}).value||null:null,
        paymentMethod: payMethod,
        amountPaid: amountPaid,
        transitionMode: getRenewTransitionMode()
      };
      if(renewMode==='diff'&&!body.planId){
        if(errBanner){ errBanner.style.display='flex'; errBanner.querySelector('.error-text').textContent='Select a plan'; }
        return;
      }
      btnDoRenew.disabled=true;
      try{
        if(payMethod==='cash'&&amountPaid>0){
          const sh=await Gfp.get('/shifts/current');
          if(!sh.ok||!sh.data||!sh.data.id){
            if(errBanner){ errBanner.style.display='flex'; errBanner.querySelector('.error-text').textContent='Open a shift before accepting cash renewal.'; }
            btnDoRenew.disabled=false;
            return;
          }
        }
        const r=await Gfp.post('/memberships/'+memberId+'/renew', body);
        if(r.ok){
          closeModal('modalRenew');
          const pending=r.data&&String(r.data.status||'').toLowerCase()==='pending';
          toast(pending?'Renewed — waiting for payment. Use Refresh status.':'Renewed');
          loadMember();
          loadHistory();
        } else {
          if(errBanner){ errBanner.style.display='flex'; errBanner.querySelector('.error-text').textContent=apiErr(r)||'Renew failed'; }
          toast(apiErr(r)||'Renew failed','error');
        }
      }catch(err){
        toast('Network error','error');
      }
      btnDoRenew.disabled=false;
    });
  }

  // ── Init ──
  window.loadMember = loadMember;
  loadMember();

  // Gym names — any-auth gym-code preferred over OwnerOnly settings
  async function loadTenant(){
    if(!Gfp) return;
    try{
      const r=await Gfp.get('/settings/gym-code');
      // Keep existing gym labels if Owner settings already loaded elsewhere
      if(r.ok&&r.data&&r.data.gymCode){
        /* gym code available for context; names still from token/user if needed */
      }
    }catch(e){}
  }
  loadTenant();
})();
