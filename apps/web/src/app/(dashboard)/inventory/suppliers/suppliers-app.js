/**
 * Suppliers (FE-INVS-5). Real /api/inventory/suppliers* only.
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
  var rows = [];
  var editingId = null;

  function t(en, ar) {
    if (I18n && I18n.tLabel) return I18n.tLabel(en, ar);
    return en;
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
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
  function openModal() {
    document.getElementById('supModal').hidden = false;
    applyLocale();
  }
  function closeModal() {
    document.getElementById('supModal').hidden = true;
  }
  function setModalTitle(en, ar) {
    var el = document.getElementById('supModalTitle');
    el.setAttribute('data-en', en);
    el.setAttribute('data-ar', ar);
    el.textContent = t(en, ar);
  }

  document.querySelectorAll('[data-close="supModal"]').forEach(function (b) {
    b.addEventListener('click', closeModal);
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
    document.getElementById('sNotes').value = (s && s.notes) || '';
    document.getElementById('sActive').checked = !s || s.isActive !== false;
    document.getElementById('supHint').textContent = '';
  }

  function readForm() {
    return {
      name: document.getElementById('sName').value.trim(),
      nameAr: document.getElementById('sNameAr').value.trim() || null,
      phone: document.getElementById('sPhone').value.trim() || null,
      email: document.getElementById('sEmail').value.trim() || null,
      paymentTerms: document.getElementById('sTerms').value.trim() || null,
      notes: document.getElementById('sNotes').value.trim() || null,
      isActive: document.getElementById('sActive').checked
    };
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
    var host = document.getElementById('tableHost');
    if (!rows.length) {
      host.innerHTML =
        '<div class="empty-state"><p>' + esc(t('No suppliers', 'لا موردين')) + '</p></div>';
      return;
    }
    host.innerHTML =
      '<table class="inv"><thead><tr><th>' +
      esc(t('Name', 'الاسم')) +
      '</th><th>' +
      esc(t('Phone', 'الهاتف')) +
      '</th><th>' +
      esc(t('Email', 'البريد')) +
      '</th><th>' +
      esc(t('Terms', 'الشروط')) +
      '</th><th>' +
      esc(t('Status', 'الحالة')) +
      '</th><th></th></tr></thead><tbody>' +
      rows
        .map(function (s) {
          var actions = '';
          if (canManage) {
            actions =
              '<div class="row-actions"><button type="button" class="btn-link" data-edit="' +
              esc(s.id) +
              '">' +
              esc(t('Edit', 'تعديل')) +
              '</button></div>';
          }
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
            '</td><td>' +
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
        openModal();
      });
    });
  }

  document.getElementById('btnCreate').addEventListener('click', function () {
    editingId = null;
    setModalTitle('New supplier', 'مورد جديد');
    fillForm(null);
    openModal();
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
    closeModal();
    await loadList();
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
