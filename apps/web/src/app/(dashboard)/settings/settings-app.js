(function () {
  const user = window.__gfpSettingsUser || (function () {
    try {
      return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user'));
    } catch (e) {
      return null;
    }
  })();
  const role = String((user && user.role) || '').toLowerCase();
  const isOwner = role === 'owner';

  const apiGet = window.apiGet;
  const apiPut = window.apiPut;
  const apiDelete = window.apiDelete;
  const apiUpload = window.apiUpload;

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
      return new URL(window.API_BASE || 'https://localhost:5001/api').origin;
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

  var logoObjectUrl = null;

  function revokeLogoObjectUrl() {
    if (logoObjectUrl) {
      try {
        URL.revokeObjectURL(logoObjectUrl);
      } catch (e) { /* ignore */ }
      logoObjectUrl = null;
    }
  }

  function mediaUrl(url) {
    if (!url) return '';
    var u = String(url).trim();
    if (!u) return '';
    if (/^(https?:|blob:|data:)/i.test(u)) return u;
    var origin = apiOrigin();
    return origin + (u.charAt(0) === '/' ? u : '/' + u);
  }

  function candidateLogoUrls(url) {
    var u = String(url || '').trim();
    if (!u) return [];
    if (/^(blob:|data:)/i.test(u)) return [u];
    if (/^https?:\/\//i.test(u)) return [u];
    var path = u.charAt(0) === '/' ? u : '/' + u;
    var list = [];
    var origin = apiOrigin();
    if (origin) list.push(origin + path);
    // Dev fallback: FE often uses ngrok API_BASE while uploads land on local API.
    if (list.indexOf('https://localhost:5001' + path) < 0) list.push('https://localhost:5001' + path);
    if (list.indexOf('http://localhost:5001' + path) < 0) list.push('http://localhost:5001' + path);
    return list;
  }

  async function resolveLogoDisplayUrl(url) {
    var candidates = candidateLogoUrls(url);
    if (!candidates.length) return '';
    if (/^(blob:|data:)/i.test(candidates[0])) return candidates[0];

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      try {
        var res = await fetch(candidate, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
          mode: 'cors',
          cache: 'no-store'
        });
        if (!res.ok) continue;
        var blob = await res.blob();
        if (!blob || !String(blob.type || '').startsWith('image/')) continue;
        revokeLogoObjectUrl();
        logoObjectUrl = URL.createObjectURL(blob);
        return logoObjectUrl;
      } catch (e) {
        /* try next */
      }
    }
    // Last resort: direct URL (may work without CORS/fetch)
    return candidates[0] || '';
  }

  function applyBrandPreview() {
    var primary = (document.getElementById('brandPrimary') || {}).value || '#7ACC00';
    var secondary = (document.getElementById('brandSecondary') || {}).value || '#148F8F';
    var accent = (document.getElementById('brandAccent') || {}).value || '#A0E040';
    var card = (document.getElementById('cardPrimary') || {}).value || primary;
    var name = ((document.getElementById('gymName') || {}).value || '').trim() || 'Gym';
    var nameAr = ((document.getElementById('gymNameAr') || {}).value || '').trim();
    var rawLogo = ((document.getElementById('gymLogoUrl') || {}).value || '').trim();
    var logoImg = document.querySelector('#logoPreview img');
    var logo = (logoImg && logoImg.getAttribute('src')) || mediaUrl(rawLogo);
    var showLogo = !!(document.getElementById('showGymLogoOnCard') || {}).checked && !!rawLogo && !!logo;

    document.documentElement.style.setProperty('--l500', primary);
    document.documentElement.style.setProperty('--l400', accent);
    try {
      if (window.GfpBranding && typeof window.GfpBranding.apply === 'function') {
        window.GfpBranding.apply({
          gymName: name,
          gymNameAr: nameAr,
          shortName: ((document.getElementById('gymShortName') || {}).value || '').trim() || null,
          logoUrl: rawLogo || null,
          primaryColor: primary,
          secondaryColor: secondary,
          accentColor: accent,
          cardPrimaryColor: card,
          showGymLogoOnCard: !!(document.getElementById('showGymLogoOnCard') || {}).checked
        });
      }
    } catch (e) { /* ignore */ }

    var mark = document.getElementById('brandLiveMark');
    if (mark) mark.style.background = primary;
    var liveName = document.getElementById('brandLiveName');
    if (liveName) liveName.textContent = name;
    var cta = document.getElementById('brandLiveCta');
    if (cta) cta.style.background = primary;
    var sec = document.getElementById('brandLiveSec');
    if (sec) sec.style.background = secondary;
    var acc = document.getElementById('brandLiveAcc');
    if (acc) {
      acc.style.borderColor = accent;
      acc.style.color = '#0D0D0D';
    }

    var cr80Gym = document.getElementById('cr80Gym');
    var cr80GymAr = document.getElementById('cr80GymAr');
    var cr80Mark = document.getElementById('cr80Mark');
    var cr80Logo = document.getElementById('cr80Logo');
    if (cr80Gym) cr80Gym.textContent = name;
    if (cr80GymAr) {
      cr80GymAr.textContent = nameAr;
      cr80GymAr.style.display = nameAr ? '' : 'none';
    }
    if (cr80Mark) {
      cr80Mark.style.background = card;
      cr80Mark.hidden = showLogo;
    }
    if (cr80Logo) {
      if (showLogo) {
        cr80Logo.src = logo;
        cr80Logo.hidden = false;
      } else {
        cr80Logo.removeAttribute('src');
        cr80Logo.hidden = true;
      }
    }
  }

  async function setLogoPreview(url) {
    var preview = document.getElementById('logoPreview');
    var clearBtn = document.getElementById('logoClear');
    var raw = String(url || '').trim();
    if (!raw) {
      revokeLogoObjectUrl();
      if (preview) preview.innerHTML = '<i class="ti ti-photo"></i>';
      if (clearBtn) clearBtn.style.display = 'none';
      applyBrandPreview();
      return;
    }
    if (preview) {
      preview.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i>';
    }
    var display = await resolveLogoDisplayUrl(raw);
    if (preview) {
      if (display) {
        preview.innerHTML =
          '<img src="' +
          display +
          '" alt="Logo" onerror="this.parentNode.innerHTML=\'<i class=\\\'ti ti-photo-off\\\'></i>\'">';
      } else {
        preview.innerHTML = '<i class="ti ti-photo-off"></i>';
      }
    }
    if (clearBtn) clearBtn.style.display = raw ? '' : 'none';
    applyBrandPreview();
  }

  function populateForm(s) {
    const set = function (id, val) {
      const el = document.getElementById(id);
      if (el) el.value = val == null ? '' : val;
    };
    set('gymName', s.gymName || s.GymName || '');
    set('gymNameAr', s.gymNameAr || s.GymNameAr || '');
    set('gymShortName', s.shortName || s.ShortName || '');
    set('gymPhone', s.phoneNumber || s.PhoneNumber || '');
    set('gymEmail', s.email || s.Email || '');
    set('gymWebsite', s.website || s.Website || '');
    set('gymAddress', s.address || s.Address || '');
    set('gymLogoUrl', s.logoUrl || s.LogoUrl || '');
    set('brandPrimary', s.primaryColor || s.PrimaryColor || '#7ACC00');
    set('brandSecondary', s.secondaryColor || s.SecondaryColor || '#148F8F');
    set('brandAccent', s.accentColor || s.AccentColor || '#A0E040');
    set('cardPrimary', s.cardPrimaryColor || s.CardPrimaryColor || s.primaryColor || '#7ACC00');
    var showLogo = s.showGymLogoOnCard;
    if (showLogo == null) showLogo = s.ShowGymLogoOnCard;
    if (showLogo == null) showLogo = true;
    var showEl = document.getElementById('showGymLogoOnCard');
    if (showEl) showEl.checked = !!showLogo;

    setGymCodeDisplay(s.gymCode || s.GymCode);
    setLogoPreview(s.logoUrl || s.LogoUrl || '');

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

  const BRAND_DEFAULTS = {
    primaryColor: '#7ACC00',
    secondaryColor: '#148F8F',
    accentColor: '#A0E040',
    cardPrimaryColor: '#7ACC00',
    showGymLogoOnCard: true
  };

  function readIdentityBody() {
    var website = ((document.getElementById('gymWebsite') || {}).value || '').trim();
    if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
    return {
      gymName: ((document.getElementById('gymName') || {}).value || '').trim(),
      gymNameAr: ((document.getElementById('gymNameAr') || {}).value || '').trim(),
      shortName: ((document.getElementById('gymShortName') || {}).value || '').trim() || null,
      phoneNumber: ((document.getElementById('gymPhone') || {}).value || '').trim() || null,
      email: ((document.getElementById('gymEmail') || {}).value || '').trim() || null,
      website: website || null,
      address: ((document.getElementById('gymAddress') || {}).value || '').trim() || null,
      logoUrl: ((document.getElementById('gymLogoUrl') || {}).value || '').trim() || null,
      primaryColor: ((document.getElementById('brandPrimary') || {}).value || '').trim() || null,
      secondaryColor: ((document.getElementById('brandSecondary') || {}).value || '').trim() || null,
      accentColor: ((document.getElementById('brandAccent') || {}).value || '').trim() || null,
      cardPrimaryColor: ((document.getElementById('cardPrimary') || {}).value || '').trim() || null,
      showGymLogoOnCard: !!(document.getElementById('showGymLogoOnCard') || {}).checked
    };
  }

  function applyBrandDefaultsToForm() {
    var set = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val;
    };
    set('brandPrimary', BRAND_DEFAULTS.primaryColor);
    set('brandSecondary', BRAND_DEFAULTS.secondaryColor);
    set('brandAccent', BRAND_DEFAULTS.accentColor);
    set('cardPrimary', BRAND_DEFAULTS.cardPrimaryColor);
    var showEl = document.getElementById('showGymLogoOnCard');
    if (showEl) showEl.checked = BRAND_DEFAULTS.showGymLogoOnCard;
    applyBrandPreview();
  }

  async function saveIdentity(opts) {
    opts = opts || {};
    if (!isOwner) return false;
    var btn = document.getElementById('btnSave');
    var resetBtns = [document.getElementById('btnResetBrand'), document.getElementById('btnResetBrandFooter')];
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i> Saving...';
    }
    resetBtns.forEach(function (b) {
      if (b) b.disabled = true;
    });

    var body = readIdentityBody();
    if (!body.gymName || !body.gymNameAr) {
      toast('Gym name (EN + AR) is required', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> Save Changes';
      }
      resetBtns.forEach(function (b) {
        if (b) b.disabled = false;
      });
      return false;
    }

    var res = await apiPut('/settings', body);
    if (res && res.ok && res.data) {
      toast(opts.successToast || 'Design saved for this gym');
      populateForm(res.data);
      populateStatus(res.data);
      if (window.GfpBranding && typeof window.GfpBranding.apply === 'function') {
        try {
          await window.GfpBranding.apply(res.data);
        } catch (err) { /* ignore */ }
      } else {
        applyBrandPreview();
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> Save Changes';
      }
      resetBtns.forEach(function (b) {
        if (b) b.disabled = false;
      });
      return true;
    }

    var errMsg =
      (res && res.data && (res.data.message || res.data.error)) ||
      (res && res.status ? 'Save failed (' + res.status + ')' : 'Save failed — check API connection');
    toast(errMsg, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-device-floppy"></i> Save Changes';
    }
    resetBtns.forEach(function (b) {
      if (b) b.disabled = false;
    });
    return false;
  }

  async function resetBrandDefaults() {
    if (!isOwner) return;
    if (
      !window.confirm(
        'Reset brand colors to GymFlowPro defaults?\n\nThis restores Primary / Secondary / Accent / Card mark and keeps your gym name & logo. Changes will be saved.'
      )
    ) {
      return;
    }
    applyBrandDefaultsToForm();
    await saveIdentity({ successToast: 'Defaults restored for this gym' });
  }

  const infoForm = document.getElementById('infoForm');
  if (infoForm) {
    infoForm.setAttribute('novalidate', 'novalidate');
    infoForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      await saveIdentity();
    });
  }

  [document.getElementById('btnResetBrand'), document.getElementById('btnResetBrandFooter')].forEach(
    function (btn) {
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        resetBrandDefaults();
      });
      if (!isOwner) btn.style.display = 'none';
    }
  );

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

  // ── Logo upload (tenant-scoped) ──
  const logoUpload = document.getElementById('logoUpload');
  const logoFile = document.getElementById('logoFile');
  const logoBrowse = document.getElementById('logoBrowse');
  const logoClear = document.getElementById('logoClear');
  if (logoBrowse && logoFile) {
    logoBrowse.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isOwner) return;
      logoFile.click();
    });
  }
  if (logoUpload && logoFile) {
    logoUpload.addEventListener('click', function (e) {
      if (!isOwner) return;
      if (e.target && (e.target.id === 'logoClear' || (e.target.closest && e.target.closest('#logoClear')))) return;
      logoFile.click();
    });
  }
  if (logoFile) {
    logoFile.addEventListener('change', async function () {
      if (!this.files.length || !isOwner) return;
      await handleLogoFile(this.files[0]);
      this.value = '';
    });
  }
  if (logoClear) {
    logoClear.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isOwner) return;
      const res = await apiDelete('/settings/logo');
      if (res && res.ok) {
        document.getElementById('gymLogoUrl').value = '';
        setLogoPreview('');
        toast('Logo removed');
      } else {
        toast((res && res.data && (res.data.message || res.data.error)) || 'Failed to remove logo', 'error');
      }
    });
  }

  async function handleLogoFile(file) {
    if (!file.type || !/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type)) {
      toast('Only JPEG/PNG/WebP/GIF', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('File too large. Max 2MB', 'error');
      return;
    }
    toast('Uploading logo…');
    const res = await apiUpload('/settings/logo', file);
    if (!res || !res.ok) {
      toast((res && res.data && (res.data.message || res.data.error)) || 'Upload failed', 'error');
      return;
    }
    const url =
      (res.data && (res.data.relativeUrl || res.data.logoUrl || res.data.LogoUrl)) || '';
    document.getElementById('gymLogoUrl').value = url;
    setLogoPreview(url);
    toast('Logo uploaded');
  }

  ['brandPrimary', 'brandSecondary', 'brandAccent', 'cardPrimary', 'gymName', 'gymNameAr'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', applyBrandPreview);
  });
  var showLogoEl = document.getElementById('showGymLogoOnCard');
  if (showLogoEl) showLogoEl.addEventListener('change', applyBrandPreview);

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

  // ── QR poster (any authenticated) ──
  // API returns /qr-posters/{gymCode}.pdf but those files were never generated (404).
  // Always render a live poster from the gym code (what members scan → qr-checkin).
  let posterUrl = '';
  let posterDataUrl = '';
  let posterGymCode = '';

  function currentGymCode() {
    const qr = document.getElementById('qrGymCode');
    const chip = document.getElementById('gymCodeChip');
    const fromQr = qr && qr.textContent ? qr.textContent.trim() : '';
    const fromChip = chip && chip.textContent ? chip.textContent.trim() : '';
    const code = fromQr && fromQr !== '—' ? fromQr : fromChip;
    return code && code !== '—' ? code : '';
  }

  function currentGymName() {
    const el = document.getElementById('gymName');
    if (el && el.value && el.value.trim()) return el.value.trim();
    const brand = document.querySelector('.gym-name, #gymNameDisplay');
    if (brand && brand.textContent && brand.textContent.trim()) return brand.textContent.trim();
    try {
      const u = JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user') || 'null');
      if (u && u.gymName) return String(u.gymName);
    } catch (e) { /* ignore */ }
    return 'GymFlowPro';
  }

  async function renderLiveQrPoster(gymCode) {
    const frame = document.getElementById('qrFrame');
    if (!frame || !gymCode) return false;
    posterGymCode = gymCode;
    const gymName = currentGymName();
    frame.innerHTML =
      '<div class="qr-poster-live" id="qrPosterLive">' +
      '<div class="poster-brand"></div>' +
      '<div class="poster-sub">Scan to check in</div>' +
      '<canvas id="qrPosterCanvas" width="220" height="220"></canvas>' +
      '<div class="poster-code"></div>' +
      '<div class="poster-hint">Open GymFlowPro → scan this code<br>Encodes gym code for attendance</div>' +
      '</div>';
    frame.querySelector('.poster-brand').textContent = gymName;
    frame.querySelector('.poster-code').textContent = gymCode;

    const canvas = document.getElementById('qrPosterCanvas');
    if (!canvas) return false;

    if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
      await new Promise(function (resolve, reject) {
        window.QRCode.toCanvas(
          canvas,
          gymCode,
          { width: 220, margin: 2, color: { dark: '#0D0D0D', light: '#FFFFFF' } },
          function (err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } else {
      // CDN fallback image if QRCode lib blocked
      const img = document.createElement('img');
      img.className = 'qr-img';
      img.alt = 'QR ' + gymCode;
      img.src =
        'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=' +
        encodeURIComponent(gymCode);
      canvas.replaceWith(img);
      await new Promise(function (resolve) {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }

    try {
      const live = document.getElementById('qrPosterLive');
      if (canvas && canvas.toDataURL) {
        posterDataUrl = canvas.toDataURL('image/png');
      }
      posterUrl = posterDataUrl || '';
      if (!posterUrl && live) {
        // keep empty; print uses live DOM
        posterUrl = 'about:blank';
      }
    } catch (e) {
      posterDataUrl = '';
    }
    return true;
  }

  async function loadQRPoster() {
    const frame = document.getElementById('qrFrame');
    if (!frame) return;
    const gymCode = currentGymCode();
    if (!gymCode) {
      frame.innerHTML =
        '<div class="qr-loading"><i class="ti ti-qrcode" style="font-size:64px;color:var(--ls4);display:block;margin-bottom:12px"></i>' +
        '<div style="color:var(--ltt);font-size:12px">Gym code unavailable — cannot build QR poster</div></div>';
      return;
    }
    try {
      await renderLiveQrPoster(gymCode);
    } catch (e) {
      frame.innerHTML =
        '<div class="qr-loading"><i class="ti ti-qrcode" style="font-size:64px;color:var(--ls4);display:block;margin-bottom:12px"></i>' +
        '<div style="color:var(--ltt);font-size:12px">Could not build QR poster</div></div>';
    }
  }

  const btnDownload = document.getElementById('btnDownloadQR');
  if (btnDownload) {
    btnDownload.addEventListener('click', function () {
      const code = posterGymCode || currentGymCode();
      if (!code) { toast('No gym code for poster', 'error'); return; }
      if (posterDataUrl) {
        const a = document.createElement('a');
        a.href = posterDataUrl;
        a.download = 'gymflowpro-qr-' + code + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast('QR image downloaded');
        return;
      }
      // Printable HTML fallback
      const w = window.open('', '_blank');
      if (!w) { toast('Popup blocked — allow popups to download/print', 'error'); return; }
      const live = document.getElementById('qrPosterLive');
      w.document.write(
        '<!DOCTYPE html><html><head><title>QR Poster ' + code + '</title>' +
        '<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;padding:40px;background:#f3f4f3}' +
        '.card{background:#fff;padding:32px;border-radius:16px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.08)}' +
        'h1{margin:0 0 8px;font-size:22px} .code{margin-top:16px;font-family:monospace;font-size:18px;font-weight:700;' +
        'background:#0D0D0D;color:#7ACC00;display:inline-block;padding:8px 14px;border-radius:8px} canvas,img{margin:12px auto}</style></head><body>' +
        '<div class="card">' + (live ? live.innerHTML : '') + '</div></body></html>'
      );
      w.document.close();
      toast('Poster opened — use Save / Print from the browser');
    });
  }

  const btnPrint = document.getElementById('btnPrintQR');
  if (btnPrint) {
    btnPrint.addEventListener('click', function () {
      const live = document.getElementById('qrPosterLive');
      const code = posterGymCode || currentGymCode();
      if (!live || !code) { toast('No QR poster to print', 'error'); return; }
      const w = window.open('', '_blank');
      if (!w) { toast('Popup blocked — allow popups to print', 'error'); return; }
      w.document.write(
        '<!DOCTYPE html><html><head><title>Print QR ' + code + '</title>' +
        '<style>@page{margin:16mm} body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:90vh}' +
        '.card{text-align:center} h1{font-size:28px;margin:0 0 8px} .sub{color:#666;margin-bottom:20px}' +
        '.code{margin-top:18px;font-family:monospace;font-size:20px;font-weight:700;letter-spacing:.08em;' +
        'background:#0D0D0D;color:#7ACC00;display:inline-block;padding:10px 16px;border-radius:8px}' +
        '.hint{margin-top:14px;color:#666;font-size:13px} canvas,img{width:280px;height:280px}</style></head><body>' +
        '<div class="card">' + live.innerHTML + '</div>' +
        '<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script>' +
        '</body></html>'
      );
      w.document.close();
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
