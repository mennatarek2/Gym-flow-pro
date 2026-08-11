// ═══════════════════════════════════════════════════════════════
//  Members Page Logic — apps/web/(dashboard)/members/
//  API: GET /api/members?search=&status=&page=1&pageSize=20
//  Member workspace list — person + current membership glance columns.
// ═══════════════════════════════════════════════════════════════
(function(){
  const Gfp = window.GfpApi;
  const Authz = window.GfpAuthz;
  function getUser(){
    if(Gfp&&Gfp.tokens) return Gfp.tokens.getUser();
    try{return JSON.parse(localStorage.getItem('gfp_user')||sessionStorage.getItem('gfp_user'));}
    catch(e){return null;}
  }

  // ── Sidebar user ──
  const user = getUser();
  if(!user){window.location.href='/auth/login/';return;}
  const canView = Authz ? Authz.useCan('members.view') : true;
  const canCreate = Authz ? Authz.useCan('members.create') : false;
  const canEdit = Authz ? Authz.useCan('members.edit') : false;
  if(!canView){window.location.href='/dashboard/';return;}

  const ini=(user.fullName||'U').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('userAvatar').textContent=ini;
  document.getElementById('userName').textContent=user.fullName||'User';
  document.getElementById('userRole').textContent=user.role||'Staff';
  if(Authz&&Authz.useCanRole('OwnerOnly')){const ns=document.getElementById('navStaff');if(ns) ns.style.display='flex';}
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

  // Permission UI — Add Member / row Edit
  const btnAdd=document.getElementById('btnAddMember');
  if(btnAdd && !canCreate) btnAdd.style.display='none';
  window.__gfpCanEditMember = canEdit;
  window.__gfpCanCreateMember = canCreate;

  // ═══════════════════════════════════════════════════════════════
  //  State
  // ═══════════════════════════════════════════════════════════════
  let search='', statusFilter='all', page=1;
  const pageSize=20;
  let membersData=[];    // Current page results from API
  let totalCount=0;      // Total matching records (for pagination)
  let searchDebounce=null;

  // ── Helpers ──
  function getInitials(n){return(n||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();}
  function daysUntil(d){
    if(!d) return null;
    const end=new Date(d); const now=new Date();
    end.setHours(0,0,0,0); now.setHours(0,0,0,0);
    return Math.round((end-now)/86400000);
  }

  /**
   * P12-R1 / R1-FE-01 / R1-FE-08 — person-primary status only (Active / Archived).
   * Membership status is computed privately for Frozen Legacy CTA eligibility — not primary chrome.
   */
  function resolveListStatus(m){
    const accountOk = m.isActive !== false;
    let mem = String(m.membershipStatus || '').toLowerCase().trim();
    if(!mem){
      if(!m.activePlan && !m.expiryDate) mem = 'none';
      else mem = 'active';
    }
    const d = daysUntil(m.expiryDate);
    if((mem === 'active' || mem === 'scheduled') && d != null && d < 0) mem = 'expired';

    // Person-primary language (P6): Active or Archived — never Expired/Frozen as person status
    const primary = accountOk ? 'active' : 'archived';

    return { accountOk: accountOk, mem: mem, primary: primary, days: d };
  }

  const PERSON_STATUS_META = {
    active:   { label: 'Active',   cls: 'active',    icon: 'ti-circle-check' },
    archived: { label: 'Archived', cls: 'suspended', icon: 'ti-user-off' }
  };

  function renderPersonStatusCell(info){
    const meta = PERSON_STATUS_META[info.primary] || PERSON_STATUS_META.archived;
    return '<div class="st-stack"><span class="st-badge '+meta.cls+'" title="Person account status">'
      +'<i class="ti '+meta.icon+'"></i>'+meta.label+'</span></div>';
  }

  function updatePeopleCount(){
    const el = document.getElementById('statPeople');
    const badge = document.getElementById('totalBadge');
    if(el) el.textContent = String(totalCount || 0);
    if(badge) badge.textContent = String(totalCount || 0);
  }

  // ═══════════════════════════════════════════════════════════════
  //  API Calls
  // ═══════════════════════════════════════════════════════════════

  // ── GET /api/members — PagedResult<MemberListItemDto>
  async function loadMembers(){
    showSkeleton();
    if(!Gfp){
      membersData=[]; totalCount=0; updatePeopleCount(); hideSkeleton();
      return;
    }
    try{
      const params = new URLSearchParams();
      if(search) params.set('search', search);
      // Person-primary filters only: all | inactive (Archived). No expired/frozen/cancelled.
      if(statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
      params.set('page', page.toString());
      params.set('pageSize', pageSize.toString());

      const r = await Gfp.get('/members?' + params.toString());
      if(r.status === 401){ window.location.href='/auth/login/'; return; }
      if(!r.ok){
        console.error('Failed to load members:', r.status);
        membersData=[]; totalCount=0; updatePeopleCount(); hideSkeleton(); return;
      }

      const data = r.data;
      const paged = Gfp.asPaged ? Gfp.asPaged(data) : null;
      if (paged && Array.isArray(paged.items)) {
        membersData = paged.items;
        totalCount = Number(paged.totalCount) || 0;
      } else if (data && (data.items || data.Items)) {
        membersData = data.items || data.Items || [];
        totalCount = Number(
          data.totalCount != null ? data.totalCount : data.TotalCount != null ? data.TotalCount : 0
        );
      } else if (Array.isArray(data)) {
        membersData = data;
        totalCount = data.length;
      } else {
        membersData = [];
        totalCount = 0;
      }
    }catch(err){
      console.error('Network error loading members:', err);
      membersData=[]; totalCount=0;
    }
    updatePeopleCount();
    hideSkeleton();
  }

  // P12-R1: membership-status analytics KPIs removed from Members desk (R1-FE-03).
  async function loadStats(){
    updatePeopleCount();
  }

  async function loadTenant(){
    // Owner-only full settings — skip for others (shell already shows gym context)
  }

  // ═══════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════
  function render(){
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if(page > totalPages) page = totalPages;

    const tbody = document.getElementById('tblBody');
    const tblWrap = document.getElementById('tblWrap');
    const emptyEl = document.getElementById('emptyState');
    const pagiEl = document.getElementById('pagination');

    if(membersData.length === 0){
      tblWrap.style.display='none';
      pagiEl.style.display='none';
      emptyEl.style.display='flex';
      return;
    }
    tblWrap.style.display='';
    pagiEl.style.display='flex';
    emptyEl.style.display='none';

    tbody.innerHTML = membersData.map(m => {
      const info = resolveListStatus(m);
      const nameEn = m.fullName || '';
      const nameAr = m.fullNameAr || '';
      const phone = m.phone || '';
      const memberNum = m.memberNumber || '';

      // Person-row styling only — no Expired/Frozen/expiring membership row chrome
      let rowCls = '';
      if(!info.accountOk) rowCls = 'row-suspended';

      const detailHref = '/dashboard/members/'+encodeURIComponent(m.id)+'/';
      const planName = m.activePlan || m.planName || m.currentPlanName || '—';
      const expiry = m.expiryDate || m.endDate || null;
      const remDays = info.days;
      const sessions = m.sessionsRemaining != null ? m.sessionsRemaining : (m.remainingSessions != null ? m.remainingSessions : null);
      let remaining = '—';
      if(sessions != null) remaining = sessions + ' sess';
      else if(remDays != null) remaining = remDays + 'd';
      const memLabel = info.mem && info.mem !== 'none' ? info.mem : '';

      return `<tr class="${rowCls}">
        <td>
          <div class="m-cell">
            <div class="m-av ${!info.accountOk ? 'm-av-muted' : ''}">${getInitials(nameEn)}</div>
            <div class="m-info">
              <div class="m-num">#${memberNum}</div>
              <div class="m-name">${nameEn}</div>
              ${nameAr ? '<div class="m-name-ar">'+nameAr+'</div>' : ''}
              ${phone ? '<div class="m-name-ar" style="font-size:11px">'+phone+'</div>' : ''}
            </div>
          </div>
        </td>
        <td>
          ${renderPersonStatusCell(info)}
          ${memLabel && info.accountOk ? '<div style="margin-top:4px;font-size:11px;color:var(--ltt);text-transform:capitalize">'+memLabel+'</div>' : ''}
        </td>
        <td style="font-size:13px;font-weight:500">${planName}</td>
        <td style="font-size:12px;color:var(--lts)">${expiry ? new Date(expiry).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td>
        <td style="font-size:12px;font-weight:600">${remaining}</td>
        <td>
          <div class="act-btns">
            <button class="act-btn" title="View" onclick="window.location.href='${detailHref}'"><i class="ti ti-eye"></i></button>
            ${canEdit?`<button class="act-btn" title="Edit" onclick="if(window.openEditDrawer) window.openEditDrawer('${m.id}')"><i class="ti ti-edit"></i></button>`:''}
            <button class="act-btn act-renew" title="Open member (renew / membership)" onclick="window.location.href='${detailHref}'"><i class="ti ti-refresh"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('pagiPrev').disabled = page <= 1;
    document.getElementById('pagiNext').disabled = page >= totalPages;
    document.getElementById('pagiInfo').innerHTML = 'Page <strong>' + page + '</strong> of <strong>' + totalPages + '</strong>' +
      (totalCount ? ' <span style="color:var(--ltt);font-weight:400">(' + totalCount + ')</span>' : '');
  }

  // ── Skeleton ──
  function showSkeleton(){
    document.getElementById('skeleton').style.display='block';
    document.getElementById('tblWrap').style.display='none';
    document.getElementById('pagination').style.display='none';
    document.getElementById('emptyState').style.display='none';
  }
  function hideSkeleton(){
    document.getElementById('skeleton').style.display='none';
    render();
  }

  // ═══════════════════════════════════════════════════════════════
  //  Event Listeners
  // ═══════════════════════════════════════════════════════════════

  document.getElementById('searchInput').addEventListener('input',function(){
    search = this.value;
    page = 1;
    if(searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadMembers, 300);
  });

  document.querySelectorAll('.f-chip').forEach(chip=>{
    chip.addEventListener('click',function(){
      document.querySelectorAll('.f-chip').forEach(c=>c.classList.remove('act'));
      this.classList.add('act');
      statusFilter = this.dataset.status;
      page = 1;
      loadMembers();
    });
  });

  document.getElementById('pagiPrev').addEventListener('click',function(){
    if(page > 1){ page--; loadMembers(); }
  });
  document.getElementById('pagiNext').addEventListener('click',function(){
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1);
    if(page < totalPages){ page++; loadMembers(); }
  });

  window.loadMembers = loadMembers;
  window.loadStats = loadStats;

  loadTenant();
  loadStats();
  loadMembers();

})();
