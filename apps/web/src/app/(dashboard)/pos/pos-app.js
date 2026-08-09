(function () {
  'use strict';

  const API_BASE = window.API_BASE || 'https://localhost:5001/api';
  const METHODS = ['cash', 'card_paymob', 'fawry', 'vodafone', 'instapay', 'account_credit'];
  function methodLabel(code) {
    const map = {
      cash: t('Cash', 'كاش'),
      card_paymob: t('Card', 'بطاقة'),
      fawry: t('Fawry', 'فوري'),
      vodafone: t('Vodafone Cash', 'فودافون كاش'),
      instapay: t('InstaPay', 'إنستا باي'),
      account_credit: t('Account credit', 'رصيد حساب'),
    };
    return map[code] || code;
  }

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
  }
  function getH(extra) {
    const t = getToken();
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user'));
    } catch (_) {
      return null;
    }
  }
  function decodeJwt(token) {
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_) {
      return null;
    }
  }
  function getPerms() {
    const p = decodeJwt(getToken() || '');
    const set = new Set();
    if (!p) return set;
    const raw = p.perm;
    if (Array.isArray(raw)) raw.forEach((x) => set.add(String(x)));
    else if (raw) set.add(String(raw));
    return set;
  }

  const user = getUser();
  const perms = getPerms();
  const role = (user && user.role) || '';
  const canSell = perms.has('sales.sell') || /Owner|Manager/i.test(role);
  const canDiscount = perms.has('sales.discount.apply') || /Owner/i.test(role);
  const canOverride = perms.has('sales.discount.override') || /Owner/i.test(role);

  let plans = [];
  let selectedMember = null;
  let memberMode = 'existing';
  let promoPreview = null;
  let shiftOk = false;
  /** One key per sale attempt; reused on retry until success. */
  let idempotencyKey = null;
  /** membership | retail */
  let posMode = 'membership';
  let inventoryOn = false;
  /** @type {{ productId: string, sku: string, name: string, qty: number, unitPrice: number, allowFractional: boolean }[]} */
  let retailCart = [];
  /** none | existing | new — for retail walk-in */
  let retailMemberMode = 'none';

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(Number(n));
  }
  function t(en, ar) {
    const I18n = window.GfpI18n;
    if (I18n && I18n.tLabel) return I18n.tLabel(en, ar);
    return en;
  }
  function pickBilingual(detail) {
    const I18n = window.GfpI18n;
    if (!detail) return '';
    if (I18n && I18n.displayBilingualText) return I18n.displayBilingualText(String(detail));
    const raw = String(detail);
    const idx = raw.indexOf(' / ');
    if (idx === -1) return raw;
    const en = raw.slice(0, idx).trim();
    const ar = raw.slice(idx + 3).trim();
    return t(en, ar);
  }
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    el.textContent = msg;
    setTimeout(() => el.classList.remove('show'), 4200);
  }
  function problemMessage(data, status) {
    if (!data) return t('Request failed', 'فشل الطلب') + ' (' + status + ')';
    const title = data.title || '';
    const detail = data.detail || data.message || data.error || '';
    if (title === 'OPEN_SHIFT_REQUIRED')
      return t('Open a cash shift first, then try again.', 'افتح وردية كاش أولاً، بعدين حاول تاني.');
    if (title === 'PAYMENT_INCOMPLETE')
      return t(
        'Paid amount is less than the total. Cover the full total, or turn on partial payment.',
        'المبلغ المدفوع أقل من الإجمالي. كمّل المبلغ، أو فعّل الدفع الجزئي.'
      );
    if (title === 'PROMO_RACE_LOST')
      return t(
        'That promo was just used elsewhere. Clear it, check the code again, then retry.',
        'كود الخصم اتستخدم لتوّه. امسحه، تأكد من الكود، وحاول تاني.'
      );
    if (title === 'FORBIDDEN_DISCOUNT_OVERRIDE')
      return t('You do not have permission to change this discount.', 'مش عندك صلاحية تعدّل الخصم ده.');
    if (title === 'FEATURE_DISABLED')
      return t(
        'Sales are turned off for this gym. Ask the owner to enable them.',
        'المبيعات مقفولة لهذا النادي. اطلب من المالك تفعيلها.'
      );
    if (title === 'INSUFFICIENT_STOCK')
      return (
        pickBilingual(detail) ||
        t('Not enough sellable stock for a product in the cart.', 'الرصيد القابل للبيع مش كفاية لمنتج في السلة.')
      );
    if (title === 'STOCK_UNSELLABLE_EXPIRED')
      return (
        pickBilingual(detail) ||
        t(
          'Stock on hand is expired — cannot sell. Write off expired or receive a new batch.',
          'الكمية الموجودة منتهية — مش هيتباع. اتلف المنتهي أو استلم تشغيلة جديدة.'
        )
      );
    if (title === 'INVENTORY_REQUIRED')
      return t('Inventory must be enabled before retail sales.', 'لازم المخزون يكون متفعّل قبل بيع المنتجات.');
    if (title === 'WAREHOUSE_NOT_FOUND') return t('Warehouse not found.', 'المستودع مش موجود.');
    if (title === 'PRODUCT_NOT_FOUND') return t('Product not found.', 'المنتج مش موجود.');
    if (title === 'MEMBER_REQUIRED') return t('A member is required for this sale.', 'لازم تختار عضو لهذه العملية.');
    if (detail) return pickBilingual(detail) || String(detail);
    if (title && !/^[A-Z][A-Z0-9_]+$/.test(title)) return title;
    return t('Could not complete the sale. Try again or ask a manager.', 'مش قدرنا نتمم البيع. حاول تاني أو اسأل المدير.') +
      (status ? ' (' + status + ')' : '');
  }
  function clearStockBlock() {
    const panel = document.getElementById('stockBlockPanel');
    if (panel) panel.style.display = 'none';
  }
  function showStockBlock(code, detail) {
    const panel = document.getElementById('stockBlockPanel');
    if (!panel) return;
    const expired = code === 'STOCK_UNSELLABLE_EXPIRED';
    const titleEl = document.getElementById('stockBlockTitle');
    const bodyEl = document.getElementById('stockBlockBody');
    const hintEl = document.getElementById('stockBlockHint');
    if (titleEl) {
      titleEl.textContent = expired
        ? t('Expired — cannot sell', 'منتهي — مش هيتباع')
        : t('Not enough stock', 'مفيش رصيد كفاية');
    }
    if (bodyEl) {
      bodyEl.textContent =
        pickBilingual(detail) ||
        (expired
          ? t(
              'All on-hand units are past expiry for this product.',
              'كل الكمية الموجودة للمنتج منتهية الصلاحية.'
            )
          : t('Lower the qty or pick another product.', 'قلّل الكمية أو اختار منتج تاني.'));
    }
    if (hintEl) {
      hintEl.textContent = expired
        ? t(
            'Use inventory Fix / adjustments to write off expired, then receive fresh stock.',
            'من المخزون: اعمل إتلاف للمنتهي، بعدين استلم كمية جديدة.'
          )
        : t(
            'Check the desk warehouse, or move stock from the storeroom.',
            'اتأكد من مستودع المكتب، أو حوّل من المخزن.'
          );
    }
    panel.style.display = 'flex';
    panel.className = 'banner stock-block ' + (expired ? 'warn' : 'danger');
    try {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {}
  }
  function productThumbHtml(url, cls) {
    const c = cls || 'retail-thumb';
    if (url) {
      return (
        '<div class="' +
        c +
        '"><img src="' +
        esc(url) +
        '" alt="" loading="lazy" onerror="this.remove();this.parentNode.innerHTML=\'<i class=&quot;ti ti-photo&quot;></i>\'"></div>'
      );
    }
    return '<div class="' + c + '"><i class="ti ti-photo"></i></div>';
  }
  function applyLocaleBits() {
    if (window.GfpI18n && window.GfpI18n.applyDocumentLocale) {
      window.GfpI18n.applyDocumentLocale();
    }
  }
  function newIdemKey() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'sale-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  function ensureIdemKey() {
    if (!idempotencyKey) idempotencyKey = newIdemKey();
    const el = document.getElementById('idemKey');
    if (el) el.textContent = idempotencyKey;
    return idempotencyKey;
  }
  function clearIdemKey() {
    idempotencyKey = null;
    const el = document.getElementById('idemKey');
    if (el) el.textContent = '—';
  }

  async function api(method, path, body, headers) {
    const opts = { method, headers: getH(headers) };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, data: null };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  async function apiHtml(path) {
    const headers = getH();
    delete headers['Content-Type'];
    const res = await fetch(API_BASE + path, { method: 'GET', headers: headers });
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, text: '' };
    }
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text };
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** Poll until invoice exists (fallback when inline create was not ready). */
  async function waitForSaleInvoice(saleId) {
    for (let i = 0; i < 30; i++) {
      const res = await api('GET', '/sales/' + encodeURIComponent(saleId) + '/invoice');
      if (res.ok && res.data && res.data.invoiceId) return res.data;
      if (res.status && res.status !== 404) return null;
      await sleep(i < 8 ? 150 : 350);
    }
    return null;
  }

  function closePosPrint() {
    const ov = document.getElementById('posPrintOverlay');
    if (ov) ov.hidden = true;
    const frame = document.getElementById('posPrintFrame');
    if (frame) frame.srcdoc = '';
  }

  async function openMemberCardPrint(memberId, autoPrint) {
    const overlay = document.getElementById('posPrintOverlay');
    const frame = document.getElementById('posPrintFrame');
    const title = document.getElementById('posPrintTitle');
    if (!overlay || !frame || !memberId) {
      toast(t('Print view not available.', 'شاشة الطباعة مش متاحة.'), 'err');
      return;
    }
    if (title) title.textContent = t('Member card', 'كارنيه العضو');
    overlay.hidden = false;
    frame.srcdoc =
      '<p style="padding:16px;font-family:sans-serif;color:#666">' +
      esc(t('Loading card…', 'جاري تحميل الكارنيه…')) +
      '</p>';
    const res = await apiHtml('/members/' + encodeURIComponent(memberId) + '/access-card-html');
    if (!res.ok) {
      var detail = t('Could not load member card.', 'مش قدرنا نحمّل كارنيه العضو.');
      if (res.status === 404) {
        detail = t(
          'Card endpoint missing (404). Restart the API after Access Cards deploy.',
          'مسار الكارنيه مش موجود (404). أعد تشغيل الـ API بعد نشر Access Cards.'
        );
      } else if (res.status === 403) {
        detail = t(
          'No permission to print cards (need members.view).',
          'مفيش صلاحية طباعة الكارنيه (لازم members.view).'
        );
      } else if (res.status) {
        detail = detail + ' (HTTP ' + res.status + ')';
      }
      toast(detail, 'err');
      frame.srcdoc =
        '<p style="padding:16px;font-family:sans-serif;color:#991b1b">' +
        esc(detail) +
        '</p>';
      return;
    }
    frame.srcdoc = res.text || '';
    if (autoPrint) {
      // Wait for iframe layout so barcode bars paint before Chromium print snapshot.
      setTimeout(function () {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (e) {
          toast(t('Allow pop-ups / try Print again.', 'اسمح بالنوافذ أو اضغط طباعة تاني.'), 'err');
        }
      }, 450);
    }
  }

  async function openRetailReceiptPrint(invoiceId, invoiceNumber, autoPrint) {
    const overlay = document.getElementById('posPrintOverlay');
    const frame = document.getElementById('posPrintFrame');
    const title = document.getElementById('posPrintTitle');
    if (!overlay || !frame) {
      toast(t('Print view not available.', 'شاشة الطباعة مش متاحة.'), 'err');
      return;
    }
    if (title) {
      title.textContent = invoiceNumber
        ? t('Invoice', 'فاتورة') + ' ' + invoiceNumber
        : t('Receipt', 'إيصال');
    }
    overlay.hidden = false;
    frame.srcdoc =
      '<p style="padding:16px;font-family:sans-serif;color:#666">' +
      esc(t('Loading receipt…', 'جاري تحميل الإيصال…')) +
      '</p>';
    const res = await apiHtml('/invoices/' + encodeURIComponent(invoiceId) + '/receipt-html');
    if (!res.ok) {
      toast(t('Could not load receipt for print.', 'مش قدرنا نحمّل الإيصال للطباعة.'), 'err');
      frame.srcdoc =
        '<p style="padding:16px;font-family:sans-serif;color:#991b1b">' +
        esc(t('Receipt failed to load.', 'فشل تحميل الإيصال.')) +
        '</p>';
      return;
    }
    frame.srcdoc = res.text || '';
    if (autoPrint) {
      setTimeout(function () {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (_) {
          toast(t('Allow pop-ups / try Print again.', 'اسمح بالنوافذ أو اضغط طباعة تاني.'), 'err');
        }
      }, 400);
    }
  }

  function wireRetailPrintActions(sale) {
    const saleId = sale.saleId;
    const statusEl = document.getElementById('invoiceReadyLine');
    const printBtn = document.getElementById('btnPrintReceipt');
    const nextBtn = document.getElementById('btnStartNextSale');
    if (nextBtn) {
      nextBtn.onclick = function () {
        closePosPrint();
        document.getElementById('btnReset').click();
      };
    }
    if (!printBtn) return;

    function armPrint(invoiceId, invoiceNumber) {
      if (statusEl) {
        statusEl.innerHTML =
          esc(t('Invoice ready', 'الفاتورة جاهزة')) +
          (invoiceNumber ? ': <strong>' + esc(invoiceNumber) + '</strong>' : '');
        statusEl.classList.add('invoice-ready');
      }
      printBtn.disabled = false;
      printBtn.removeAttribute('aria-busy');
      printBtn.onclick = function () {
        openRetailReceiptPrint(invoiceId, invoiceNumber, true);
      };
      openRetailReceiptPrint(invoiceId, invoiceNumber, true);
      toast(
        (invoiceNumber
          ? t('Invoice', 'فاتورة') + ' ' + invoiceNumber + ' — '
          : '') + t('ready to print', 'جاهزة للطباعة'),
        'ok'
      );
    }

    // Fast path: invoice created inline with the sale (no Hangfire wait).
    const readyId = sale.invoiceId || sale.InvoiceId;
    const readyNum = sale.invoiceNumber || sale.InvoiceNumber;
    if (readyId) {
      armPrint(readyId, readyNum || '');
      return;
    }

    printBtn.disabled = true;
    printBtn.setAttribute('aria-busy', 'true');
    if (statusEl) {
      statusEl.textContent = t('Preparing invoice for print…', 'بنحضّر الفاتورة للطباعة…');
    }

    waitForSaleInvoice(saleId).then(function (inv) {
      printBtn.removeAttribute('aria-busy');
      if (!inv) {
        if (statusEl) {
          statusEl.textContent = t(
            'Invoice still preparing — tap Print to retry.',
            'الفاتورة لسه بتتحضر — اضغط طباعة للمحاولة.'
          );
        }
        printBtn.disabled = false;
        printBtn.onclick = function () {
          wireRetailPrintActions(sale);
        };
        return;
      }
      armPrint(inv.invoiceId, inv.invoiceNumber || '');
    });
  }

  function setSalesDisabledBanner(on) {
    const el = document.getElementById('featureDisabled');
    if (!el) return;
    el.style.display = on ? 'flex' : 'none';
  }

  async function refreshSalesFeatureBanner() {
    try {
      const F = window.GfpFeatures;
      if (!F) return;
      const reg = F.readCache && F.readCache();
      if (reg && Object.prototype.hasOwnProperty.call(reg, 'sales')) {
        setSalesDisabledBanner(reg.sales === false);
        return;
      }
      if (F.probeModuleAvailable) {
        const ok = await F.probeModuleAvailable('sales');
        setSalesDisabledBanner(!ok);
      }
    } catch (_) { /* fail-open: do not scare the desk */ }
  }

  // ── Shift gate ────────────────────────────────────────────────
  async function checkShift() {
    const gate = document.getElementById('shiftGate');
    const label = document.getElementById('shiftLabel');
    const ws = document.getElementById('posWorkspace');
    const res = await api('GET', '/shifts/current');
    // Never map shifts FEATURE_DISABLED → "Sales are turned off" (confuses the desk).
    const open =
      res.ok && res.data && res.data.status === 'open'
        ? true
        : false;
    if (res.ok && !res.data) {
      shiftOk = false;
    } else if (res.status === 409 || res.status === 404) {
      shiftOk = false;
    } else {
      shiftOk = open;
    }

    if (!shiftOk) {
      gate.style.display = 'flex';
      ws.classList.add('blocked');
      label.textContent = t('No open shift', 'مفيش وردية مفتوحة');
      document.getElementById('btnSell').disabled = true;
    } else {
      gate.style.display = 'none';
      ws.classList.remove('blocked');
      label.textContent =
        t('Open', 'مفتوحة') + ' · ' + (res.data.userName || t('you', 'أنت'));
      updateSellEnabled();
    }
  }

  // ── Plans ─────────────────────────────────────────────────────
  function planDurationLabel(p) {
    if (p.durationDays) return p.durationDays + ' ' + t('days', 'يوم');
    if (p.durationMonths) return p.durationMonths + ' ' + t('mo', 'شهر');
    if (p.planType) return String(p.planType);
    return '';
  }

  function renderPlanTiles() {
    const host = document.getElementById('planTiles');
    if (!host) return;
    const selectedId = document.getElementById('planSelect').value;
    if (!plans.length) {
      host.innerHTML =
        '<div class="muted">' +
        esc(t('No active plans.', 'مفيش باقات نشطة.')) +
        '</div>';
      return;
    }
    host.innerHTML = plans
      .map(function (p) {
        const act = p.id === selectedId ? ' act' : '';
        return (
          '<button type="button" class="plan-tile retail-tap' +
          act +
          '" role="option" aria-selected="' +
          (p.id === selectedId ? 'true' : 'false') +
          '" data-plan-id="' +
          esc(p.id) +
          '">' +
          '<span class="plan-tile-icon"><i class="ti ti-id-badge-2"></i></span>' +
          '<span class="plan-tile-name">' +
          esc(p.name || 'Plan') +
          '</span>' +
          (planDurationLabel(p)
            ? '<span class="plan-tile-meta">' + esc(planDurationLabel(p)) + '</span>'
            : '') +
          '<span class="plan-tile-price">' +
          esc(money(p.price)) +
          '</span></button>'
        );
      })
      .join('');
    host.querySelectorAll('[data-plan-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectPlanById(btn.getAttribute('data-plan-id'));
      });
    });
  }

  function selectPlanById(id) {
    const sel = document.getElementById('planSelect');
    sel.value = id || '';
    const p = selectedPlan();
    document.getElementById('planPrice').textContent = p
      ? t('Total', 'الإجمالي') + ' ' + money(p.price)
      : '—';
    promoPreview = null;
    document.getElementById('promoStatus').textContent = t(
      'Optional — leave empty if none.',
      'اختياري — سيبه فاضي لو مفيش.'
    );
    renderPlanTiles();
    updateEstimate();
    updateSellEnabled();
  }

  async function loadPlans() {
    const hint = document.getElementById('plansHint');
    const sel = document.getElementById('planSelect');
    const res = await api('GET', '/membership-plans');
    if (!res.ok) {
      hint.textContent = t(
        'Could not load plans — ask owner for access.',
        'مش قدرنا نحمّل الباقات — اطلب صلاحية من المالك.'
      );
      const tiles = document.getElementById('planTiles');
      if (tiles) {
        tiles.innerHTML = '<div class="muted">' + esc(hint.textContent) + '</div>';
      }
      return;
    }
    plans = Array.isArray(res.data) ? res.data.filter((p) => p.isActive !== false) : [];
    hint.textContent = plans.length
      ? plans.length + ' ' + t('plans', 'باقات')
      : t('No plans', 'مفيش باقات');
    sel.innerHTML =
      '<option value="">Select plan…</option>' +
      plans
        .map(
          (p) =>
            '<option value="' +
            esc(p.id) +
            '" data-price="' +
            esc(String(p.price)) +
            '">' +
            esc(p.name) +
            ' — ' +
            esc(money(p.price)) +
            '</option>',
        )
        .join('');
    renderPlanTiles();
  }

  function selectedPlan() {
    const id = document.getElementById('planSelect').value;
    return plans.find((p) => p.id === id) || null;
  }

  document.getElementById('planSelect').addEventListener('change', () => {
    selectPlanById(document.getElementById('planSelect').value);
  });

  // ── Member mode ───────────────────────────────────────────────
  document.querySelectorAll('#membershipPanel .seg-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#membershipPanel .seg-btn[data-mode]').forEach((b) => b.classList.remove('act'));
      btn.classList.add('act');
      memberMode = btn.getAttribute('data-mode');
      document.getElementById('existingMemberBox').style.display =
        memberMode === 'existing' ? 'block' : 'none';
      document.getElementById('newMemberBox').style.display = memberMode === 'new' ? 'block' : 'none';
      promoPreview = null;
      updateSellEnabled();
    });
  });

  let searchTimer = null;
  document.getElementById('memberSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    const box = document.getElementById('memberResults');
    if (q.length < 2) {
      box.classList.remove('show');
      box.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async () => {
      const res = await api('GET', '/members?search=' + encodeURIComponent(q) + '&page=1&pageSize=10');
      const items = (res.data && res.data.items) || [];
      if (!items.length) {
        box.innerHTML = '<button type="button" disabled>No matches</button>';
        box.classList.add('show');
        return;
      }
      box.innerHTML = items
        .map(
          (m) =>
            '<button type="button" data-id="' +
            esc(m.id) +
            '" data-name="' +
            esc(m.fullName) +
            '" data-phone="' +
            esc(m.phone) +
            '">' +
            esc(m.fullName) +
            ' · ' +
            esc(m.phone) +
            ' · ' +
            esc(m.memberNumber) +
            '</button>',
        )
        .join('');
      box.classList.add('show');
      box.querySelectorAll('button[data-id]').forEach((b) => {
        b.addEventListener('click', () => {
          selectedMember = {
            id: b.getAttribute('data-id'),
            fullName: b.getAttribute('data-name'),
            phone: b.getAttribute('data-phone'),
          };
          const selEl = document.getElementById('selectedMember');
          selEl.textContent = selectedMember.fullName + ' · ' + selectedMember.phone;
          selEl.classList.add('has-member');
          box.classList.remove('show');
          updateSellEnabled();
        });
      });
    }, 280);
  });

  // ── Promo ─────────────────────────────────────────────────────
  document.getElementById('btnValidatePromo').addEventListener('click', async () => {
    const code = document.getElementById('promoCode').value.trim();
    const plan = selectedPlan();
    if (!code || !plan) {
      toast('Select a plan and enter a code.', 'err');
      return;
    }
    if (memberMode !== 'existing' || !selectedMember) {
      toast('Promo validate needs an existing member. For walk-ins, code is applied at submit.', 'err');
      return;
    }
    const res = await api('POST', '/sales/validate-promo', {
      code,
      planId: plan.id,
      memberId: selectedMember.id,
    });
    if (!res.ok) {
      promoPreview = null;
      document.getElementById('promoStatus').textContent = problemMessage(res.data, res.status);
      toast(problemMessage(res.data, res.status), 'err');
      updateEstimate();
      return;
    }
    promoPreview = res.data;
    if (!promoPreview.isValid) {
      document.getElementById('promoStatus').textContent =
        'Invalid: ' + (promoPreview.failureReason || 'unknown');
      promoPreview = null;
    } else {
      document.getElementById('promoStatus').textContent =
        'Valid · discount ' +
        money(promoPreview.discountAmount) +
        ' · final ' +
        money(promoPreview.finalPrice);
    }
    updateEstimate();
  });

  document.getElementById('btnClearPromo').addEventListener('click', () => {
    document.getElementById('promoCode').value = '';
    promoPreview = null;
    document.getElementById('promoStatus').textContent = 'Promo cleared.';
    updateEstimate();
  });

  // ── Discount UI ───────────────────────────────────────────────
  if (!canDiscount) {
    document.getElementById('discountFields').style.display = 'none';
    document.getElementById('discountLocked').style.display = 'block';
  }

  // ── Payment legs ──────────────────────────────────────────────
  function addLeg(method, amount) {
    const wrap = document.getElementById('payLegs');
    const row = document.createElement('div');
    row.className = 'pay-leg';
    row.innerHTML =
      '<label><span data-en="Method" data-ar="طريقة الدفع">Method</span><select>' +
      METHODS.map(
        (m) =>
          '<option value="' +
          m +
          '"' +
          (m === method ? ' selected' : '') +
          '>' +
          esc(methodLabel(m)) +
          '</option>',
      ).join('') +
      '</select></label>' +
      '<label><span data-en="Amount" data-ar="المبلغ">Amount</span><input type="number" step="0.01" min="0" value="' +
      (amount != null ? amount : '') +
      '"></label>' +
      '<button type="button" class="btn ghost" title="' +
      esc(t('Remove', 'إزالة')) +
      '">✕</button>';
    row.querySelector('button').onclick = () => {
      row.remove();
      updatePaidSum();
    };
    row.querySelector('input').addEventListener('input', updatePaidSum);
    wrap.appendChild(row);
    updatePaidSum();
  }

  function readPayments() {
    return Array.from(document.querySelectorAll('#payLegs .pay-leg'))
      .map((row) => ({
        method: row.querySelector('select').value,
        amount: Number(row.querySelector('input').value),
      }))
      .filter((p) => p.amount > 0);
  }

  function updatePaidSum() {
    const sum = readPayments().reduce((a, p) => a + p.amount, 0);
    document.getElementById('paidSum').textContent = money(sum);
  }

  // ── POS mode: membership | retail ─────────────────────────────
  function placeMemberBoxes(hostId) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const existing = document.getElementById('existingMemberBox');
    const neu = document.getElementById('newMemberBox');
    if (existing) host.appendChild(existing);
    if (neu) host.appendChild(neu);
  }

  function desiredUrlMode() {
    try {
      return new URLSearchParams(window.location.search).get('mode') === 'retail'
        ? 'retail'
        : 'membership';
    } catch (_) {
      return 'membership';
    }
  }

  function syncUrlMode(mode) {
    try {
      const url = new URL(window.location.href);
      if (mode === 'retail') url.searchParams.set('mode', 'retail');
      else url.searchParams.delete('mode');
      const next = url.pathname + url.search + url.hash;
      const cur = window.location.pathname + window.location.search + window.location.hash;
      if (next !== cur) window.history.replaceState({}, '', next);
      if (window.GfpShell && typeof window.GfpShell.renderShellNav === 'function') {
        window.GfpShell.renderShellNav();
      }
    } catch (_) { /* ignore */ }
  }

  function setPosMode(mode, opts) {
    opts = opts || {};
    const wantRetail = mode === 'retail';
    if (wantRetail && !inventoryOn && !opts.force) {
      toast(t('Inventory feature required for retail.', 'ميزة المخزون مطلوبة لبيع المنتجات.'), 'err');
      mode = 'membership';
    }
    posMode = mode === 'retail' ? 'retail' : 'membership';
    const isRetail = posMode === 'retail';

    document.querySelectorAll('[data-pos-mode]').forEach(function (btn) {
      btn.classList.toggle('act', btn.getAttribute('data-pos-mode') === posMode);
    });

    const memb = document.getElementById('membershipPanel');
    const retail = document.getElementById('retailPanel');
    if (memb) {
      memb.hidden = isRetail;
      memb.style.display = isRetail ? 'none' : '';
      memb.setAttribute('aria-hidden', isRetail ? 'true' : 'false');
    }
    if (retail) {
      retail.hidden = !isRetail;
      retail.style.display = isRetail ? '' : 'none';
      retail.setAttribute('aria-hidden', isRetail ? 'false' : 'true');
    }

    const ws = document.getElementById('posWorkspace');
    if (ws) ws.classList.toggle('pos-retail', isRetail);
    document.body.classList.toggle('pos-retail', isRetail);
    document.documentElement.classList.toggle('pos-retail', isRetail);

    const debtCard = document.getElementById('debtPayCard');
    const debtHost = document.getElementById('retailDebtHost');
    const debtReturn = document.getElementById('debtPayReturnHost');
    if (debtCard) {
      debtCard.hidden = false;
      debtCard.style.display = '';
      debtCard.classList.toggle('retail-debt-compact', isRetail);
      if (isRetail && debtHost) debtHost.appendChild(debtCard);
      else if (debtReturn) debtReturn.appendChild(debtCard);
    }

    const payMount = document.getElementById('retailPayMount');
    const payCard = document.getElementById('paymentsCard');
    const submitCard = document.getElementById('submitCard');
    const gridMain = document.querySelector('#posWorkspace .grid-main');
    if (payCard && submitCard) {
      if (isRetail && payMount) {
        payMount.appendChild(payCard);
        payMount.appendChild(submitCard);
      } else if (gridMain && ws) {
        gridMain.appendChild(payCard);
        ws.appendChild(submitCard);
      }
    }

    const quickPay = document.getElementById('retailQuickPay');
    if (quickPay) quickPay.hidden = false;
    const payMore = document.getElementById('payMoreDetails');
    if (payMore) payMore.open = false;

    const finishTotalRow = document.getElementById('finishTotalRow');
    if (finishTotalRow) {
      finishTotalRow.hidden = !isRetail;
      finishTotalRow.style.display = isRetail ? '' : 'none';
    }
    const retailHint = document.getElementById('retailSubmitHint');
    if (retailHint) {
      retailHint.hidden = !isRetail;
      retailHint.style.display = isRetail ? '' : 'none';
    }

    const titleEl = document.getElementById('pageTitleText');
    if (titleEl) {
      titleEl.textContent = isRetail
        ? t('Sell products', 'بيع منتجات')
        : t('Point of Sale', 'نقطة البيع');
    }
    const crumb = document.getElementById('posBreadcrumb');
    if (crumb) {
      crumb.textContent = isRetail
        ? t('Sell products', 'بيع منتجات')
        : t('Point of Sale', 'نقطة البيع');
    }

    const sub = document.getElementById('pageSubtitle');
    if (sub) {
      sub.textContent = isRetail
        ? t('Member · Products · Cart — Cash or Card to finish', 'عضو · منتجات · سلة — كاش أو بطاقة للإنهاء')
        : t('Member · Plan · Cash or Card', 'عضو · باقة · كاش أو بطاقة');
    }

    const promoBtn = document.getElementById('btnPromoCodes');
    if (promoBtn) promoBtn.style.display = isRetail ? 'none' : '';

    const sellBtn = document.getElementById('btnSell');
    if (sellBtn) {
      sellBtn.classList.toggle('retail-tap', isRetail);
      sellBtn.innerHTML =
        '<i class="ti ti-check"></i> <span>' +
        esc(isRetail ? t('Complete retail sale', 'تمّم بيع المنتجات') : t('Complete sale', 'تمّم البيع')) +
        '</span>';
    }

    if (!opts.skipUrl) syncUrlMode(posMode);
    else if (window.GfpShell && typeof window.GfpShell.renderShellNav === 'function') {
      window.GfpShell.renderShellNav();
    }

    if (isRetail) {
      placeMemberBoxes('retailMemberFieldsHost');
      applyRetailMemberMode();
      loadQuickProducts();
    } else {
      placeMemberBoxes('memberFieldsHost');
      const existing = document.getElementById('existingMemberBox');
      const neu = document.getElementById('newMemberBox');
      if (existing) existing.style.display = memberMode === 'existing' ? 'block' : 'none';
      if (neu) neu.style.display = memberMode === 'new' ? 'block' : 'none';
    }
    updateEstimate();
    updateSellEnabled();
    applyLocaleBits();
  }

  function applyRetailMemberMode() {
    const hint = document.getElementById('retailMemberHint');
    document.querySelectorAll('#retailMemberSeg [data-rmode]').forEach(function (btn) {
      btn.classList.toggle('act', btn.getAttribute('data-rmode') === retailMemberMode);
    });
    if (retailMemberMode === 'none') {
      hint.style.display = 'block';
      hint.textContent = t('Walk-in — no member on sale.', 'عابر — مفيش عضو على الفاتورة.');
      document.getElementById('existingMemberBox').style.display = 'none';
      document.getElementById('newMemberBox').style.display = 'none';
    } else if (retailMemberMode === 'existing') {
      hint.style.display = 'none';
      document.getElementById('existingMemberBox').style.display = 'block';
      document.getElementById('newMemberBox').style.display = 'none';
    } else {
      hint.style.display = 'none';
      document.getElementById('existingMemberBox').style.display = 'none';
      document.getElementById('newMemberBox').style.display = 'block';
    }
    updateSellEnabled();
    applyLocaleBits();
  }

  document.querySelectorAll('[data-pos-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setPosMode(btn.getAttribute('data-pos-mode'));
    });
  });

  document.querySelectorAll('#retailMemberSeg [data-rmode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      retailMemberMode = btn.getAttribute('data-rmode') || 'none';
      applyRetailMemberMode();
    });
  });

  function updateCartCount() {
    const el = document.getElementById('cartCount');
    if (el) el.textContent = String(retailCart.length);
  }

  function renderRetailCart() {
    const host = document.getElementById('retailCart');
    updateCartCount();
    if (!retailCart.length) {
      host.innerHTML =
        '<div class="muted empty-cart">' +
        esc(t('Cart empty — scan or tap a product.', 'السلة فاضية — امسح أو اضغط منتج.')) +
        '</div>';
      updateEstimate();
      updateSellEnabled();
      return;
    }
    host.innerHTML = retailCart
      .map(function (l, i) {
        const step = l.allowFractional ? '0.001' : '1';
        const min = l.allowFractional ? '0.001' : '1';
        return (
          '<div class="retail-line" data-idx="' +
          i +
          '">' +
          productThumbHtml(l.imageUrl) +
          '<div class="retail-line-meta">' +
          '<div class="retail-line-name">' +
          esc(l.name) +
          '</div>' +
          '<div class="retail-line-sku">' +
          esc(l.sku) +
          '</div>' +
          '</div>' +
          '<button type="button" class="rc-remove" title="' +
          esc(t('Remove', 'احذف')) +
          '"><i class="ti ti-x"></i></button>' +
          '<div class="retail-line-controls">' +
          '<div class="qty-stepper">' +
          '<button type="button" class="rc-dec" aria-label="-">−</button>' +
          '<input type="number" class="rc-qty" min="' +
          min +
          '" step="' +
          step +
          '" value="' +
          esc(l.qty) +
          '">' +
          '<button type="button" class="rc-inc" aria-label="+">+</button>' +
          '</div>' +
          '<input type="number" class="rc-price" min="0" step="0.01" value="' +
          esc(l.unitPrice) +
          '" title="' +
          esc(t('Unit price', 'سعر الوحدة')) +
          '">' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    host.querySelectorAll('.retail-line').forEach(function (row) {
      const idx = Number(row.getAttribute('data-idx'));
      function setQty(v) {
        if (!retailCart[idx].allowFractional) v = Math.max(1, Math.floor(v) || 1);
        else v = Math.max(0.001, Number(v) || 0.001);
        retailCart[idx].qty = v;
        const inp = row.querySelector('.rc-qty');
        if (inp) inp.value = String(v);
        updateEstimate();
        updateSellEnabled();
      }
      row.querySelector('.rc-qty').addEventListener('input', function (e) {
        setQty(Number(e.target.value));
      });
      row.querySelector('.rc-inc').addEventListener('click', function () {
        const step = retailCart[idx].allowFractional ? 0.001 : 1;
        setQty(Number(retailCart[idx].qty) + step);
      });
      row.querySelector('.rc-dec').addEventListener('click', function () {
        const step = retailCart[idx].allowFractional ? 0.001 : 1;
        const next = Number(retailCart[idx].qty) - step;
        if (!retailCart[idx].allowFractional && next < 1) {
          retailCart.splice(idx, 1);
          renderRetailCart();
          return;
        }
        setQty(next);
      });
      row.querySelector('.rc-price').addEventListener('input', function (e) {
        retailCart[idx].unitPrice = Number(e.target.value) || 0;
        updateEstimate();
        updateSellEnabled();
      });
      row.querySelector('.rc-remove').addEventListener('click', function () {
        retailCart.splice(idx, 1);
        renderRetailCart();
      });
    });
    updateEstimate();
    updateSellEnabled();
  }

  function addProductToCart(p) {
    if (!p || !p.id) return;
    const existing = retailCart.find(function (l) {
      return l.productId === p.id;
    });
    if (existing) {
      existing.qty = Number(existing.qty) + 1;
      if (!existing.imageUrl && p.imageUrl) existing.imageUrl = p.imageUrl;
      renderRetailCart();
      return;
    }
    retailCart.push({
      productId: p.id,
      sku: p.sku || '',
      name: p.name || '',
      imageUrl: p.imageUrl || null,
      qty: 1,
      unitPrice: Number(p.sellPrice) || 0,
      allowFractional: !!p.allowFractionalQty
    });
    renderRetailCart();
  }

  async function loadQuickProducts() {
    const host = document.getElementById('quickAddGrid');
    if (!host || host.getAttribute('data-loaded') === '1') return;
    const res = await api('GET', '/inventory/products?page=1&pageSize=12');
    if (!res.ok) {
      host.innerHTML =
        '<div class="muted">' +
        esc(t('Could not load quick products — use search.', 'مش قدرنا نحمّل المنتجات السريعة — استخدم البحث.')) +
        '</div>';
      return;
    }
    const items = Array.isArray(res.data)
      ? res.data
      : (res.data && (res.data.items || res.data.products)) || [];
    const active = items.filter(function (p) {
      return p && p.isActive !== false;
    }).slice(0, 12);
    if (!active.length) {
      host.innerHTML =
        '<div class="muted">' +
        esc(t('No products yet — receive stock first.', 'مفيش منتجات — استلم مخزون الأول.')) +
        '</div>';
      return;
    }
    host.innerHTML = active
      .map(function (p) {
        return (
          '<button type="button" class="quick-tile retail-tap" data-quick-id="' +
          esc(p.id) +
          '">' +
          (p.imageUrl
            ? '<img src="' + esc(p.imageUrl) + '" alt="" width="36" height="36" style="border-radius:8px;object-fit:cover">'
            : '<i class="ti ti-bottle"></i>') +
          '<span class="quick-tile-name">' +
          esc(p.name || p.sku || 'Item') +
          '</span>' +
          '<span class="quick-tile-price">' +
          esc(money(p.sellPrice)) +
          '</span></button>'
        );
      })
      .join('');
    host.setAttribute('data-loaded', '1');
    host.querySelectorAll('[data-quick-id]').forEach(function (btn) {
      const id = btn.getAttribute('data-quick-id');
      const p = active.find(function (x) {
        return x.id === id;
      });
      btn.addEventListener('click', function () {
        if (p) {
          addProductToCart(p);
          toast(t('Added', 'تمت الإضافة') + ' ' + (p.name || p.sku || ''), 'ok');
        }
      });
    });
  }

  async function loadWarehouses() {
    const sel = document.getElementById('warehouseSelect');
    sel.innerHTML = '<option value="">Loading…</option>';
    const [listRes, defRes] = await Promise.all([
      api('GET', '/inventory/warehouses'),
      api('GET', '/inventory/warehouses/default')
    ]);
    if (!listRes.ok) {
      sel.innerHTML = '<option value="">Failed to load warehouses</option>';
      return;
    }
    const items = Array.isArray(listRes.data)
      ? listRes.data
      : (listRes.data && (listRes.data.items || listRes.data.warehouses)) || [];
    const active = items.filter(function (w) {
      return w.isActive !== false;
    });
    if (!active.length) {
      sel.innerHTML = '<option value="">No warehouses</option>';
      return;
    }
    const defaultId =
      defRes.ok && defRes.data && defRes.data.id
        ? defRes.data.id
        : (active.find(function (w) {
            return w.isDefault;
          }) || active[0]).id;
    sel.innerHTML = active
      .map(function (w) {
        return (
          '<option value="' +
          esc(w.id) +
          '"' +
          (w.id === defaultId ? ' selected' : '') +
          '>' +
          esc(w.code ? w.code + ' — ' + (w.name || '') : w.name || w.id) +
          '</option>'
        );
      })
      .join('');
    sel.onchange = function () {
      updateSellEnabled();
    };
    updateSellEnabled();
  }

  async function probeInventoryAndUi() {
    const res = await api('GET', '/inventory/categories');
    inventoryOn = !(res.status === 404 && res.data && res.data.title === 'FEATURE_DISABLED');
    const tab = document.getElementById('tabRetail');
    const hint = document.getElementById('inventoryOffHint');
    if (inventoryOn) {
      tab.style.display = '';
      hint.style.display = 'none';
      await loadWarehouses();
    } else {
      tab.style.display = 'none';
      hint.style.display = 'block';
      if (posMode === 'retail') setPosMode('membership');
    }
  }

  let productSearchTimer = null;
  document.getElementById('btnBarcode').addEventListener('click', async function () {
    const code = document.getElementById('barcodeInput').value.trim();
    if (!code) {
      toast(t('Enter a barcode.', 'اكتب الباركود.'), 'err');
      return;
    }
    const res = await api('GET', '/inventory/products/by-barcode/' + encodeURIComponent(code));
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    addProductToCart(res.data);
    document.getElementById('barcodeInput').value = '';
    toast(t('Added', 'تمت الإضافة') + ' ' + (res.data.sku || res.data.name), 'ok');
  });
  document.getElementById('barcodeInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnBarcode').click();
    }
  });

  document.getElementById('productSearch').addEventListener('input', function (e) {
    const q = e.target.value.trim();
    clearTimeout(productSearchTimer);
    const list = document.getElementById('productResults');
    if (q.length < 1) {
      list.innerHTML = '';
      list.classList.remove('show');
      return;
    }
    productSearchTimer = setTimeout(async function () {
      const res = await api(
        'GET',
        '/inventory/products?q=' + encodeURIComponent(q)
      );
      if (!res.ok) {
        list.innerHTML = '<div class="muted">' + esc(problemMessage(res.data, res.status)) + '</div>';
        list.classList.add('show');
        return;
      }
      const items = Array.isArray(res.data)
        ? res.data
        : (res.data && (res.data.items || res.data.products)) || [];
      const active = items.filter(function (p) {
        return !p.isArchived && p.isActive !== false;
      });
      if (!active.length) {
        list.innerHTML = '<div class="muted">' + esc(t('No products', 'مفيش منتجات')) + '</div>';
        list.classList.add('show');
        return;
      }
      list.innerHTML = active
        .map(function (p) {
          return (
            '<button type="button" class="prod-hit" data-pid="' +
            esc(p.id) +
            '">' +
            productThumbHtml(p.imageUrl, 'prod-hit-thumb') +
            '<div class="prod-hit-body">' +
            '<div class="prod-hit-name">' +
            esc(p.name) +
            '</div>' +
            '<div class="prod-hit-meta">' +
            esc(p.sku || '') +
            (p.nameAr ? ' · ' + esc(p.nameAr) : '') +
            '</div>' +
            '</div>' +
            '<div class="prod-hit-price">' +
            esc(money(p.sellPrice)) +
            '</div>' +
            '</button>'
          );
        })
        .join('');
      list.classList.add('show');
      list.querySelectorAll('[data-pid]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const p = active.find(function (x) {
            return x.id === btn.getAttribute('data-pid');
          });
          if (p) {
            addProductToCart(p);
            list.innerHTML = '';
            list.classList.remove('show');
            document.getElementById('productSearch').value = '';
          }
        });
      });
    }, 280);
  });

  function estimateTotal() {
    if (posMode === 'retail') {
      return retailCart.reduce(function (s, l) {
        return s + Number(l.qty) * Number(l.unitPrice);
      }, 0);
    }
    const plan = selectedPlan();
    if (!plan) return null;
    if (promoPreview && promoPreview.finalPrice != null) return Number(promoPreview.finalPrice);
    let total = Number(plan.price) || 0;
    if (canDiscount) {
      const d = Number(document.getElementById('discAmount').value) || 0;
      total = Math.max(0, total - d);
    }
    return total;
  }

  function updateEstimate() {
    const total = estimateTotal();
    const text = total == null ? '—' : money(total);
    document.getElementById('estTotal').textContent = text;
    const finish = document.getElementById('finishTotal');
    if (finish) finish.textContent = text;
    // Desk default: first cash leg gets the remaining total so staff don't invent numbers.
    if (total != null && total >= 0 && !document.getElementById('partialOpt').checked) {
      const firstAmt = document.querySelector('#payLegs .pay-leg input[type="number"]');
      if (firstAmt && document.querySelectorAll('#payLegs .pay-leg').length === 1) {
        firstAmt.value = String(Number(total.toFixed(2)));
        updatePaidSum();
      }
    }
  }

  document.getElementById('btnAddLeg').onclick = () => addLeg('cash', '');
  document.getElementById('discAmount').addEventListener('input', updateEstimate);
  document.getElementById('partialOpt').addEventListener('change', (e) => {
    document.getElementById('dueDateWrap').style.display = e.target.checked ? 'flex' : 'none';
  });

  function updateSellEnabled() {
    const cash = document.getElementById('btnPayCash');
    const card = document.getElementById('btnPayCard');
    function setQuick(disabled) {
      if (cash) cash.disabled = disabled;
      if (card) card.disabled = disabled;
    }
    if (!canSell || !shiftOk) {
      document.getElementById('btnSell').disabled = true;
      setQuick(true);
      return;
    }
    if (posMode === 'retail') {
      const cartOk = retailCart.length > 0 && retailCart.every(function (l) {
        return l.qty > 0 && document.getElementById('warehouseSelect').value;
      });
      let memberOk = true;
      if (retailMemberMode === 'existing') memberOk = !!selectedMember;
      if (retailMemberMode === 'new') {
        memberOk = !!(
          document.getElementById('nmName').value.trim() &&
          document.getElementById('nmPhone').value.trim()
        );
      }
      const ok = !!(cartOk && memberOk);
      document.getElementById('btnSell').disabled = !ok;
      setQuick(!ok);
      return;
    }
    const plan = selectedPlan();
    const memberOk =
      memberMode === 'existing'
        ? !!selectedMember
        : !!(document.getElementById('nmName').value.trim() && document.getElementById('nmPhone').value.trim());
    const ok = !!(plan && memberOk);
    document.getElementById('btnSell').disabled = !ok;
    setQuick(!ok);
  }

  ['nmName', 'nmPhone'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateSellEnabled);
  });

  function setSinglePayment(method, amount) {
    const wrap = document.getElementById('payLegs');
    wrap.innerHTML = '';
    addLeg(method, amount != null ? String(Number(amount.toFixed(2))) : '');
    document.getElementById('partialOpt').checked = false;
    document.getElementById('dueDateWrap').style.display = 'none';
    updatePaidSum();
  }

  // ── Submit sale ───────────────────────────────────────────────
  async function submitSale() {
    if (!shiftOk) {
      toast(t('Open a cash shift first.', 'افتح وردية كاش الأول.'), 'err');
      return;
    }

    const payments = readPayments();
    const partial = document.getElementById('partialOpt').checked;
    const dueDate = document.getElementById('dueDate').value;

    let body;

    if (posMode === 'retail') {
      if (!inventoryOn) {
        toast(t('Inventory feature required for retail.', 'ميزة المخزون مطلوبة لبيع المنتجات.'), 'err');
        return;
      }
      if (!retailCart.length) {
        toast(t('Add products to the cart.', 'ضيف منتجات للسلة.'), 'err');
        return;
      }
      const warehouseId = document.getElementById('warehouseSelect').value;
      if (!warehouseId) {
        toast(t('Select a warehouse.', 'اختار مستودع.'), 'err');
        return;
      }
      for (let i = 0; i < retailCart.length; i++) {
        const l = retailCart[i];
        if (!l.allowFractional && Math.floor(l.qty) !== Number(l.qty)) {
          toast(l.sku + ': ' + t('fractional qty not allowed', 'الكسور مش مسموحة'), 'err');
          return;
        }
      }
      body = {
        warehouseId: warehouseId,
        lines: retailCart.map(function (l) {
          return {
            lineType: 'retail',
            productId: l.productId,
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice)
          };
        }),
        payments: payments
      };
      if (retailMemberMode === 'existing') {
        if (!selectedMember) {
          toast(t('Pick a member or use Walk-in.', 'اختار عضو أو عابر.'), 'err');
          return;
        }
        body.memberId = selectedMember.id;
      } else if (retailMemberMode === 'new') {
        body.newMember = {
          fullName: document.getElementById('nmName').value.trim(),
          fullNameAr: document.getElementById('nmNameAr').value.trim() || null,
          phoneNumber: document.getElementById('nmPhone').value.trim(),
          dateOfBirth: document.getElementById('nmDob').value || null
        };
      }
    } else {
      // membership path — original handler continues below via fallthrough structure
      return submitMembershipSale(payments, partial, dueDate);
    }

    if (!payments.length) {
      toast(t('Add a payment amount.', 'ضيف مبلغ الدفع.'), 'err');
      return;
    }
    if (partial) {
      if (!dueDate) {
        toast(t('Due date required for partial payment.', 'تاريخ الاستحقاق مطلوب للدفع الجزئي.'), 'err');
        return;
      }
      body.partialPayment = { dueDate: dueDate };
    }

    await postSale(body);
  }

  async function submitMembershipSale(payments, partial, dueDate) {
    const plan = selectedPlan();
    if (!plan) {
      toast(t('Select a plan.', 'اختار باقة.'), 'err');
      return;
    }
    let body = {
      planId: plan.id,
      payments: payments
    };
    if (memberMode === 'existing') {
      if (!selectedMember) {
        toast(t('Select a member.', 'اختار عضو.'), 'err');
        return;
      }
      body.memberId = selectedMember.id;
    } else {
      body.newMember = {
        fullName: document.getElementById('nmName').value.trim(),
        fullNameAr: document.getElementById('nmNameAr').value.trim() || null,
        phoneNumber: document.getElementById('nmPhone').value.trim(),
        dateOfBirth: document.getElementById('nmDob').value || null,
        referralCode: document.getElementById('nmReferralCode').value.trim() || null
      };
    }
    const promo = document.getElementById('promoCode').value.trim();
    if (promo) body.promoCode = promo;
    const ref = document.getElementById('saleReferralCode').value.trim();
    if (ref) body.referralCode = ref;
    if (canDiscount) {
      const amount = Number(document.getElementById('discAmount').value) || 0;
      const reason = document.getElementById('discReason').value.trim();
      if (amount > 0) {
        if (!reason) {
          toast(t('Discount reason required.', 'سبب الخصم مطلوب.'), 'err');
          return;
        }
        body.manualDiscount = { amount: amount, reason: reason };
      }
    }
    if (!payments.length) {
      toast(t('Add a payment amount.', 'ضيف مبلغ الدفع.'), 'err');
      return;
    }
    if (partial) {
      if (!dueDate) {
        toast(t('Due date required for partial payment.', 'تاريخ الاستحقاق مطلوب للدفع الجزئي.'), 'err');
        return;
      }
      body.partialPayment = { dueDate: dueDate };
    }
    await postSale(body);
  }

  async function postSale(body) {
    const key = ensureIdemKey();
    const box = document.getElementById('saleResult');
    box.style.display = 'block';
    box.className = 'result';
    box.textContent = t('Submitting…', 'جاري الإرسال…');

    const res = await api('POST', '/sales', body, { 'X-Idempotency-Key': key });

    if (!res.ok) {
      const title = res.data && res.data.title;
      const detail = res.data && (res.data.detail || res.data.message || res.data.error);
      if (title === 'PROMO_RACE_LOST') {
        promoPreview = null;
        document.getElementById('promoCode').value = '';
        document.getElementById('promoStatus').textContent = t(
          'Promo cleared — check the code again, then retry.',
          'اتمسح كود الخصم — تأكد من الكود وحاول تاني.'
        );
        clearIdemKey();
        ensureIdemKey();
      }
      if (title === 'OPEN_SHIFT_REQUIRED') {
        shiftOk = false;
        document.getElementById('shiftGate').style.display = 'flex';
        document.getElementById('posWorkspace').classList.add('blocked');
      }
      if (title === 'FEATURE_DISABLED') {
        setSalesDisabledBanner(true);
      }
      if (title === 'INSUFFICIENT_STOCK' || title === 'STOCK_UNSELLABLE_EXPIRED') {
        showStockBlock(title, detail);
      } else {
        clearStockBlock();
      }
      box.className = 'result err';
      box.textContent = problemMessage(res.data, res.status);
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }

    clearStockBlock();
    setSalesDisabledBanner(false);
    const sale = res.data;
    clearIdemKey();
    const due = sale.totals && Number(sale.totals.amountDue);
    const warnList = (sale.warnings || []).filter(Boolean);
    const isRetailSale = posMode === 'retail';
    const cardMemberId =
      !isRetailSale && selectedMember && selectedMember.id ? selectedMember.id : null;
    box.className = 'result desk-receipt' + (warnList.length ? ' warn' : '');
    box.innerHTML =
      '<div class="receipt-ok"><i class="ti ti-circle-check"></i> <strong>' +
      esc(t('Sale complete', 'تم البيع')) +
      '</strong></div>' +
      (sale.isReplay
        ? '<div class="muted">' +
          esc(t('Already recorded — not charged twice.', 'متسجلة قبل كده — متتحسبتش مرتين.')) +
          '</div>'
        : '') +
      '<div class="receipt-money">' +
      esc(t('Total', 'الإجمالي')) +
      ' <strong>' +
      esc(money(sale.totals && sale.totals.total)) +
      '</strong><br>' +
      esc(t('Paid', 'المدفوع')) +
      ' <strong>' +
      esc(money(sale.totals && sale.totals.paid)) +
      '</strong>' +
      (due > 0
        ? '<br>' +
          esc(t('Still due', 'الباقي')) +
          ' <strong class="due-amt">' +
          esc(money(due)) +
          '</strong>'
        : '') +
      '</div>' +
      (warnList.length ? '<div class="muted">' + esc(warnList.join(' · ')) + '</div>' : '') +
      (isRetailSale
        ? '<div id="invoiceReadyLine" class="muted">' +
          esc(t('Preparing invoice for print…', 'بنحضّر الفاتورة للطباعة…')) +
          '</div>' +
          '<div class="receipt-print-row">' +
          '<button type="button" class="btn primary full" id="btnPrintReceipt" disabled>' +
          '<i class="ti ti-printer"></i> ' +
          esc(t('Print receipt', 'اطبع الإيصال')) +
          '</button>' +
          '<button type="button" class="btn secondary full" id="btnStartNextSale">' +
          esc(t('Next sale', 'بيع جديد')) +
          '</button></div>'
        : (due > 0
            ? '<div class="receipt-due-next">' +
              esc(
                t(
                  'Balance left — collect it below, or later from Debtors.',
                  'في باقي — حصه تحت، أو بعدين من المدينين.'
                )
              ) +
              '</div>'
            : '') +
          '<div class="receipt-print-row">' +
          (cardMemberId
            ? '<button type="button" class="btn primary full" id="btnPrintMemberCard">' +
              '<i class="ti ti-barcode"></i> ' +
              esc(t('Print member card', 'اطبع كارنيه العضو')) +
              '</button>'
            : '') +
          '<button type="button" class="btn secondary full" id="btnStartNextSale">' +
          esc(t('Start next sale', 'ابدأ بيع جديد')) +
          '</button></div>');

    if (isRetailSale) {
      retailCart = [];
      renderRetailCart();
      if (sale.invoiceStatus === 'skipped' || sale.invoiceStatus === 'not_applicable') {
        const statusEl = document.getElementById('invoiceReadyLine');
        const printBtn = document.getElementById('btnPrintReceipt');
        if (statusEl) {
          statusEl.textContent = t('No invoice for this sale (nothing to print).', 'مفيش فاتورة للبيع ده (مفيش طباعة).');
        }
        if (printBtn) printBtn.disabled = true;
        const nextBtn = document.getElementById('btnStartNextSale');
        if (nextBtn) {
          nextBtn.onclick = function () {
            document.getElementById('btnReset').click();
          };
        }
      } else {
        wireRetailPrintActions(sale);
      }
    } else {
      const cardBtn = document.getElementById('btnPrintMemberCard');
      if (cardBtn && cardMemberId) {
        cardBtn.onclick = function () {
          openMemberCardPrint(cardMemberId, true);
        };
        // Auto-offer print after membership sale (MAC-P0 Phase 1)
        openMemberCardPrint(cardMemberId, true);
      }
      const nextBtn = document.getElementById('btnStartNextSale');
      if (nextBtn) {
        nextBtn.onclick = function () {
          document.getElementById('btnReset').click();
        };
      }
    }

    if (due > 0) {
      document.getElementById('debtSaleId').value = sale.saleId;
      const debtAmt = document.getElementById('debtAmount');
      if (debtAmt && !debtAmt.value) debtAmt.value = String(Number(due.toFixed(2)));
      const debtCard = document.getElementById('debtPayCard');
      if (debtCard && !isRetailSale) {
        debtCard.hidden = false;
        debtCard.style.display = '';
        try {
          debtCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (_) {}
      }
    }
    toast(
      sale.isReplay
        ? t('Already recorded — not charged twice.', 'متسجلة قبل كده — متتحسبتش مرتين.')
        : t('Sale completed.', 'تم البيع.'),
      'ok'
    );
  }

  document.getElementById('btnSell').addEventListener('click', function () {
    submitSale();
  });
  const btnPayCash = document.getElementById('btnPayCash');
  if (btnPayCash) {
    btnPayCash.addEventListener('click', function () {
      const total = estimateTotal();
      if (total == null || !(total > 0)) {
        toast(t('Add products first.', 'ضيف منتجات الأول.'), 'err');
        return;
      }
      setSinglePayment('cash', total);
      submitSale();
    });
  }
  const btnPayCard = document.getElementById('btnPayCard');
  if (btnPayCard) {
    btnPayCard.addEventListener('click', function () {
      const total = estimateTotal();
      if (total == null || !(total > 0)) {
        toast(t('Add products first.', 'ضيف منتجات الأول.'), 'err');
        return;
      }
      setSinglePayment('card_paymob', total);
      submitSale();
    });
  }

  document.getElementById('btnReset').addEventListener('click', () => {
    closePosPrint();
    clearIdemKey();
    clearStockBlock();
    selectedMember = null;
    promoPreview = null;
    retailCart = [];
    retailMemberMode = 'none';
    document.getElementById('selectedMember').textContent = t('No member selected', 'مفيش عضو متختار');
    document.getElementById('selectedMember').classList.remove('has-member');
    document.getElementById('promoCode').value = '';
    document.getElementById('promoStatus').textContent = t(
      'Optional — leave empty if none.',
      'اختياري — سيبه فاضي لو مفيش.'
    );
    document.getElementById('discAmount').value = '0';
    document.getElementById('discReason').value = '';
    document.getElementById('partialOpt').checked = false;
    document.getElementById('dueDateWrap').style.display = 'none';
    document.getElementById('payLegs').innerHTML = '';
    document.getElementById('barcodeInput').value = '';
    document.getElementById('productSearch').value = '';
    document.getElementById('productResults').innerHTML = '';
    addLeg('cash', '');
    document.getElementById('saleResult').style.display = 'none';
    ensureIdemKey();
    selectPlanById('');
    renderRetailCart();
    if (posMode === 'retail') applyRetailMemberMode();
    updateEstimate();
    updateSellEnabled();
  });

  const btnPosPrintClose = document.getElementById('btnPosPrintClose');
  if (btnPosPrintClose) btnPosPrintClose.onclick = closePosPrint;
  const btnPosPrintDo = document.getElementById('btnPosPrintDo');
  if (btnPosPrintDo) {
    btnPosPrintDo.onclick = function () {
      const frame = document.getElementById('posPrintFrame');
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (_) {
        toast(t('Print failed — try again.', 'فشلت الطباعة — حاول تاني.'), 'err');
      }
    };
  }
  const posPrintOverlay = document.getElementById('posPrintOverlay');
  if (posPrintOverlay) {
    posPrintOverlay.addEventListener('click', function (e) {
      if (e.target === posPrintOverlay) closePosPrint();
    });
  }

  // ── Debt payment ──────────────────────────────────────────────
  document.getElementById('btnDebtPay').addEventListener('click', async () => {
    const saleId = document.getElementById('debtSaleId').value.trim();
    const method = document.getElementById('debtMethod').value;
    const amount = Number(document.getElementById('debtAmount').value);
    const out = document.getElementById('debtResult');
    if (!saleId || !(amount > 0)) {
      toast(t('Sale number and amount are required.', 'رقم الفاتورة والمبلغ مطلوبين.'), 'err');
      return;
    }
    if (!shiftOk && method === 'cash') {
      toast(t('Cash collections need an open shift.', 'تحصيل الكاش محتاج وردية مفتوحة.'), 'err');
      return;
    }
    const res = await api('POST', '/sales/' + saleId + '/payments', { method, amount });
    out.style.display = 'block';
    if (!res.ok) {
      out.className = 'result err';
      out.textContent = problemMessage(res.data, res.status);
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    const sale = res.data;
    out.className = 'result';
    out.innerHTML =
      esc(t('Payment recorded', 'اتسجلت الدفعة')) +
      ' · ' +
      esc(t('Still due', 'الباقي')) +
      ' ' +
      esc(money(sale.totals && sale.totals.amountDue)) +
      (sale.receiptUrl
        ? '<br><a href="' + esc(sale.receiptUrl) + '" target="_blank">' + esc(t('Receipt', 'إيصال')) + '</a>'
        : '');
    toast(t('Payment recorded.', 'اتسجلت الدفعة.'), 'ok');
  });

  // boot — paint requested mode immediately; settle URL + nav after probes
  if (!canSell) {
    toast(t('You need permission to sell.', 'محتاج صلاحية البيع.'), 'err');
    document.getElementById('btnSell').disabled = true;
  }
  addLeg('cash', '');
  ensureIdemKey();
  if (desiredUrlMode() === 'retail') {
    inventoryOn = true;
    setPosMode('retail', { force: true, skipUrl: true });
  } else {
    setPosMode('membership', { skipUrl: true });
  }
  Promise.all([checkShift(), loadPlans(), probeInventoryAndUi(), refreshSalesFeatureBanner()])
    .then(function () {
      if (desiredUrlMode() === 'retail' && inventoryOn) setPosMode('retail');
      else setPosMode('membership');
      applyLocaleBits();
    })
    .catch(function () {
      if (desiredUrlMode() === 'retail' && inventoryOn) setPosMode('retail');
      else setPosMode('membership');
      applyLocaleBits();
    });

  window.addEventListener('gfp:locale', function () {
    applyLocaleBits();
    document.querySelectorAll('#payLegs .pay-leg select').forEach(function (sel) {
      const v = sel.value;
      Array.from(sel.options).forEach(function (opt) {
        opt.textContent = methodLabel(opt.value);
      });
      sel.value = v;
    });
    if (posMode === 'retail') {
      applyRetailMemberMode();
      renderRetailCart();
      const sellBtn = document.getElementById('btnSell');
      if (sellBtn) {
        sellBtn.innerHTML =
          '<i class="ti ti-check"></i> <span>' +
          esc(t('Complete retail sale', 'تمّم بيع المنتجات')) +
          '</span>';
      }
    }
  });
})();
