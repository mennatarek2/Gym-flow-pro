/**
 * Suppliers (FE-INVS-5 + PAP-P0 AP-1). Ledger money is server-owned only.
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
  if (!Authz || !(Authz.useCan('inventory.manage') || Authz.useCan('inventory.purchase'))) {
    window.location.href = '/dashboard/inventory/';
    return;
  }

  var canManage = Authz.useCan('inventory.manage');
  var canPurchase = Authz.useCan('inventory.purchase');
  var canSeeMoney =
    canManage || canPurchase || Authz.useCan('reports.financial.view');
  var rows = [];
  var editingId = null;
  var paySupplierId = null;
  var stmtSupplierId = null;

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
    }, 4000);
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
  function applyLocale() {
    if (I18n && I18n.applyDocumentLocale) I18n.applyDocumentLocale();
  }
  function openModal(id) {
    document.getElementById(id).hidden = false;
    applyLocale();
  }
  function closeModal(id) {
    document.getElementById(id).hidden = true;
  }
  function setModalTitle(en, ar) {
    var el = document.getElementById('supModalTitle');
    el.setAttribute('data-en', en);
    el.setAttribute('data-ar', ar);
    el.textContent = t(en, ar);
  }
  function reasonLabel(r) {
    var map = {
      purchase: ['Purchase', 'شراء'],
      payment: ['Payment', 'دفعة'],
      opening: ['Opening', 'افتتاحي'],
      return_credit: ['Return credit', 'مرتجع']
    };
    var p = map[r];
    return p ? t(p[0], p[1]) : r;
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

  function fillForm(s) {
    document.getElementById('sName').value = (s && s.name) || '';
    document.getElementById('sNameAr').value = (s && s.nameAr) || '';
    document.getElementById('sPhone').value = (s && s.phone) || '';
    document.getElementById('sEmail').value = (s && s.email) || '';
    document.getElementById('sTerms').value = (s && s.paymentTerms) || '';
    document.getElementById('sAddress').value = (s && s.address) || '';
    document.getElementById('sNotes').value = (s && s.notes) || '';
    document.getElementById('sActive').checked = !s || s.isActive !== false;
    document.getElementById('sOpeningAmt').value = '0';
    document.getElementById('sOpeningSign').value = '1';
    document.getElementById('supHint').textContent = '';
    var showOpening = !s && canPurchase;
    document.getElementById('openingBlock').hidden = !showOpening;
  }

  function readForm() {
    var body = {
      name: document.getElementById('sName').value.trim(),
      nameAr: document.getElementById('sNameAr').value.trim() || null,
      phone: document.getElementById('sPhone').value.trim() || null,
      email: document.getElementById('sEmail').value.trim() || null,
      paymentTerms: document.getElementById('sTerms').value.trim() || null,
      address: document.getElementById('sAddress').value.trim() || null,
      notes: document.getElementById('sNotes').value.trim() || null,
      isActive: document.getElementById('sActive').checked
    };
    if (!editingId && canPurchase) {
      var amt = Number(document.getElementById('sOpeningAmt').value) || 0;
      if (amt > 0) {
        body.openingAmount = amt;
        body.openingOwedToSupplier = document.getElementById('sOpeningSign').value === '1';
      }
    }
    return body;
  }

  function renderKpis() {
    var host = document.getElementById('kpiHost');
    if (!canSeeMoney) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    var total = rows.length;
    var active = rows.filter(function (s) {
      return s.isActive !== false;
    }).length;
    var due = rows.reduce(function (sum, s) {
      return sum + (s.dueTotal != null ? Number(s.dueTotal) : 0);
    }, 0);
    host.hidden = false;
    host.innerHTML =
      '<div class="kpi-card"><div class="label">' +
      esc(t('Total suppliers', 'إجمالي الموردين')) +
      '</div><div class="value">' +
      esc(total) +
      '</div></div>' +
      '<div class="kpi-card"><div class="label">' +
      esc(t('Active', 'نشط')) +
      '</div><div class="value">' +
      esc(active) +
      '</div></div>' +
      '<div class="kpi-card"><div class="label">' +
      esc(t('Total dues', 'إجمالي المستحقات')) +
      '</div><div class="value due">' +
      esc(money(due)) +
      '</div></div>';
  }

  async function loadList() {
    var host = document.getElementById('tableHost');
    host.innerHTML =
      '<div class="loading-state"><div class="loader"></div><p>' +
      esc(t('Loading…', 'جاري التحميل…')) +
      '</p></div>';
    var includeInactive = document.getElementById('filterInactive').checked;
    var r = await Gfp.get(
      paths.suppliers({ includeInactive: includeInactive ? 'true' : undefined })
    );
    if (!r.ok) {
      host.innerHTML = '<div class="error-state"><p>' + esc(apiError(r)) + '</p></div>';
      return;
    }
    rows = Array.isArray(r.data) ? r.data : [];
    render();
  }

  function render() {
    renderKpis();
    var host = document.getElementById('tableHost');
    if (!rows.length) {
      host.innerHTML =
        '<div class="empty-state"><p>' + esc(t('No suppliers', 'لا موردين')) + '</p></div>';
      return;
    }
    var moneyHeads = canSeeMoney
      ? '<th>' +
        esc(t('Purchases', 'المشتريات')) +
        '</th><th>' +
        esc(t('Paid', 'المدفوع')) +
        '</th><th>' +
        esc(t('Due', 'المستحق')) +
        '</th>'
      : '';
    host.innerHTML =
      '<table class="inv"><thead><tr><th>' +
      esc(t('Name', 'الاسم')) +
      '</th><th>' +
      esc(t('Phone', 'الهاتف')) +
      '</th><th>' +
      esc(t('Email', 'البريد')) +
      '</th><th>' +
      esc(t('Terms', 'الشروط')) +
      '</th>' +
      moneyHeads +
      '<th>' +
      esc(t('Status', 'الحالة')) +
      '</th><th></th></tr></thead><tbody>' +
      rows
        .map(function (s) {
          var actions = '<div class="row-actions">';
          if (canManage) {
            actions +=
              '<button type="button" class="btn-link" data-edit="' +
              esc(s.id) +
              '">' +
              esc(t('Edit', 'تعديل')) +
              '</button>';
          }
          if (canSeeMoney) {
            actions +=
              '<button type="button" class="btn-link" data-stmt="' +
              esc(s.id) +
              '">' +
              esc(t('Statement', 'كشف حساب')) +
              '</button>';
          }
          if (canPurchase) {
            actions +=
              '<button type="button" class="btn-link" data-pay="' +
              esc(s.id) +
              '">' +
              esc(t('Pay', 'دفعة')) +
              '</button>';
          }
          actions += '</div>';
          var moneyCells = canSeeMoney
            ? '<td>' +
              esc(money(s.purchasesTotal)) +
              '</td><td>' +
              esc(money(s.paidTotal)) +
              '</td><td class="' +
              (Number(s.dueTotal) > 0 ? 'money-due' : 'money-ok') +
              '">' +
              esc(money(s.dueTotal)) +
              '</td>'
            : '';
          return (
            '<tr><td>' +
            esc(s.name) +
            (s.nameAr
              ? '<div style="font-size:12px;color:var(--ltt)" dir="rtl">' + esc(s.nameAr) + '</div>'
              : '') +
            '</td><td>' +
            esc(s.phone || '—') +
            '</td><td>' +
            esc(s.email || '—') +
            '</td><td>' +
            esc(s.paymentTerms || '—') +
            '</td>' +
            moneyCells +
            '<td>' +
            (s.isActive
              ? '<span class="badge badge-ok">' + esc(t('Active', 'نشط')) + '</span>'
              : '<span class="badge badge-off">' + esc(t('Inactive', 'غير نشط')) + '</span>') +
            '</td><td>' +
            actions +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';

    host.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-edit');
        var s = rows.find(function (x) {
          return x.id === id;
        });
        if (!s) return;
        editingId = id;
        setModalTitle('Edit supplier', 'تعديل مورد');
        fillForm(s);
        openModal('supModal');
      });
    });
    host.querySelectorAll('[data-pay]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPay(btn.getAttribute('data-pay'));
      });
    });
    host.querySelectorAll('[data-stmt]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openStatement(btn.getAttribute('data-stmt'));
      });
    });
  }

  function openPay(id) {
    var s = rows.find(function (x) {
      return x.id === id;
    });
    if (!s || !canPurchase) return;
    paySupplierId = id;
    document.getElementById('paySupplierName').textContent = s.name;
    document.getElementById('payAmt').value = '';
    document.getElementById('payMethod').value = 'cash';
    document.getElementById('payNote').value = '';
    document.getElementById('payHint').textContent = '';
    openModal('payModal');
  }

  async function openStatement(id) {
    var s = rows.find(function (x) {
      return x.id === id;
    });
    if (!s || !canSeeMoney) return;
    stmtSupplierId = id;
    document.getElementById('stmtSupplierName').textContent = s.name;
    document.getElementById('stmtBal').textContent = t('Loading…', 'جاري التحميل…');
    document.getElementById('stmtHost').innerHTML = '';
    openModal('stmtModal');
    var bal = await Gfp.get(paths.supplierBalance(id));
    var led = await Gfp.get(paths.supplierLedger(id));
    if (bal.ok && bal.data) {
      document.getElementById('stmtBal').textContent =
        t('Due', 'المستحق') +
        ': ' +
        money(bal.data.dueTotal) +
        ' · ' +
        t('Purchases', 'المشتريات') +
        ': ' +
        money(bal.data.purchasesTotal) +
        ' · ' +
        t('Paid', 'المدفوع') +
        ': ' +
        money(bal.data.paidTotal);
    } else {
      document.getElementById('stmtBal').textContent = apiError(bal);
    }
    if (!led.ok) {
      document.getElementById('stmtHost').innerHTML =
        '<div class="error-state"><p>' + esc(apiError(led)) + '</p></div>';
      return;
    }
    var entries = Array.isArray(led.data) ? led.data : [];
    if (!entries.length) {
      document.getElementById('stmtHost').innerHTML =
        '<div class="empty-state"><p>' + esc(t('No ledger entries', 'لا قيود')) + '</p></div>';
      return;
    }
    document.getElementById('stmtHost').innerHTML =
      '<table class="inv"><thead><tr><th>' +
      esc(t('Date', 'التاريخ')) +
      '</th><th>' +
      esc(t('Reason', 'السبب')) +
      '</th><th>' +
      esc(t('Amount', 'المبلغ')) +
      '</th><th>' +
      esc(t('Note', 'ملاحظة')) +
      '</th></tr></thead><tbody>' +
      entries
        .map(function (e) {
          return (
            '<tr><td>' +
            esc(e.createdAtUtc ? new Date(e.createdAtUtc).toLocaleString() : '—') +
            '</td><td>' +
            esc(reasonLabel(e.reason)) +
            '</td><td class="' +
            (Number(e.amount) > 0 ? 'money-due' : 'money-ok') +
            '">' +
            esc(money(e.amount)) +
            '</td><td>' +
            esc(e.note || '—') +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
  }

  document.getElementById('btnCreate').addEventListener('click', function () {
    editingId = null;
    setModalTitle('New supplier', 'مورد جديد');
    fillForm(null);
    openModal('supModal');
  });

  document.getElementById('supForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!canManage) return;
    var body = readForm();
    if (!body.name) {
      document.getElementById('supHint').textContent = t('Name is required.', 'الاسم مطلوب.');
      return;
    }
    var r;
    if (editingId) {
      r = await Gfp.put(paths.supplier(editingId), body);
    } else {
      r = await Gfp.post(paths.suppliers(), body);
    }
    if (!r.ok) {
      document.getElementById('supHint').textContent = apiError(r);
      toast(apiError(r), 'err');
      return;
    }
    toast(
      editingId
        ? t('Supplier updated.', 'تم تحديث المورد.')
        : t('Supplier created.', 'تم إنشاء المورد.'),
      'ok'
    );
    closeModal('supModal');
    await loadList();
  });

  document.getElementById('payForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!canPurchase || !paySupplierId) return;
    var amount = Number(document.getElementById('payAmt').value);
    if (!(amount > 0)) {
      document.getElementById('payHint').textContent = t('Enter amount > 0.', 'أدخل مبلغاً أكبر من صفر.');
      return;
    }
    var r = await Gfp.post(paths.supplierPayments(paySupplierId), {
      amount: amount,
      method: document.getElementById('payMethod').value,
      note: document.getElementById('payNote').value.trim() || null
    });
    if (!r.ok) {
      document.getElementById('payHint').textContent = apiError(r);
      toast(apiError(r), 'err');
      return;
    }
    toast(t('Payment recorded.', 'تم تسجيل الدفعة.'), 'ok');
    closeModal('payModal');
    await loadList();
    if (stmtSupplierId === paySupplierId && !document.getElementById('stmtModal').hidden) {
      await openStatement(paySupplierId);
    }
  });

  document.getElementById('btnRefresh').addEventListener('click', loadList);
  document.getElementById('filterInactive').addEventListener('change', loadList);
  window.addEventListener('gfp:locale', function () {
    applyLocale();
    render();
  });
  applyLocale();
  loadList();
})();
