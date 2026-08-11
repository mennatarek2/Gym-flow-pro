/**
 * Purchase orders (FE-INVS-5). Real /api/inventory/purchase-orders* + suppliers/warehouses/products.
 */
(function () {
  'use strict';

  var Gfp = window.GfpApi;
  var Authz = window.GfpAuthz;
  var Inv = window.GfpInventoryApi;
  var I18n = window.GfpI18n;
  var paths = (Inv && Inv.paths) || {};

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
  if (!Authz || !Authz.useCan('inventory.view')) {
    window.location.href = '/dashboard/';
    return;
  }

  var canManage = Authz.useCan('inventory.manage');
  var canPurchase = Authz.useCan('inventory.purchase');
  var canSeeCost =
    canManage || canPurchase || Authz.useCan('reports.financial.view');
  var list = [];
  var current = null;
  var suppliers = [];
  var warehouses = [];
  /** @type {Record<string, any>} */
  var productById = {};

  function t(en, ar) {
    if (I18n && I18n.tLabel) return I18n.tLabel(en, ar);
    return en;
  }
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
    if (I18n && I18n.displayApiError) return I18n.displayApiError(r) || t('Request failed', 'فشل الطلب');
    if (!r) return t('Request failed', 'فشل الطلب');
    var e = r.error || {};
    var d = r.data || {};
    var detail = e.message || d.detail || d.error || d.message || e.title || d.title || '';
    if (detail && detail.indexOf(' / ') !== -1) detail = detail.split(' / ')[0].trim();
    return detail || t('Request failed', 'فشل الطلب') + ' (' + r.status + ')';
  }
  function openModal(id) {
    document.getElementById(id).hidden = false;
    if (I18n && I18n.applyDocumentLocale) I18n.applyDocumentLocale();
  }
  function closeModal(id) {
    document.getElementById(id).hidden = true;
  }
  var STATUS_LABELS = {
    draft: ['Draft', 'مسودة'],
    approved: ['Approved', 'معتمد'],
    partially_received: ['Partially received', 'استلام جزئي'],
    received: ['Received', 'مستلم'],
    cancelled: ['Cancelled', 'ملغى']
  };
  function statusLabel(st) {
    var pair = STATUS_LABELS[st];
    return pair ? t(pair[0], pair[1]) : st;
  }
  function statusBadge(st) {
    var cls = 'badge-draft';
    if (st === 'approved') cls = 'badge-approved';
    else if (st === 'partially_received') cls = 'badge-partial';
    else if (st === 'received') cls = 'badge-received';
    else if (st === 'cancelled') cls = 'badge-cancelled';
    return '<span class="badge ' + cls + '">' + esc(statusLabel(st)) + '</span>';
  }

  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () {
      closeModal(b.getAttribute('data-close'));
    });
  });

  (function chrome() {
    var ini = String(user.fullName || 'U')
      .split(/\s+/)
      .map(function (w) {
        return w[0];
      })
      .join('')
      .substring(0, 2)
      .toUpperCase();
    document.getElementById('userAvatar').textContent = ini;
    document.getElementById('userName').textContent = user.fullName || 'User';
    document.getElementById('userRole').textContent = user.role || 'Staff';
    document.getElementById('btnLogout').addEventListener('click', function () {
      if (Gfp) Gfp.logout();
      else window.location.href = '/auth/login/';
    });
    if (canManage) document.getElementById('manageActions').hidden = false;
  })();

  (async function loadGym() {
    var r = await Gfp.get('/settings');
    if (r.ok && r.data) {
      document.getElementById('gymName').textContent = r.data.gymName || 'GymFlowPro';
      var ga = document.getElementById('gymNameAr');
      if (ga) ga.textContent = r.data.gymNameAr || '';
    }
  })();

  async function loadLookups() {
    var results = await Promise.all([
      Gfp.get(paths.suppliers()),
      Gfp.get(paths.warehouses()),
      Gfp.get(paths.products())
    ]);
    suppliers = results[0].ok && Array.isArray(results[0].data) ? results[0].data : [];
    warehouses = results[1].ok && Array.isArray(results[1].data) ? results[1].data : [];
    var products = results[2].ok && Array.isArray(results[2].data) ? results[2].data : [];
    productById = {};
    products.forEach(function (p) {
      productById[p.id] = p;
    });
  }

  function purchasableOptionsHtml() {
    var opts = Object.keys(productById)
      .map(function (id) {
        return productById[id];
      })
      .filter(function (p) {
        return !p.isArchived && p.isActive !== false && p.trackStock !== false;
      })
      .map(function (p) {
        return (
          '<option value="' +
          esc(p.id) +
          '">' +
          esc(p.sku) +
          ' — ' +
          esc(p.name) +
          '</option>'
        );
      })
      .join('');
    return '<option value="">Product…</option>' + opts;
  }

  function addPoLineRow(pre) {
    var wrap = document.getElementById('poLines');
    var row = document.createElement('div');
    row.className = 'line-row';
    row.innerHTML =
      '<label>Product<select class="pl-product" required>' +
      purchasableOptionsHtml() +
      '</select></label>' +
      '<label>Qty<input type="number" class="pl-qty" min="0.001" step="any" required value="' +
      esc((pre && pre.qtyOrdered) || 1) +
      '"></label>' +
      '<label>Unit cost<input type="number" class="pl-cost" min="0" step="0.01" required value="' +
      esc((pre && pre.unitCost) != null ? pre.unitCost : 0) +
      '"></label>' +
      '<button type="button" class="btn-link pl-remove">Remove</button>';
    if (pre && pre.productId) row.querySelector('.pl-product').value = pre.productId;
    row.querySelector('.pl-remove').addEventListener('click', function () {
      row.remove();
    });
    wrap.appendChild(row);
  }

  async function loadList() {
    var host = document.getElementById('tableHost');
    host.innerHTML =
      '<div class="loading-state"><div class="loader"></div><p>' +
      esc(t('Loading…', 'جاري التحميل…')) +
      '</p></div>';
    var status = document.getElementById('filterStatus').value;
    var r = await Gfp.get(paths.purchaseOrders(status ? { status: status } : undefined));
    if (!r.ok) {
      host.innerHTML = '<div class="error-state"><p>' + esc(apiError(r)) + '</p></div>';
      return;
    }
    list = Array.isArray(r.data) ? r.data : [];
    var trunc =
      r.headers &&
      String(r.headers.get('X-Gfp-Truncated') || r.headers.get('x-gfp-truncated') || '').toLowerCase() ===
        'true';
    var takeHdr = (r.headers && (r.headers.get('X-Gfp-Take') || r.headers.get('x-gfp-take'))) || '200';
    renderList(trunc, takeHdr);
  }

  function renderList(truncated, take) {
    var host = document.getElementById('tableHost');
    var banner = truncated
      ? '<div class="trunc-banner">' +
        esc(
          t(
            'Showing first ' + take + ' purchase orders. Refine by status if you need older ones.',
            'عرض أول ' + take + ' أمر شراء. صفّي بالحالة لو محتاج أقدم.'
          )
        ) +
        '</div>'
      : '';
    if (!list.length) {
      host.innerHTML =
        banner +
        '<div class="empty-state"><p>' +
        esc(t('No purchase orders', 'لا أوامر شراء')) +
        '</p></div>';
      return;
    }
    host.innerHTML =
      banner +
      '<table class="inv"><thead><tr><th>' +
      esc(t('Ordered', 'تاريخ الطلب')) +
      '</th><th>' +
      esc(t('Supplier', 'المورد')) +
      '</th><th>' +
      esc(t('Warehouse', 'المستودع')) +
      '</th><th>' +
      esc(t('Status', 'الحالة')) +
      '</th></tr></thead><tbody>' +
      list
        .map(function (po) {
          return (
            '<tr class="clickable" data-id="' +
            esc(po.id) +
            '"><td>' +
            esc(po.orderedAtUtc ? new Date(po.orderedAtUtc).toLocaleString() : '—') +
            '</td><td>' +
            esc(po.supplierName || '—') +
            '</td><td class="code">' +
            esc(po.warehouseCode || '—') +
            '</td><td>' +
            statusBadge(po.status) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
    host.querySelectorAll('[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        loadDetail(tr.getAttribute('data-id'));
      });
    });
  }

  async function loadDetail(id) {
    var host = document.getElementById('detailHost');
    host.innerHTML =
      '<div class="loading-state"><div class="loader"></div><p>' +
      esc(t('Loading…', 'جاري التحميل…')) +
      '</p></div>';
    var r = await Gfp.get(paths.purchaseOrder(id));
    if (!r.ok) {
      host.innerHTML = '<div class="error-state"><p>' + esc(apiError(r)) + '</p></div>';
      return;
    }
    current = r.data;
    renderDetail();
  }

  function renderDetail() {
    var po = current;
    var host = document.getElementById('detailHost');
    if (!po) {
      host.innerHTML =
        '<p class="muted">' + esc(t('Select a purchase order.', 'اختار أمر شراء.')) + '</p>';
      return;
    }
    var actions = [];
    if (canPurchase && po.status === 'draft') {
      actions.push(
        '<button type="button" class="btn-create" id="btnApprove">' +
          esc(t('Approve', 'اعتماد')) +
          '</button>'
      );
      actions.push(
        '<button type="button" class="btn-secondary" id="btnCancel">' +
          esc(t('Cancel', 'إلغاء')) +
          '</button>'
      );
    }
    if (canPurchase && (po.status === 'approved' || po.status === 'partially_received')) {
      actions.push(
        '<button type="button" class="btn-create" id="btnReceive">' +
          esc(t('Receive…', 'استلام…')) +
          '</button>'
      );
      if (po.status === 'approved') {
        actions.push(
          '<button type="button" class="btn-secondary" id="btnCancel">' +
            esc(t('Cancel', 'إلغاء')) +
            '</button>'
        );
      }
    }
    var lines = (po.lines || [])
      .map(function (l) {
        return (
          '<tr><td class="code">' +
          esc(l.productSku || '—') +
          '</td><td>' +
          esc(l.productName || '—') +
          '</td><td>' +
          esc(l.qtyOrdered) +
          '</td><td>' +
          esc(l.qtyReceived) +
          '</td><td>' +
          esc(l.qtyRemaining) +
          '</td><td>' +
          esc(canSeeCost ? money(l.unitCost) : '—') +
          '</td></tr>'
        );
      })
      .join('');

    host.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">' +
      '<div><h2 style="font-family:var(--fd);font-size:18px;margin-bottom:4px">' +
      esc(t('Purchase order', 'أمر شراء')) +
      '</h2>' +
      '<div class="muted">' +
      esc((po.supplierName || '') + (po.status ? ' · ' + statusLabel(po.status) : '')) +
      '</div></div>' +
      statusBadge(po.status) +
      '</div>' +
      '<div style="margin:12px 0;font-size:13px">' +
      '<div>' +
      esc(t('Supplier', 'المورد')) +
      ': <strong>' +
      esc(po.supplierName || '—') +
      '</strong></div>' +
      '<div>' +
      esc(t('Warehouse', 'المستودع')) +
      ': <strong class="code">' +
      esc(po.warehouseCode || '—') +
      '</strong></div>' +
      (po.notes
        ? '<div class="muted">' + esc(t('Notes', 'ملاحظات')) + ': ' + esc(po.notes) + '</div>'
        : '') +
      '</div>' +
      (actions.length ? '<div class="detail-actions">' + actions.join('') + '</div>' : '') +
      '<div class="table-wrap"><table class="inv"><thead><tr><th>SKU</th><th>' +
      esc(t('Name', 'الاسم')) +
      '</th><th>' +
      esc(t('Ordered', 'مطلوب')) +
      '</th><th>' +
      esc(t('Received', 'مستلم')) +
      '</th><th>' +
      esc(t('Remaining', 'متبقي')) +
      '</th><th>' +
      esc(t('Unit cost', 'تكلفة الوحدة')) +
      '</th></tr></thead><tbody>' +
      (lines ||
        '<tr><td colspan="6" class="muted">' + esc(t('No lines', 'لا بنود')) + '</td></tr>') +
      '</tbody></table></div>' +
      '<p class="muted" style="margin-top:10px">' +
      esc(t('After receive, check', 'بعد الاستلام، راجع')) +
      ' <a class="stock-link" href="/dashboard/inventory/stock/">' +
      esc(t('Stock', 'الأرصدة')) +
      '</a>.</p>';

    var btnApprove = document.getElementById('btnApprove');
    if (btnApprove) {
      btnApprove.addEventListener('click', async function () {
        var r = await Gfp.post(paths.purchaseOrderApprove(po.id), {});
        if (!r.ok) {
          toast(apiError(r), 'err');
          return;
        }
        toast(t('PO approved.', 'تم اعتماد أمر الشراء.'), 'ok');
        current = r.data || current;
        await loadList();
        await loadDetail(po.id);
      });
    }
    var btnCancel = document.getElementById('btnCancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', async function () {
        if (!window.confirm(t('Cancel this purchase order?', 'إلغاء أمر الشراء ده؟'))) return;
        var r = await Gfp.post(paths.purchaseOrderCancel(po.id), {});
        if (!r.ok) {
          toast(apiError(r), 'err');
          return;
        }
        toast(t('PO cancelled.', 'تم إلغاء أمر الشراء.'), 'ok');
        await loadList();
        await loadDetail(po.id);
      });
    }
    var btnReceive = document.getElementById('btnReceive');
    if (btnReceive) {
      btnReceive.addEventListener('click', openReceiveModal);
    }
  }

  function openReceiveModal() {
    var po = current;
    if (!po) return;
    var host = document.getElementById('recvLines');
    host.innerHTML = '';
    document.getElementById('recvHint').textContent = '';
    (po.lines || [])
      .filter(function (l) {
        return Number(l.qtyRemaining) > 0;
      })
      .forEach(function (l) {
        var p = productById[l.productId] || {};
        var needBatch = !!p.trackBatch;
        var needExpiry = !!p.trackExpiry;
        var div = document.createElement('div');
        div.className = 'recv-line';
        div.setAttribute('data-line-id', l.id);
        div.setAttribute('data-remaining', String(l.qtyRemaining));
        div.innerHTML =
          '<h4>' +
          esc(l.productSku || '') +
          ' — ' +
          esc(l.productName || '') +
          ' <span class="muted">(remaining ' +
          esc(l.qtyRemaining) +
          ')</span></h4>' +
          '<label>Qty to receive<input type="number" class="rv-qty" min="0" step="any" max="' +
          esc(l.qtyRemaining) +
          '" value="0"></label>' +
          '<label>Unit cost<input type="number" class="rv-cost" min="0" step="0.01" value="' +
          esc(l.unitCost) +
          '"></label>' +
          (needBatch
            ? '<label>Batch #<input class="rv-batch" required maxlength="80" ' +
              (needBatch ? '' : '') +
              '></label>'
            : '<input type="hidden" class="rv-batch">') +
          (needExpiry
            ? '<label>Expires on<input type="date" class="rv-exp" required></label>'
            : '<input type="hidden" class="rv-exp">') +
          '<div class="muted" style="grid-column:1/-1">' +
          (needBatch || needExpiry
            ? 'Product requires: ' +
              (needBatch ? 'batch' : '') +
              (needBatch && needExpiry ? ' + ' : '') +
              (needExpiry ? 'expiry' : '')
            : 'No batch/expiry required') +
          '</div>';
        host.appendChild(div);
      });
    if (!host.children.length) {
      toast('Nothing left to receive.', 'err');
      return;
    }
    openModal('recvModal');
  }

  document.getElementById('recvForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!current || !canPurchase) return;
    var lines = [];
    var err = '';
    document.querySelectorAll('#recvLines .recv-line').forEach(function (row) {
      var qty = Number(row.querySelector('.rv-qty').value) || 0;
      if (!(qty > 0)) return;
      var remaining = Number(row.getAttribute('data-remaining'));
      if (qty > remaining) {
        err = 'Qty exceeds remaining for a line.';
        return;
      }
      var batchEl = row.querySelector('.rv-batch');
      var expEl = row.querySelector('.rv-exp');
      var batchNumber = batchEl && batchEl.type !== 'hidden' ? batchEl.value.trim() : null;
      var expiresOn = expEl && expEl.type !== 'hidden' ? expEl.value || null : null;
      var lineId = row.getAttribute('data-line-id');
      var poLine = (current.lines || []).find(function (x) {
        return x.id === lineId;
      });
      var p = poLine ? productById[poLine.productId] : null;
      if (p && p.trackBatch && !batchNumber) {
        err = 'Batch number required for ' + (p.sku || 'product');
        return;
      }
      if (p && p.trackExpiry && !expiresOn) {
        err = 'Expiry date required for ' + (p.sku || 'product');
        return;
      }
      var unitCost = Number(row.querySelector('.rv-cost').value);
      lines.push({
        purchaseOrderLineId: lineId,
        qty: qty,
        unitCost: Number.isFinite(unitCost) ? unitCost : null,
        batchNumber: batchNumber,
        expiresOn: expiresOn
      });
    });
    if (err) {
      document.getElementById('recvHint').textContent = err;
      return;
    }
    if (!lines.length) {
      document.getElementById('recvHint').textContent = 'Enter qty > 0 on at least one line.';
      return;
    }
    var r = await Gfp.post(paths.purchaseOrderReceive(current.id), { lines: lines });
    if (!r.ok) {
      document.getElementById('recvHint').textContent = apiError(r);
      toast(apiError(r), 'err');
      return;
    }
    closeModal('recvModal');
    toast('Goods received — stock updated.', 'ok');
    await loadList();
    await loadDetail(current.id);
  });

  async function openCreatePoModal(prefill) {
    prefill = prefill || {};
    if (!canManage) return;
    if (!suppliers.length || !warehouses.length) await loadLookups();
    var ss = document.getElementById('poSupplier');
    var ws = document.getElementById('poWarehouse');
    ss.innerHTML =
      '<option value="">Select…</option>' +
      suppliers
        .filter(function (s) {
          return s.isActive !== false;
        })
        .map(function (s) {
          return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
        })
        .join('');
    ws.innerHTML =
      '<option value="">Select…</option>' +
      warehouses
        .filter(function (w) {
          return w.isActive !== false;
        })
        .map(function (w) {
          return (
            '<option value="' +
            esc(w.id) +
            '"' +
            (w.isDefault ? ' selected' : '') +
            '>' +
            esc(w.code + ' — ' + w.name) +
            '</option>'
          );
        })
        .join('');
    if (prefill.warehouseId) ws.value = prefill.warehouseId;
    document.getElementById('poNotes').value = '';
    document.getElementById('poHint').textContent = '';
    document.getElementById('poLines').innerHTML = '';
    addPoLineRow(prefill.productId ? { productId: prefill.productId, qtyOrdered: 1 } : undefined);
    openModal('poModal');
  }

  document.getElementById('btnCreate').addEventListener('click', function () {
    openCreatePoModal();
  });

  document.getElementById('btnAddLine').addEventListener('click', function () {
    addPoLineRow();
  });

  document.getElementById('poForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!canManage) return;
    var lines = [];
    document.querySelectorAll('#poLines .line-row').forEach(function (row) {
      var productId = row.querySelector('.pl-product').value;
      var qtyOrdered = Number(row.querySelector('.pl-qty').value);
      var unitCost = Number(row.querySelector('.pl-cost').value);
      if (!productId || !(qtyOrdered > 0)) return;
      lines.push({ productId: productId, qtyOrdered: qtyOrdered, unitCost: unitCost });
    });
    if (!lines.length) {
      document.getElementById('poHint').textContent = 'Add at least one valid line.';
      return;
    }
    var body = {
      supplierId: document.getElementById('poSupplier').value,
      warehouseId: document.getElementById('poWarehouse').value,
      notes: document.getElementById('poNotes').value.trim() || null,
      lines: lines
    };
    var r = await Gfp.post(paths.purchaseOrders(), body);
    if (!r.ok) {
      document.getElementById('poHint').textContent = apiError(r);
      toast(apiError(r), 'err');
      return;
    }
    closeModal('poModal');
    toast('Draft PO created.', 'ok');
    await loadList();
    if (r.data && r.data.id) await loadDetail(r.data.id);
  });

  document.getElementById('btnRefresh').addEventListener('click', loadList);
  document.getElementById('filterStatus').addEventListener('change', loadList);

  function applyOnHandContext() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('from') !== 'on-hand') return { fromOnHand: false };
      var productId = params.get('productId') || '';
      var warehouseId = params.get('warehouseId') || '';
      var back =
        '/dashboard/inventory/stock/' +
        (productId ? '?productId=' + encodeURIComponent(productId) : '');
      var bar = document.getElementById('poContextBar');
      var backLink = document.getElementById('poBackOnHand');
      var crumb = document.getElementById('poBreadcrumb');
      if (bar) bar.hidden = false;
      if (backLink) backLink.href = back;
      if (crumb) {
        crumb.innerHTML =
          '<span data-en="Inventory" data-ar="المخزون">Inventory</span><span class="sep">/</span>' +
          '<a href="' +
          back.replace(/"/g, '&quot;') +
          '" data-en="On Hand" data-ar="الرصيد">On Hand</a>' +
          '<span class="sep">/</span>' +
          '<span class="current" data-en="Buy & receive" data-ar="شراء واستلام">Buy & receive</span>';
      }
      return { fromOnHand: true, productId: productId, warehouseId: warehouseId, back: back };
    } catch (e) {
      return { fromOnHand: false };
    }
  }

  (async function boot() {
    var ctx = applyOnHandContext();
    await loadLookups();
    await loadList();
    if (I18n && I18n.applyDocumentLocale) I18n.applyDocumentLocale();
    try {
      var params = new URLSearchParams(window.location.search);
      var openId = params.get('id');
      if (openId) await loadDetail(openId);
      else if (ctx.fromOnHand && ctx.productId && canManage) {
        await openCreatePoModal({
          productId: ctx.productId,
          warehouseId: ctx.warehouseId
        });
      }
    } catch (e) {
      /* ignore */
    }
  })();
})();
