(function(){

  // ── Helpers ──
  function toast(msg, type='success') {
    const t = document.getElementById('toast');
    t.innerHTML = '<i class="ti '+(type==='success'?'ti-check':'ti-alert-circle')+'"></i>'+msg;
    t.className = 'toast '+type+' show';
    setTimeout(() => t.classList.remove('show'), 3500);
  }
  function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
  function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase(); }
  function timeAgo(d) {
    if (!d) return '';
    const now = new Date(), dt = new Date(d);
    const diff = Math.floor((now-dt)/(1000*60));
    if (diff < 1) return 'Just now';
    if (diff < 60) return diff+'m ago';
    const h = Math.floor(diff/60);
    if (h < 24) return h+'h ago';
    const days = Math.floor(h/24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days+'d ago';
    return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  }

  // ── Selected members ──
  let selectedMembers = [];
  let debounceTimer = null;

  // ── Target radio ──
  document.querySelectorAll('.target-radio').forEach(radio => {
    radio.addEventListener('click', function() {
      document.querySelectorAll('.target-radio').forEach(r => r.classList.remove('selected'));
      this.classList.add('selected');
      this.querySelector('input').checked = true;
      const isSpecific = this.querySelector('input').value === 'specific';
      document.getElementById('memberSearchSection').style.display = isSpecific ? 'block' : 'none';
    });
  });

  // ── Channel selector ──
  document.querySelectorAll('.channel-card').forEach(card => {
    card.addEventListener('click', function() {
      document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('selected'));
      this.classList.add('selected');
      this.querySelector('input').checked = true;
      // Update preview icon
      const ch = this.querySelector('input').value;
      const pnIcon = document.querySelector('.pn-icon i');
      if (ch === 'whatsapp') {
        pnIcon.className = 'ti ti-brand-whatsapp';
        document.querySelector('.pn-icon').style.background = '#25D366';
      } else {
        pnIcon.className = 'ti ti-bell-ringing';
        document.querySelector('.pn-icon').style.background = '';
      }
    });
  });

  // ── Character counts ──
  ['titleEn','titleAr','bodyEn','bodyAr'].forEach(id => {
    const el = document.getElementById(id);
    const counter = document.getElementById(id+'Count');
    const max = parseInt(el.getAttribute('maxlength'));
    el.addEventListener('input', function() {
      const len = this.value.length;
      counter.textContent = len;
      const wrap = counter.parentElement;
      wrap.classList.toggle('near', len > max * 0.8 && len < max);
      wrap.classList.toggle('over', len >= max);
      updatePreview();
    });
  });

  function updatePreview() {
    const title = document.getElementById('titleEn').value || 'Notification Title';
    const body = document.getElementById('bodyEn').value || 'Your message preview will appear here...';
    document.getElementById('previewTitle').textContent = title;
    document.getElementById('previewBody').textContent = body;
  }

  // ── Member search ──
  const searchInput = document.getElementById('memberSearch');
  const resultsDiv = document.getElementById('searchResults');

  searchInput.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    const q = this.value.trim();
    if (q.length < 2) { resultsDiv.classList.remove('show'); return; }
    debounceTimer = setTimeout(() => searchMembers(q), 300);
  });

  searchInput.addEventListener('focus', function() {
    if (resultsDiv.children.length > 0 && this.value.length >= 2) resultsDiv.classList.add('show');
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.member-search-section')) resultsDiv.classList.remove('show');
  });

  async function searchMembers(q) {
    const data = await apiGet('/attendance/search-members?query='+encodeURIComponent(q));
    const members = Array.isArray(data) ? data : [];
    if (!members.length) {
      resultsDiv.innerHTML = '<div style="padding:12px;text-align:center;color:var(--ltt);font-size:12px">No members found</div>';
      resultsDiv.classList.add('show');
      return;
    }
    resultsDiv.innerHTML = members.map(m => {
      const name = m.fullName || ((m.firstName||'')+' '+(m.lastName||'')).trim();
      const alreadySelected = selectedMembers.some(s => s.id === m.memberId);
      return `<div class="sr-item ${alreadySelected?'disabled':''}" data-id="${m.memberId}" data-name="${esc(name)}">
        <div class="sr-av">${initials(name)}</div>
        <span class="sr-name">${esc(name)}</span>
      </div>`;
    }).join('');
    resultsDiv.classList.add('show');

    resultsDiv.querySelectorAll('.sr-item:not(.disabled)').forEach(item => {
      item.addEventListener('click', function() {
        if (selectedMembers.length >= 50) { toast('Maximum 50 members','error'); return; }
        selectedMembers.push({ id: this.dataset.id, name: this.dataset.name });
        this.classList.add('disabled');
        renderChips();
      });
    });
  }

  function renderChips() {
    const container = document.getElementById('selectedChips');
    container.innerHTML = selectedMembers.map((m,i) =>
      `<span class="sel-chip">${esc(m.name)}<button class="sel-chip-x" data-idx="${i}">&times;</button></span>`
    ).join('');
    document.getElementById('chipCount').textContent = selectedMembers.length + ' / 50';

    container.querySelectorAll('.sel-chip-x').forEach(btn => {
      btn.addEventListener('click', function() {
        selectedMembers.splice(parseInt(this.dataset.idx), 1);
        renderChips();
      });
    });
  }

  // ── Send ──
  document.getElementById('btnSend').addEventListener('click', async function() {
    const titleEn = document.getElementById('titleEn').value.trim();
    const titleAr = document.getElementById('titleAr').value.trim();
    const bodyEn = document.getElementById('bodyEn').value.trim();
    const bodyAr = document.getElementById('bodyAr').value.trim();

    if (!titleEn || !titleAr || !bodyEn || !bodyAr) {
      toast('Please fill all required fields', 'error'); return;
    }

    const target = document.querySelector('input[name=target]:checked').value;
    if (target === 'specific' && !selectedMembers.length) {
      toast('Please select at least one member', 'error'); return;
    }

    const channel = document.querySelector('input[name=channel]:checked').value;

    this.disabled = true;
    this.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Sending...';

    const body = {
      titleEn, titleAr, bodyEn, bodyAr,
      channel,
      targetAll: target === 'all',
      memberIds: target === 'specific' ? selectedMembers.map(m=>m.id) : []
    };

    const res = await apiPost('/notifications/send-bulk', body);
    if (res && res.ok) {
      const count = res.data?.recipientCount || res.data?.count || selectedMembers.length || 'all';
      toast('Notification sent to '+count+' members');
      // Reset form
      document.getElementById('titleEn').value = '';
      document.getElementById('titleAr').value = '';
      document.getElementById('bodyEn').value = '';
      document.getElementById('bodyAr').value = '';
      ['titleEnCount','titleArCount','bodyEnCount','bodyArCount'].forEach(id => document.getElementById(id).textContent='0');
      selectedMembers = [];
      renderChips();
      updatePreview();
      loadHistory();
    } else {
      toast(res?.data?.message || 'Failed to send notification', 'error');
    }
    this.disabled = false;
    this.innerHTML = '<i class="ti ti-send"></i> Send Now';
  });

  // ── History ──
  async function loadHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '<div class="loading-state"><div class="loader"></div>Loading history...</div>';

    const data = await apiGet('/notifications/history');
    const items = Array.isArray(data) ? data : [];
    document.getElementById('historyCount').textContent = items.length + ' notification'+(items.length!==1?'s':'');

    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><i class="ti ti-bell-off"></i>No notifications sent yet</div>';
      return;
    }

    list.innerHTML = items.map((n, idx) => {
      const chCls = (n.channel||'push').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'push';
      const chIcon = chCls === 'whatsapp' ? 'ti-brand-whatsapp' : 'ti-bell-ringing';
      const audience = n.targetAll ? 'All members' : formatAudience(n.recipientNames || []);
      const count = n.recipientCount || n.recipientNames?.length || 0;

      return `<div class="hist-item" data-idx="${idx}">
        <div class="hist-row">
          <div class="hist-ch ${chCls}"><i class="ti ${chIcon}"></i></div>
          <div class="hist-info">
            <div class="hist-title">${esc(n.titleEn||n.title||'Notification')}</div>
            <div class="hist-audience">${audience}</div>
          </div>
          <div class="hist-meta">
            <div class="hist-date">${timeAgo(n.sentAtUtc||n.createdAtUtc)}</div>
            <div class="hist-recipients"><i class="ti ti-users"></i>${count}</div>
          </div>
        </div>
      </div>
      <div class="hist-expanded" id="histExp${idx}">
        <div class="hist-msg"><div class="hist-msg-label">English</div><div class="hist-msg-text">${esc(n.bodyEn||n.body||'')}</div></div>
        <div class="hist-msg"><div class="hist-msg-label">العربية</div><div class="hist-msg-text ar">${esc(n.bodyAr||'')}</div></div>
      </div>`;
    }).join('');

    // Expand/collapse
    list.querySelectorAll('.hist-item').forEach(item => {
      item.addEventListener('click', function() {
        const exp = document.getElementById('histExp'+this.dataset.idx);
        exp.classList.toggle('show');
      });
    });
  }

  function formatAudience(names) {
    if (!names || !names.length) return 'All members';
    if (names.length === 1) return esc(names[0]);
    return esc(names[0]) + ' + ' + (names.length-1) + ' other'+(names.length>2?'s':'');
  }

  // ── Member View ──
  const viewToggle = document.getElementById('viewToggle');
  viewToggle.addEventListener('click', function() {
    const memberView = document.getElementById('memberView');
    const adminView = document.getElementById('adminView');
    const isActive = this.classList.toggle('active');
    if (isActive) {
      adminView.style.display = 'none';
      memberView.style.display = 'block';
      this.innerHTML = '<i class="ti ti-layout-dashboard"></i> Admin View';
      loadMemberView();
    } else {
      adminView.style.display = 'block';
      memberView.style.display = 'none';
      this.innerHTML = '<i class="ti ti-device-mobile"></i> Member View';
    }
  });

  document.getElementById('backToAdmin').addEventListener('click', function() {
    viewToggle.click();
  });

  async function loadMemberView() {
    const list = document.getElementById('phoneList');
    list.innerHTML = '<div class="loading-state"><div class="loader"></div>Loading...</div>';

    const data = await apiGet('/notifications/history');
    const items = Array.isArray(data) ? data : [];
    const unread = items.filter(n => !n.isRead).length;
    document.getElementById('unreadBadge').textContent = unread;

    if (!items.length) {
      list.innerHTML = '<div class="empty-state" style="padding:40px"><i class="ti ti-bell-off"></i>No notifications</div>';
      return;
    }

    list.innerHTML = items.map(n => {
      const isRead = n.isRead !== false;
      return `<div class="phone-notif-item ${isRead?'read':'unread'}">
        <div class="pni-dot"></div>
        <div class="pni-content">
          <div class="pni-title">${esc(n.titleEn||n.title||'Notification')}</div>
          <div class="pni-body">${esc(n.bodyEn||n.body||'')}</div>
          <div class="pni-time">${timeAgo(n.sentAtUtc||n.createdAtUtc)}</div>
        </div>
        <span class="pni-read-badge ${isRead?'read':'unread'}">${isRead?'Read':'New'}</span>
      </div>`;
    }).join('');
  }

  // ── Init ──
  loadHistory();
})();
