/**
 * Inventory products + categories (FE-INVS-1).
 * Real APIs only via GfpApi + GfpInventoryApi.paths.
 */
(function () {
  'use strict';

  var Gfp = window.GfpApi;
  var Authz = window.GfpAuthz;
  var Inv = window.GfpInventoryApi;

  function getUser() {
    if (Gfp && Gfp.tokens) return Gfp.tokens.getUser();
    try {
      return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user'));
    } catch (e) {
      return null;
    }
  }

  var user = getUser();
  if (!user) {
    window.location.href = '/auth/login/';
    return;
  }
  if (!Authz || !(Authz.useCan('inventory.manage') || Authz.useCan('inventory.purchase'))) {
    window.location.href = '/dashboard/inventory/';
    return;
  }

  var canManage = Authz.useCan('inventory.manage');
  var canSeeCost =
    Authz.useCan('inventory.manage') ||
    Authz.useCan('inventory.purchase') ||
    Authz.useCan('reports.financial.view');
  var paths = (Inv && Inv.paths) || {};
  var categories = [];
  var products = [];
  var editingId = null;
  var searchTimer = null;
  var VIEW_KEY = 'gfp_inv_products_view';
  var viewMode = 'table';
  var stockByProduct = {};
  var stockHydrating = false;
  /** '' | 'low' | 'oos' — from ?alert= on inventory home deep-links */
  var stockAlert = '';
  try {
    var alertQ = new URLSearchParams(window.location.search).get('alert');
    if (alertQ === 'low' || alertQ === 'oos') stockAlert = alertQ;
  } catch (e) { /* ignore */ }
  try {
    var savedView = localStorage.getItem(VIEW_KEY);
    if (savedView === 'table' || savedView === 'cards') viewMode = savedView;
  } catch (e) { /* ignore */ }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(Number(n));
  }
  function toast(msg, type) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    setTimeout(function () {
      el.classList.remove('show');
    }, 4200);
  }
  function apiError(r) {
    if (!r) return 'Request failed';
    var e = r.error || {};
    var d = r.data || {};
    var detail = e.message || d.detail || d.error || d.message || e.title || d.title || '';
    if (detail && detail.indexOf(' / ') !== -1) detail = detail.split(' / ')[0].trim();
    return detail || ('Request failed (' + r.status + ')');
  }
  function openModal(id) {
    document.getElementById(id).hidden = false;
  }
  function closeModal(id) {
    document.getElementById(id).hidden = true;
  }

  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closeModal(btn.getAttribute('data-close'));
    });
  });

  (function initChrome() {
    var ini = String(user.fullName || 'U')
      .split(/\s+/)
      .map(function (w) {
        return w[0];
      })
      .join('')
      .substring(0, 2)
      .toUpperCase();
    var a = document.getElementById('userAvatar');
    var n = document.getElementById('userName');
    var o = document.getElementById('userRole');
    if (a) a.textContent = ini;
    if (n) n.textContent = user.fullName || 'User';
    if (o) o.textContent = user.role || 'Staff';
    var btn = document.getElementById('btnLogout');
    if (btn) {
      btn.addEventListener('click', function () {
        if (Gfp) Gfp.logout();
        else window.location.href = '/auth/login/';
      });
    }
    if (canManage) {
      var ma = document.getElementById('manageActions');
      if (ma) ma.hidden = false;
    }
  })();

  (async function loadGym() {
    if (!Gfp) return;
    var r = await Gfp.get('/settings');
    if (r.ok && r.data) {
      var gn = document.getElementById('gymName');
      var ga = document.getElementById('gymNameAr');
      if (gn) gn.textContent = r.data.gymName || 'GymFlowPro';
      if (ga) ga.textContent = r.data.gymNameAr || '';
    }
  })();

  function fillCategorySelects() {
    var I18n = window.GfpI18n;
    var allLabel =
      I18n && I18n.tLabel ? I18n.tLabel('All categories', 'كل التصنيفات') : 'All categories';
    var noneLabel = I18n && I18n.tLabel ? I18n.tLabel('— None —', '— بدون —') : '— None —';
    var filter = document.getElementById('filterCategory');
    var formSel = document.getElementById('pCategory');
    var curF = filter.value;
    var curP = formSel.value;
    filter.innerHTML = '<option value="">' + esc(allLabel) + '</option>';
    formSel.innerHTML = '<option value="">' + esc(noneLabel) + '</option>';
    categories
      .slice()
      .sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      })
      .forEach(function (c) {
        var label = c.name + (c.isActive ? '' : ' (inactive)');
        filter.appendChild(new Option(label, c.id));
        formSel.appendChild(new Option(c.name, c.id));
      });
    if (curF) filter.value = curF;
    if (curP) formSel.value = curP;
  }

  async function loadCategories() {
    var r = await Gfp.get(paths.categories());
    if (!r.ok) {
      toast(apiError(r), 'err');
      categories = [];
      return;
    }
    categories = Array.isArray(r.data) ? r.data : [];
    fillCategorySelects();
  }

  function listQuery() {
    return {
      q: document.getElementById('filterQ').value.trim() || undefined,
      categoryId: document.getElementById('filterCategory').value || undefined,
      includeArchived: document.getElementById('filterArchived').checked ? 'true' : undefined
    };
  }

  async function loadProducts() {
    var host = document.getElementById('tableHost');
    host.innerHTML = '<div class="loading-state"><div class="loader"></div><p>Loading products…</p></div>';
    var r = await Gfp.get(paths.products(listQuery()));
    if (!r.ok) {
      host.innerHTML =
        '<div class="error-state"><p>' + esc(apiError(r)) + '</p></div>';
      return;
    }
    products = Array.isArray(r.data) ? r.data : [];
    stockByProduct = {};
    renderProducts();
    hydrateStock();
  }

  async function hydrateStock() {
    if (stockHydrating) return;
    stockHydrating = true;
    stockByProduct = {};
    try {
      var br = await Gfp.get(paths.stockBoard());
      if (br.ok && Array.isArray(br.data)) {
        br.data.forEach(function (row) {
          if (!row || !row.productId) return;
          stockByProduct[row.productId] = {
            onHand: row.onHand != null ? Number(row.onHand) : 0,
            available:
              row.available != null
                ? Number(row.available)
                : row.onHand != null
                  ? Number(row.onHand)
                  : 0
          };
        });
      }
    } catch (e) {
      /* board failed — badges stay empty until next refresh */
    }
    products.forEach(function (p) {
      if (p.trackStock && !p.isArchived && !Object.prototype.hasOwnProperty.call(stockByProduct, p.id)) {
        stockByProduct[p.id] = { onHand: 0, available: 0 };
      }
    });
    stockHydrating = false;
    renderProducts();
  }

  function setViewMode(mode) {
    viewMode = mode === 'table' ? 'table' : 'cards';
    try {
      localStorage.setItem(VIEW_KEY, viewMode);
    } catch (e) { /* ignore */ }
    document.querySelectorAll('.view-btn').forEach(function (b) {
      b.classList.toggle('act', b.getAttribute('data-view') === viewMode);
    });
    renderProducts();
  }

  function thumbHtml(url, large) {
    if (url) {
      return (
        '<img class="' +
        (large ? '' : 'thumb') +
        '" src="' +
        esc(url) +
        '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling&&(this.nextElementSibling.hidden=false)">' +
        (large
          ? '<div class="ph" hidden><i class="ti ti-photo-off"></i><span>Broken link</span></div>'
          : '<span class="thumb-ph" hidden><i class="ti ti-photo-off"></i></span>')
      );
    }
    if (large) {
      return '<div class="ph"><i class="ti ti-photo"></i><span>No photo</span></div>';
    }
    return '<span class="thumb-ph"><i class="ti ti-photo"></i></span>';
  }

  function statusBadge(p) {
    if (p.isArchived) return '<span class="badge badge-arch">مؤرشف</span>';
    if (p.isActive) return '<span class="badge badge-ok">نشط</span>';
    return '<span class="badge badge-off">متوقف</span>';
  }

  function stockBadgeHtml(p) {
    if (!p.trackStock) return '<span class="stock-badge stock-na" title="لا يتتبع مخزون">—</span>';
    if (!Object.prototype.hasOwnProperty.call(stockByProduct, p.id)) {
      return '<span class="stock-badge stock-pending">…</span>';
    }
    var entry = stockByProduct[p.id];
    if (entry == null || (typeof entry === 'object' && entry.available == null && entry.onHand == null)) {
      if (entry == null || Number.isNaN(Number(entry))) return '<span class="stock-badge stock-na">—</span>';
    }
    var avail =
      typeof entry === 'object'
        ? Number(entry.available != null ? entry.available : entry.onHand)
        : Number(entry);
    var onHand = typeof entry === 'object' ? Number(entry.onHand != null ? entry.onHand : avail) : avail;
    if (Number.isNaN(avail)) return '<span class="stock-badge stock-na">—</span>';
    var min = Number(p.reorderMinQty) || 0;
    var cls = 'stock-ok';
    if (avail <= 0 && onHand > 0) cls = 'stock-out';
    else if (avail <= 0) cls = 'stock-out';
    else if (min > 0 && avail <= min) cls = 'stock-low';
    return (
      '<span class="stock-badge ' +
      cls +
      '" data-stock-available="' +
      esc(String(avail)) +
      '" data-stock-onhand="' +
      esc(String(onHand)) +
      '" title="' +
      esc(avail <= 0 && onHand > 0 ? 'منتهي — مش هيتباع' : 'قابل للبيع') +
      '">' +
      esc(String(avail)) +
      '</span>'
    );
  }

  function bindProductActions(host) {
    host.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openProductEditor(b.getAttribute('data-edit'));
      });
    });
    host.querySelectorAll('[data-archive]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        archiveProduct(b.getAttribute('data-archive'));
      });
    });
    host.querySelectorAll('[data-unarchive]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        unarchiveProduct(b.getAttribute('data-unarchive'));
      });
    });
    host.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        openProductDetail(b.getAttribute('data-open'));
      });
    });
  }

  function productActionsHtml(p) {
    var html = '<div class="icon-actions">';
    if (canManage) {
      html +=
        '<button type="button" class="btn-icon-sq edit" data-edit="' +
        esc(p.id) +
        '" title="تعديل"><i class="ti ti-pencil"></i></button>';
    }
    html +=
      '<a class="btn-icon-sq stock" href="/dashboard/inventory/stock/?productId=' +
      encodeURIComponent(p.id) +
      '" title="المخزون / Stock"><i class="ti ti-arrows-exchange"></i></a>';
    if (canManage) {
      if (p.isArchived) {
        html +=
          '<button type="button" class="btn-icon-sq unarch" data-unarchive="' +
          esc(p.id) +
          '" title="استعادة"><i class="ti ti-archive-off"></i></button>';
      } else {
        html +=
          '<button type="button" class="btn-icon-sq arch" data-archive="' +
          esc(p.id) +
          '" title="أرشفة"><i class="ti ti-trash"></i></button>';
      }
    }
    html += '</div>';
    return html;
  }

  function stockEntrySellable(entry) {
    if (entry == null) return null;
    if (typeof entry === 'object') {
      var a = entry.available != null ? entry.available : entry.onHand;
      return a == null || Number.isNaN(Number(a)) ? null : Number(a);
    }
    var n = Number(entry);
    return Number.isNaN(n) ? null : n;
  }

  function openProductDetail(id) {
    var p = products.find(function (x) {
      return x.id === id;
    });
    if (!p) return;
    var profit =
      canSeeCost && p.costPrice != null
        ? Number(p.sellPrice || 0) - Number(p.costPrice || 0)
        : null;
    var sellable = stockEntrySellable(stockByProduct[p.id]);
    var qty =
      Object.prototype.hasOwnProperty.call(stockByProduct, p.id) && sellable != null
        ? String(sellable)
        : p.trackStock
          ? '…'
          : '—';
    var img = p.imageUrl
      ? '<img class="detail-hero-img" src="' + esc(p.imageUrl) + '" alt="">'
      : '<div class="detail-hero-ph"><i class="ti ti-photo"></i></div>';
    document.getElementById('detailTitle').textContent = p.nameAr || p.name || 'المنتج';
    document.getElementById('detailBody').innerHTML =
      '<div class="detail-hero">' +
      img +
      '<div>' +
      '<div style="font-family:var(--fd);font-size:20px;font-weight:700">' +
      esc(p.name) +
      '</div>' +
      (p.nameAr
        ? '<div dir="rtl" style="color:var(--ltt);margin-top:2px">' + esc(p.nameAr) + '</div>'
        : '') +
      '<div class="barcode-cell" style="margin-top:6px">' +
      esc(p.barcode || p.sku) +
      '</div>' +
      '<div style="margin-top:8px">' +
      statusBadge(p) +
      ' ' +
      stockBadgeHtml(p) +
      '</div></div></div>' +
      '<div class="detail-kv">' +
      '<div class="kv"><div class="k">التصنيف</div><div class="v">' +
      esc(p.categoryName || '—') +
      '</div></div>' +
      '<div class="kv"><div class="k">الوحدة</div><div class="v">' +
      esc(p.unitOfMeasure || 'pcs') +
      '</div></div>' +
      (canSeeCost
        ? '<div class="kv"><div class="k">سعر الشراء</div><div class="v">' +
          money(p.costPrice) +
          '</div></div>'
        : '') +
      '<div class="kv"><div class="k">سعر البيع</div><div class="v">' +
      money(p.sellPrice) +
      '</div></div>' +
      (profit != null
        ? '<div class="kv"><div class="k">الربح للقطعة</div><div class="v profit">' +
          money(profit) +
          '</div></div>'
        : '') +
      '<div class="kv"><div class="k">الحد الأدنى</div><div class="v">' +
      esc(String(p.reorderMinQty != null ? p.reorderMinQty : 0)) +
      '</div></div>' +
      '<div class="kv"><div class="k">المخزون</div><div class="v">' +
      esc(qty) +
      '</div></div>' +
      '<div class="kv"><div class="k">العملة</div><div class="v">' +
      esc(p.currency || 'EGP') +
      '</div></div>' +
      '</div>' +
      '<div class="detail-actions">' +
      (canManage
        ? '<button type="button" class="btn-create" data-edit="' +
          esc(p.id) +
          '"><i class="ti ti-pencil"></i> تعديل</button>'
        : '') +
      '<a class="btn-secondary" href="/dashboard/inventory/stock/?productId=' +
      encodeURIComponent(p.id) +
      '" style="text-decoration:none"><i class="ti ti-history"></i> حركات المخزون</a>' +
      '</div>';
    document.getElementById('detailDrawer').hidden = false;
    var editBtn = document.querySelector('#detailBody [data-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        document.getElementById('detailDrawer').hidden = true;
        openProductEditor(p.id);
      });
    }
  }

  function matchesStockAlert(p) {
    if (!stockAlert) return true;
    if (!p.trackStock || p.isArchived) return false;
    if (!Object.prototype.hasOwnProperty.call(stockByProduct, p.id)) return true;
    var q = stockEntrySellable(stockByProduct[p.id]);
    if (q == null || Number.isNaN(q)) return false;
    if (stockAlert === 'oos') return q <= 0;
    var min = Number(p.reorderMinQty) || 0;
    return q > 0 && min > 0 && q <= min;
  }

  function visibleProducts() {
    return products.filter(matchesStockAlert);
  }

  function renderAlertBanner() {
    var el = document.getElementById('alertBanner');
    if (!el) return;
    if (!stockAlert) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    var label =
      stockAlert === 'oos'
        ? 'نفد من المخزون / Out of stock'
        : 'يحتاج طلب / Low stock';
    el.hidden = false;
    el.innerHTML =
      '<i class="ti ti-alert-triangle"></i> <span>' +
      esc(label) +
      '</span> <a href="/dashboard/inventory/products/">إظهار الكل / Show all</a>';
  }

  function renderProducts() {
    var host = document.getElementById('tableHost');
    var list = visibleProducts();
    var active = products.filter(function (p) {
      return p.isActive && !p.isArchived;
    }).length;
    var archived = products.filter(function (p) {
      return p.isArchived;
    }).length;
    document.getElementById('statTotal').textContent = String(list.length);
    document.getElementById('statActive').textContent = String(active);
    document.getElementById('statArchived').textContent = String(archived);
    renderAlertBanner();

    if (!products.length) {
      host.innerHTML =
        '<div class="empty-state table-wrap"><i class="ti ti-box-off" style="font-size:32px"></i><p>لا منتجات بعد</p><p style="font-size:13px;margin-top:6px">أضف منتجاً والصق رابط صورة ليظهر في القائمة.</p></div>';
      return;
    }

    if (!list.length) {
      host.innerHTML =
        '<div class="empty-state table-wrap"><i class="ti ti-circle-check" style="font-size:32px"></i><p>لا أصناف في هذا التنبيه</p><p style="font-size:13px;margin-top:6px"><a href="/dashboard/inventory/products/">عرض كل المنتجات</a></p></div>';
      return;
    }

    if (viewMode === 'cards') {
      host.innerHTML =
        '<div class="product-grid">' +
        list
          .map(function (p) {
            return (
              '<article class="product-card' +
              (p.isArchived ? ' archived' : '') +
              '">' +
              '<div class="product-card-img" data-open="' +
              esc(p.id) +
              '" style="cursor:pointer">' +
              thumbHtml(p.imageUrl, true) +
              '</div>' +
              '<div class="product-card-body">' +
              '<button type="button" class="prod-link" data-open="' +
              esc(p.id) +
              '">' +
              esc(p.name) +
              '</button>' +
              (p.nameAr
                ? '<div class="product-card-name-ar" dir="rtl">' + esc(p.nameAr) + '</div>'
                : '') +
              '<div class="product-card-meta"><span class="cat-tag">' +
              esc(p.categoryName || 'بدون') +
              '</span></div>' +
              '<div class="product-card-prices">' +
              (canSeeCost
                ? '<span class="product-card-cost">شراء ' + money(p.costPrice) + '</span>'
                : '') +
              '<span class="product-card-price">' +
              money(p.sellPrice) +
              '</span></div>' +
              '<div class="product-card-foot">' +
              stockBadgeHtml(p) +
              statusBadge(p) +
              '</div>' +
              productActionsHtml(p) +
              '</div></article>'
            );
          })
          .join('') +
        '</div>';
      bindProductActions(host);
      return;
    }

    var rows = list
      .map(function (p) {
        return (
          '<tr class="' +
          (p.isArchived ? 'archived' : '') +
          '">' +
          '<td>' +
          thumbHtml(p.imageUrl, false) +
          '</td>' +
          '<td class="barcode-cell">' +
          esc(p.barcode || p.sku) +
          '</td>' +
          '<td><button type="button" class="prod-link" data-open="' +
          esc(p.id) +
          '">' +
          esc(p.name) +
          '</button>' +
          (p.nameAr
            ? '<div style="color:var(--ltt);font-size:12px" dir="rtl">' + esc(p.nameAr) + '</div>'
            : '') +
          '</td>' +
          '<td><span class="cat-tag">' +
          esc(p.categoryName || 'بدون') +
          '</span></td>' +
          '<td class="price-buy">' +
          (canSeeCost ? money(p.costPrice) : '—') +
          '</td>' +
          '<td class="price-sell">' +
          money(p.sellPrice) +
          '</td>' +
          '<td>' +
          stockBadgeHtml(p) +
          '</td>' +
          '<td>' +
          statusBadge(p) +
          '</td>' +
          '<td>' +
          productActionsHtml(p) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    host.innerHTML =
      '<div class="table-wrap"><table class="inv"><thead><tr>' +
      '<th>صورة</th><th>الباركود</th><th>المنتج</th><th>التصنيف</th><th>سعر الشراء</th><th>سعر البيع</th><th>المخزون</th><th>الحالة</th><th>إجراءات</th>' +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table></div>';
    bindProductActions(host);
  }

  function updateImagePreview() {
    var url = (document.getElementById('pImage').value || '').trim();
    var box = document.getElementById('pImagePreview');
    if (!box) return;
    if (!url) {
      box.innerHTML = '<i class="ti ti-photo"></i><span>No photo</span>';
      return;
    }
    box.innerHTML =
      '<img src="' +
      esc(url) +
      '" alt="Preview" onerror="this.parentNode.innerHTML=\'<i class=\\\'ti ti-photo-off\\\'></i><span>Broken link</span>\'">';
  }

  function renderTable() {
    renderProducts();
  }

  function syncTrackFlags() {
    var trackStock = document.getElementById('pTrackStock').checked;
    var batch = document.getElementById('pTrackBatch');
    var expiry = document.getElementById('pTrackExpiry');
    if (!trackStock) {
      batch.checked = false;
      expiry.checked = false;
      batch.disabled = true;
      expiry.disabled = true;
    } else {
      batch.disabled = false;
      expiry.disabled = false;
    }
    if (expiry.checked && !batch.checked) batch.checked = true;
  }

  document.getElementById('pTrackStock').addEventListener('change', syncTrackFlags);
  document.getElementById('pTrackExpiry').addEventListener('change', syncTrackFlags);
  document.getElementById('pTrackBatch').addEventListener('change', function () {
    if (!document.getElementById('pTrackBatch').checked) {
      document.getElementById('pTrackExpiry').checked = false;
    }
  });

  function resetProductForm() {
    editingId = null;
    document.getElementById('productModalTitle').textContent = 'New product';
    document.getElementById('pSku').value = '';
    document.getElementById('pBarcode').value = '';
    document.getElementById('pName').value = '';
    document.getElementById('pNameAr').value = '';
    document.getElementById('pCategory').value = '';
    document.getElementById('pBrand').value = '';
    document.getElementById('pUom').value = 'pcs';
    document.getElementById('pCurrency').value = 'EGP';
    document.getElementById('pSell').value = '0';
    document.getElementById('pCost').value = '0';
    document.getElementById('pVat').value = '';
    document.getElementById('pReorder').value = '0';
    document.getElementById('pDesc').value = '';
    document.getElementById('pDescAr').value = '';
    document.getElementById('pImage').value = '';
    document.getElementById('pTaxable').checked = true;
    document.getElementById('pTrackStock').checked = true;
    document.getElementById('pTrackBatch').checked = false;
    document.getElementById('pTrackExpiry').checked = false;
    document.getElementById('pFractional').checked = false;
    document.getElementById('pSellable').checked = true;
    document.getElementById('pPurchasable').checked = true;
    document.getElementById('pVisibleToMembers').checked = false;
    document.getElementById('pActive').checked = true;
    document.getElementById('productFormHint').textContent = '';
    syncTrackFlags();
    updateImagePreview();
  }

  function fillProductForm(p) {
    editingId = p.id;
    document.getElementById('productModalTitle').textContent = 'Edit product';
    document.getElementById('pSku').value = p.sku || '';
    document.getElementById('pBarcode').value = p.barcode || '';
    document.getElementById('pName').value = p.name || '';
    document.getElementById('pNameAr').value = p.nameAr || '';
    document.getElementById('pCategory').value = p.categoryId || '';
    document.getElementById('pBrand').value = p.brand || '';
    document.getElementById('pUom').value = p.unitOfMeasure || 'pcs';
    document.getElementById('pCurrency').value = p.currency || 'EGP';
    document.getElementById('pSell').value = p.sellPrice != null ? p.sellPrice : 0;
    document.getElementById('pCost').value = p.costPrice != null ? p.costPrice : 0;
    document.getElementById('pVat').value =
      p.vatRatePercent != null && p.vatRatePercent !== '' ? p.vatRatePercent : '';
    document.getElementById('pReorder').value = p.reorderMinQty != null ? p.reorderMinQty : 0;
    document.getElementById('pDesc').value = p.description || '';
    document.getElementById('pDescAr').value = p.descriptionAr || '';
    document.getElementById('pImage').value = p.imageUrl || '';
    document.getElementById('pTaxable').checked = !!p.taxable;
    document.getElementById('pTrackStock').checked = !!p.trackStock;
    document.getElementById('pTrackBatch').checked = !!p.trackBatch;
    document.getElementById('pTrackExpiry').checked = !!p.trackExpiry;
    document.getElementById('pFractional').checked = !!p.allowFractionalQty;
    document.getElementById('pSellable').checked = !!p.isSellable;
    document.getElementById('pPurchasable').checked = !!p.isPurchasable;
    document.getElementById('pVisibleToMembers').checked = !!(
      p.isVisibleToMembers != null ? p.isVisibleToMembers : p.visibleToMembers
    );
    document.getElementById('pActive').checked = !!p.isActive;
    document.getElementById('productFormHint').textContent = '';
    syncTrackFlags();
    updateImagePreview();
  }

  async function openProductEditor(id) {
    if (!canManage) return;
    fillCategorySelects();
    if (!id) {
      resetProductForm();
      openModal('productModal');
      return;
    }
    var r = await Gfp.get(paths.product(id));
    if (!r.ok) {
      toast(apiError(r), 'err');
      return;
    }
    fillProductForm(r.data);
    openModal('productModal');
  }

  function readProductBody() {
    var vatRaw = document.getElementById('pVat').value.trim();
    return {
      categoryId: document.getElementById('pCategory').value || null,
      sku: document.getElementById('pSku').value.trim(),
      barcode: document.getElementById('pBarcode').value.trim() || null,
      name: document.getElementById('pName').value.trim(),
      nameAr: document.getElementById('pNameAr').value.trim() || null,
      description: document.getElementById('pDesc').value.trim() || null,
      descriptionAr: document.getElementById('pDescAr').value.trim() || null,
      brand: document.getElementById('pBrand').value.trim() || null,
      imageUrl: document.getElementById('pImage').value.trim() || null,
      unitOfMeasure: document.getElementById('pUom').value.trim() || 'pcs',
      sellPrice: Number(document.getElementById('pSell').value),
      costPrice: Number(document.getElementById('pCost').value),
      currency: (document.getElementById('pCurrency').value.trim() || 'EGP').toUpperCase(),
      taxable: document.getElementById('pTaxable').checked,
      vatRatePercent: vatRaw === '' ? null : Number(vatRaw),
      trackStock: document.getElementById('pTrackStock').checked,
      trackBatch: document.getElementById('pTrackBatch').checked,
      trackExpiry: document.getElementById('pTrackExpiry').checked,
      allowFractionalQty: document.getElementById('pFractional').checked,
      isSellable: document.getElementById('pSellable').checked,
      isPurchasable: document.getElementById('pPurchasable').checked,
      isVisibleToMembers: document.getElementById('pVisibleToMembers').checked,
      reorderMinQty: Number(document.getElementById('pReorder').value) || 0,
      isActive: document.getElementById('pActive').checked
    };
  }

  function validateProductClient(body) {
    if (!body.sku) return 'SKU is required';
    if (!body.name) return 'Name is required';
    if (body.sellPrice < 0 || body.costPrice < 0) return 'Prices must be ≥ 0';
    if (body.trackExpiry && !body.trackBatch) return 'Track expiry requires track batch';
    if (!body.trackStock && (body.trackBatch || body.trackExpiry))
      return 'Batch/expiry require track stock';
    return null;
  }

  document.getElementById('productForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!canManage) return;
    var body = readProductBody();
    var err = validateProductClient(body);
    var hint = document.getElementById('productFormHint');
    if (err) {
      hint.textContent = err;
      return;
    }
    hint.textContent = '';
    var btn = document.getElementById('btnSaveProduct');
    btn.disabled = true;
    var r = editingId
      ? await Gfp.put(paths.product(editingId), body)
      : await Gfp.post('/inventory/products', body);
    btn.disabled = false;
    if (!r.ok) {
      hint.textContent = apiError(r);
      toast(apiError(r), 'err');
      return;
    }
    toast(editingId ? 'Product updated' : 'Product created', 'ok');
    closeModal('productModal');
    await loadProducts();
  });

  async function archiveProduct(id) {
    if (!canManage || !confirm('Archive this product? It will be hidden from the default list.'))
      return;
    var r = await Gfp.post(paths.productArchive(id), {});
    if (!r.ok) {
      toast(apiError(r), 'err');
      return;
    }
    toast('Product archived', 'ok');
    await loadProducts();
  }

  async function unarchiveProduct(id) {
    if (!canManage) return;
    var r = await Gfp.post(paths.productUnarchive(id), {});
    if (!r.ok) {
      toast(apiError(r), 'err');
      return;
    }
    toast('Product restored', 'ok');
    await loadProducts();
  }

  function renderCategoryList() {
    var host = document.getElementById('categoryList');
    if (!categories.length) {
      host.innerHTML = '<div class="empty-state" style="padding:16px">No categories yet</div>';
      return;
    }
    host.innerHTML = categories
      .map(function (c) {
        return (
          '<div class="cat-row">' +
          '<div><strong>' +
          esc(c.name) +
          '</strong>' +
          (c.nameAr
            ? ' <span dir="rtl" style="color:var(--ltt)">' + esc(c.nameAr) + '</span>'
            : '') +
          '<div style="font-size:11px;color:var(--ltt)">sort ' +
          esc(c.sortOrder) +
          (c.isActive ? '' : ' · inactive') +
          '</div></div>' +
          (canManage
            ? '<button type="button" class="btn-link" data-cedit="' + esc(c.id) + '">Edit</button>'
            : '') +
          '</div>'
        );
      })
      .join('');
    host.querySelectorAll('[data-cedit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = categories.find(function (x) {
          return x.id === b.getAttribute('data-cedit');
        });
        if (!c) return;
        document.getElementById('cId').value = c.id;
        document.getElementById('cName').value = c.name || '';
        document.getElementById('cNameAr').value = c.nameAr || '';
        document.getElementById('cSort').value = c.sortOrder != null ? c.sortOrder : 0;
        document.getElementById('cActive').checked = !!c.isActive;
        document.getElementById('btnSaveCategory').textContent = 'Update';
      });
    });
  }

  function resetCategoryForm() {
    document.getElementById('cId').value = '';
    document.getElementById('cName').value = '';
    document.getElementById('cNameAr').value = '';
    document.getElementById('cSort').value = '0';
    document.getElementById('cActive').checked = true;
    document.getElementById('btnSaveCategory').textContent = 'Add';
  }

  document.getElementById('btnCategories').addEventListener('click', async function () {
    if (!canManage) return;
    resetCategoryForm();
    await loadCategories();
    renderCategoryList();
    openModal('categoryModal');
  });

  document.getElementById('categoryForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!canManage) return;
    var id = document.getElementById('cId').value;
    var body = {
      name: document.getElementById('cName').value.trim(),
      nameAr: document.getElementById('cNameAr').value.trim() || null,
      sortOrder: Number(document.getElementById('cSort').value) || 0,
      isActive: document.getElementById('cActive').checked
    };
    if (!body.name) {
      toast('Category name required', 'err');
      return;
    }
    var r = id
      ? await Gfp.put(paths.category(id), body)
      : await Gfp.post(paths.categories(), body);
    if (!r.ok) {
      toast(apiError(r), 'err');
      return;
    }
    toast(id ? 'Category updated' : 'Category created', 'ok');
    resetCategoryForm();
    await loadCategories();
    renderCategoryList();
  });

  document.getElementById('btnCreate').addEventListener('click', function () {
    openProductEditor(null);
  });
  document.getElementById('btnRefresh').addEventListener('click', loadProducts);
  document.getElementById('filterCategory').addEventListener('change', loadProducts);
  document.getElementById('filterArchived').addEventListener('change', loadProducts);
  document.getElementById('filterQ').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadProducts, 300);
  });
  document.querySelectorAll('.view-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setViewMode(btn.getAttribute('data-view'));
    });
  });
  document.getElementById('pImage').addEventListener('input', updateImagePreview);
  document.querySelectorAll('.view-btn').forEach(function (b) {
    b.classList.toggle('act', b.getAttribute('data-view') === viewMode);
  });
  var closeDetail = document.getElementById('btnCloseDetail');
  if (closeDetail) {
    closeDetail.addEventListener('click', function () {
      document.getElementById('detailDrawer').hidden = true;
    });
  }
  var detailOverlay = document.getElementById('detailDrawer');
  if (detailOverlay) {
    detailOverlay.addEventListener('click', function (ev) {
      if (ev.target === detailOverlay) detailOverlay.hidden = true;
    });
  }

  async function getByBarcode(code) {
    if (!code) return { ok: false, error: 'code required' };
    return Gfp.get(paths.productByBarcode(code));
  }
  if (Inv) Inv.getByBarcode = getByBarcode;

  (async function boot() {
    await loadCategories();
    await loadProducts();
  })();

  window.addEventListener('gfp:locale', function () {
    fillCategorySelects();
    renderAlertBanner();
  });
})();
