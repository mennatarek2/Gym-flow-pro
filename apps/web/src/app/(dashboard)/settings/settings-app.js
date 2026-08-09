(function () {
  const role = String((user && user.role) || '').toLowerCase();
  const isOwner = role === 'owner';

  function toast(msg, type) {
    type = type || 'success';
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerHTML = '<i class="ti ' + (type === 'success' ? 'ti-check' : 'ti-alert-circle') + '"></i>' + msg;
    t.className = 'toast ' + type + ' show';
    setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  function fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function apiOrigin() {
    try {
      return new URL(API_BASE).origin;
    } catch (e) {
      return '';
    }
  }

  function resolvePosterUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const origin = apiOrigin();
    if (path.charAt(0) === '/') return origin + path;
    return origin + '/' + path;
  }

  function setGymCodeDisplay(code) {
    const text = (code && String(code).trim()) ? String(code).trim() : '—';
    const chip = document.getElementById('gymCodeChip');
    const qr = document.getElementById('qrGymCode');
    if (chip) chip.textContent = text;
    if (qr) qr.textContent = text;
  }

  // ── Tabs ──
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      const panel = document.getElementById('tab-' + this.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });

  const tabBtnTax = document.getElementById('tabBtnTax');
  const tabBtnInvAlerts = document.getElementById('tabBtnInvAlerts');
  if (isOwner) {
    if (tabBtnTax) tabBtnTax.style.display = 'flex';
    if (tabBtnInvAlerts) tabBtnInvAlerts.style.display = 'flex';
  } else {
    if (tabBtnTax) tabBtnTax.style.display = 'none';
    if (tabBtnInvAlerts) tabBtnInvAlerts.style.display = 'none';
    const gate = document.getElementById('infoOwnerGate');
    if (gate) gate.style.display = 'flex';
    const infoForm = document.getElementById('infoForm');
    if (infoForm) {
      infoForm.querySelectorAll('input, textarea, button[type="submit"]').forEach(function (el) {
        if (el.id === 'copyCode') return;
        if (el.type === 'file' || el.id === 'logoBrowse') {
          el.disabled = true;
          return;
        }
        if (el.tagName === 'BUTTON' && el.type === 'submit') {
          el.style.display = 'none';
          return;
        }
        el.readOnly = true;
        el.disabled = true;
      });
    }
    const logoBrowse = document.getElementById('logoBrowse');
    if (logoBrowse) logoBrowse.style.display = 'none';
    const infoBtn = document.querySelector('.tab-btn[data-tab="info"]');
    const qrBtn = document.querySelector('.tab-btn[data-tab="qr"]');
    const tabInfo = document.getElementById('tab-info');
    const tabQr = document.getElementById('tab-qr');
    if (infoBtn) infoBtn.classList.remove('active');
    if (tabInfo) tabInfo.classList.remove('active');
    if (qrBtn) qrBtn.classList.add('active');
    if (tabQr) tabQr.classList.add('active');
  }

  // ── Gym code (any authenticated) ──
  async function loadGymCode() {
    const data = await apiGet('/settings/gym-code');
    if (data && (data.gymCode || data.GymCode)) {
      setGymCodeDisplay(data.gymCode || data.GymCode);
      return;
    }
    // Keep whatever Owner /settings already painted; only fall back if still blank
    const chip = document.getElementById('gymCodeChip');
    if (!chip || !chip.textContent || chip.textContent === '—') {
      setGymCodeDisplay(null);
    }
  }

  // ── Owner settings ──
  async function loadSettings() {
    if (!isOwner) return;
    const data = await apiGet('/settings');
    if (!data) {
      toast('Could not load gym settings', 'error');
      return;
    }
    populateForm(data);
    populateStatus(data);
  }

  function populateForm(s) {
    const set = function (id, val) {
      const el = document.getElementById(id);
      if (el) el.value = val == null ? '' : val;
    };
    set('gymName', s.gymName || s.GymName || '');
    set('gymNameAr', s.gymNameAr || s.GymNameAr || '');
    set('gymPhone', s.phoneNumber || s.PhoneNumber || '');
    set('gymAddress', s.address || s.Address || '');
    set('gymLogoUrl', s.logoUrl || s.LogoUrl || '');
    // gymCode display-only — never bound to a writable input
    setGymCodeDisplay(s.gymCode || s.GymCode);

    const logoUrl = s.logoUrl || s.LogoUrl;
    const preview = document.getElementById('logoPreview');
    if (preview && logoUrl && (String(logoUrl).indexOf('http') === 0 || String(logoUrl).indexOf('data:') === 0)) {
      preview.innerHTML = '<img src="' + logoUrl + '" alt="Gym Logo">';
    }
    const metaCreated = document.getElementById('metaCreated');
    const metaUpdated = document.getElementById('metaUpdated');
    if (metaCreated) {
      metaCreated.innerHTML = '<i class="ti ti-calendar"></i> Created: ' + fmtDate(s.createdAtUtc || s.CreatedAtUtc);
    }
    if (metaUpdated) {
      metaUpdated.innerHTML = '<i class="ti ti-refresh"></i> Updated: ' + fmtDate(s.updatedAtUtc || s.UpdatedAtUtc);
    }
  }

  function populateStatus(s) {
    const statusEl = document.getElementById('tenantStatus');
    const active = s.isActive !== false && s.IsActive !== false;
    if (statusEl && !active) {
      statusEl.innerHTML = '<span class="st-dot" style="background:var(--dng500)"></span>Inactive';
      statusEl.style.background = 'var(--dng100)';
      statusEl.style.color = 'var(--dng500)';
    }
    const tid = document.getElementById('tenantId');
    if (tid) tid.textContent = s.tenantId || s.TenantId || user.tenantId || '';
  }

  const infoForm = document.getElementById('infoForm');
  if (infoForm) {
    infoForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!isOwner) return;
      const btn = document.getElementById('btnSave');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Saving...';
      }

      const body = {
        gymName: ((document.getElementById('gymName') || {}).value || '').trim(),
        gymNameAr: ((document.getElementById('gymNameAr') || {}).value || '').trim(),
        phoneNumber: ((document.getElementById('gymPhone') || {}).value || '').trim() || null,
        address: ((document.getElementById('gymAddress') || {}).value || '').trim() || null,
        logoUrl: ((document.getElementById('gymLogoUrl') || {}).value || '').trim() || null
      };

      const res = await apiPut('/settings', body);
      if (res && res.ok) {
        toast('Settings saved successfully');
        loadSettings();
      } else {
        toast((res && res.data && (res.data.message || res.data.error)) || 'Failed to save', 'error');
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> Save Changes';
      }
    });
  }

  const copyCode = document.getElementById('copyCode');
  if (copyCode) {
    copyCode.addEventListener('click', function () {
      const code = (document.getElementById('gymCodeChip') || {}).textContent;
      if (code && code !== '—') {
        const btn = this;
        navigator.clipboard.writeText(code).then(function () {
          btn.classList.add('copied');
          btn.innerHTML = '<i class="ti ti-check"></i>';
          toast('Gym code copied!');
          setTimeout(function () {
            btn.classList.remove('copied');
            btn.innerHTML = '<i class="ti ti-copy"></i>';
          }, 2000);
        });
      }
    });
  }

  // ── Logo preview helpers ──
  const logoUpload = document.getElementById('logoUpload');
  const logoFile = document.getElementById('logoFile');
  const logoBrowse = document.getElementById('logoBrowse');
  if (logoBrowse && logoFile) {
    logoBrowse.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isOwner) return;
      logoFile.click();
    });
  }
  if (logoUpload && logoFile) {
    logoUpload.addEventListener('click', function () {
      if (!isOwner) return;
      logoFile.click();
    });
  }
  if (logoFile) {
    logoFile.addEventListener('change', function () {
      if (this.files.length) handleLogoFile(this.files[0]);
    });
  }
  const logoUrlInput = document.getElementById('gymLogoUrl');
  if (logoUrlInput) {
    logoUrlInput.addEventListener('change', function () {
      const v = this.value.trim();
      const preview = document.getElementById('logoPreview');
      if (preview && v && (v.indexOf('http') === 0 || v.indexOf('data:') === 0)) {
        preview.innerHTML = '<img src="' + v + '" alt="Logo preview">';
      }
    });
  }

  function handleLogoFile(file) {
    if (!file.type.startsWith('image/')) { toast('Please select an image file', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('File too large. Max 2MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = function (e) {
      const preview = document.getElementById('logoPreview');
      if (preview) preview.innerHTML = '<img src="' + e.target.result + '" alt="Logo preview">';
      toast('Local preview only — paste a hosted URL in Logo URL to save.');
    };
    reader.readAsDataURL(file);
  }

  // ── Tax / VAT (Owner only, audited server-side) ──
  async function loadTax() {
    if (!isOwner) return;
    const data = await apiGet('/settings/tax');
    if (!data) return;
    const vatEl = document.getElementById('vatEnabled');
    if (vatEl) vatEl.checked = !!(data.vatEnabled != null ? data.vatEnabled : data.VatEnabled);
    const raw = data.vatRate != null ? data.vatRate : data.VatRate;
    const rate = typeof raw === 'number' ? raw : parseFloat(raw);
    const pctEl = document.getElementById('vatRatePct');
    if (pctEl) pctEl.value = isFinite(rate) ? (rate <= 1 ? (rate * 100) : rate) : '';
    const reg = document.getElementById('taxRegNo');
    if (reg) reg.value = data.taxRegistrationNumber || data.TaxRegistrationNumber || '';
    const foot = document.getElementById('invoiceFooter');
    if (foot) foot.value = data.invoiceFooterText || data.InvoiceFooterText || '';
    const footAr = document.getElementById('invoiceFooterAr');
    if (footAr) footAr.value = data.invoiceFooterTextAr || data.InvoiceFooterTextAr || '';
  }

  const taxForm = document.getElementById('taxForm');
  if (taxForm) {
    taxForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!isOwner) return;
      const btn = document.getElementById('btnSaveTax');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Saving...';
      }

      let pct = parseFloat((document.getElementById('vatRatePct') || {}).value);
      if (!isFinite(pct) || pct < 0) pct = 0;
      if (pct > 100) pct = 100;

      const body = {
        vatEnabled: !!(document.getElementById('vatEnabled') || {}).checked,
        vatRate: pct / 100,
        taxRegistrationNumber: ((document.getElementById('taxRegNo') || {}).value || '').trim() || null,
        invoiceFooterText: ((document.getElementById('invoiceFooter') || {}).value || '').trim() || null,
        invoiceFooterTextAr: ((document.getElementById('invoiceFooterAr') || {}).value || '').trim() || null
      };

      const res = await apiPut('/settings/tax', body);
      if (res && res.ok) {
        toast('Tax settings saved (audited)');
        loadTax();
      } else {
        toast((res && res.data && (res.data.message || res.data.error)) || 'Failed to save tax settings', 'error');
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> Save Tax Settings';
      }
    });
  }

  // ── Inventory alerts (Owner only, INVS-10) ──
  async function loadInvAlerts() {
    if (!isOwner) return;
    const data = await apiGet('/settings/inventory-alerts');
    if (!data) return;
    const roles = data.lowStockNotifyRoles || data.LowStockNotifyRoles || [];
    const windows = data.expiryWindowsDays || data.ExpiryWindowsDays || [];
    const rolesEl = document.getElementById('invNotifyRoles');
    const winEl = document.getElementById('invExpiryWindows');
    if (rolesEl) rolesEl.value = Array.isArray(roles) ? roles.join(', ') : '';
    if (winEl) winEl.value = Array.isArray(windows) ? windows.join(', ') : '';
  }

  const invAlertsForm = document.getElementById('invAlertsForm');
  if (invAlertsForm) {
    invAlertsForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!isOwner) return;
      const btn = document.getElementById('btnSaveInvAlerts');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Saving...';
      }
      const rolesRaw = ((document.getElementById('invNotifyRoles') || {}).value || '').trim();
      const winRaw = ((document.getElementById('invExpiryWindows') || {}).value || '').trim();
      const body = {
        lowStockNotifyRoles: rolesRaw
          ? rolesRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
          : ['Owner', 'Manager'],
        expiryWindowsDays: winRaw
          ? winRaw.split(',').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return n > 0; })
          : [90, 30, 7]
      };
      const res = await apiPut('/settings/inventory-alerts', body);
      if (res && res.ok) {
        toast('Inventory alert settings saved');
        loadInvAlerts();
      } else {
        toast((res && res.data && (res.data.message || res.data.error)) || 'Failed to save alert settings', 'error');
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> Save alert settings';
      }
    });
  }

  // ── QR poster (any authenticated) → { qrPosterUrl } ──
  let posterUrl = '';

  async function loadQRPoster() {
    const frame = document.getElementById('qrFrame');
    if (!frame) return;
    try {
      const data = await apiGet('/settings/qr-poster');
      const path = data && (data.qrPosterUrl || data.QrPosterUrl);
      if (!path) {
        frame.innerHTML = '<div class="qr-loading"><i class="ti ti-qrcode" style="font-size:64px;color:var(--ls4);display:block;margin-bottom:12px"></i><div style="color:var(--ltt);font-size:12px">QR poster not available</div></div>';
        return;
      }
      posterUrl = resolvePosterUrl(path);
      const isPdf = /\.pdf(\?|$)/i.test(posterUrl);
      if (isPdf) {
        frame.innerHTML =
          '<div class="qr-pdf">' +
          '<i class="ti ti-file-type-pdf" style="font-size:48px;color:var(--dng500)"></i>' +
          '<div class="qr-pdf-title">QR check-in poster (PDF)</div>' +
          '<a class="qr-pdf-link" href="' + posterUrl + '" target="_blank" rel="noopener">Open poster</a>' +
          '<iframe class="qr-pdf-frame" src="' + posterUrl + '" title="QR Poster"></iframe>' +
          '</div>';
      } else {
        frame.innerHTML = '<img src="' + posterUrl + '" alt="QR Poster">';
      }
    } catch (e) {
      frame.innerHTML = '<div class="qr-loading"><i class="ti ti-qrcode" style="font-size:64px;color:var(--ls4);display:block;margin-bottom:12px"></i><div style="color:var(--ltt);font-size:12px">Could not load QR poster</div></div>';
    }
  }

  const btnDownload = document.getElementById('btnDownloadQR');
  if (btnDownload) {
    btnDownload.addEventListener('click', function () {
      if (!posterUrl) { toast('No poster URL', 'error'); return; }
      const a = document.createElement('a');
      a.href = posterUrl;
      a.target = '_blank';
      a.download = 'gymflowpro-qr-poster' + (/\.pdf(\?|$)/i.test(posterUrl) ? '.pdf' : '');
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Opening poster for download');
    });
  }

  const btnPrint = document.getElementById('btnPrintQR');
  if (btnPrint) {
    btnPrint.addEventListener('click', function () {
      if (!posterUrl) { toast('No QR poster to print', 'error'); return; }
      const w = window.open(posterUrl, '_blank');
      if (!w) { toast('Popup blocked — allow popups to print', 'error'); return; }
      setTimeout(function () {
        try { w.print(); } catch (e) { /* viewer handles print */ }
      }, 800);
    });
  }

  // ── Init (Owner settings first so gymCode is not wiped by a failed gym-code call) ──
  if (user && user.tenantId) {
    const tid = document.getElementById('tenantId');
    if (tid) tid.textContent = user.tenantId;
  }

  (async function init() {
    if (isOwner) {
      await loadSettings();
      await loadTax();
      await loadInvAlerts();
    }
    await loadGymCode();
    await loadQRPoster();
  })();
})();
