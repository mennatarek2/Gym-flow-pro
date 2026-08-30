/**
 * HR Foundation — Departments (Phase 2).
 */
(function () {
  'use strict';

  var Gfp = window.GfpApi;
  var Authz = window.GfpAuthz;
  var I18n = window.GfpI18n;

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

  var canManage = Authz && Authz.useCan('hr.manage');
  var canView = canManage || (Authz && Authz.useCan('hr.view'));
  if (!canView) {
    document.getElementById('ownerGuard').hidden = false;
    document.getElementById('ownerGuard').classList.add('is-on');
    document.getElementById('pageContent').hidden = true;
    return;
  }

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
    var e = (r && r.error) || {};
    return e.message || t('Request failed', 'فشل الطلب');
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

  (function chrome() {
    var ini = String(user.fullName || 'U')
      .split(/\s+/)
      .map(function (w) { return w[0]; })
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

  function fillForm(d) {
    document.getElementById('dName').value = (d && d.name) || '';
    document.getElementById('dNameAr').value = (d && d.nameAr) || '';
    document.getElementById('dActive').checked = !d || d.isActive !== false;
    document.getElementById('deptHint').textContent = '';
  }

  function readForm() {
    return {
      name: document.getElementById('dName').value.trim(),
      nameAr: document.getElementById('dNameAr').value.trim() || null,
      isActive: document.getElementById('dActive').checked
    };
  }

  async function loadList() {
    var host = document.getElementById('tableHost');
    host.innerHTML = '<div class="loading-state"><div class="loader"></div><p>' + esc(t('Loading…', 'جاري التحميل…')) + '</p></div>';
    var includeInactive = document.getElementById('filterInactive').checked;
    var r = await Gfp.get('/hr/departments' + (includeInactive ? '?includeInactive=true' : ''));
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
      host.innerHTML = '<div class="empty-state"><p>' + esc(t('No departments yet.', 'لا توجد أقسام بعد.')) + '</p></div>';
      return;
    }
    var html = '<table><thead><tr>' +
      '<th>' + esc(t('Name', 'الاسم')) + '</th>' +
      '<th>' + esc(t('Employees', 'الموظفون')) + '</th>' +
      '<th>' + esc(t('Status', 'الحالة')) + '</th>' +
      (canManage ? '<th></th>' : '') +
      '</tr></thead><tbody>';
    rows.forEach(function (d) {
      html += '<tr>' +
        '<td><div class="person-name">' + esc(d.name) + '</div>' + (d.nameAr ? '<div class="person-sub">' + esc(d.nameAr) + '</div>' : '') + '</td>' +
        '<td>' + esc(d.employeeCount) + '</td>' +
        '<td><span class="status-badge ' + (d.isActive ? 'active' : 'terminated') + '"><span class="dot"></span>' +
          esc(d.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')) + '</span></td>' +
        (canManage
          ? '<td><div class="act-group"><button type="button" class="act-btn" data-edit="' + esc(d.id) + '" title="' + esc(t('Edit', 'تعديل')) + '"><i class="ti ti-pencil"></i></button></div></td>'
          : '') +
        '</tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll('[data-edit]'), function (btn) {
      btn.addEventListener('click', function () {
        openEdit(btn.getAttribute('data-edit'));
      });
    });
    applyLocale();
  }

  function openCreate() {
    editingId = null;
    document.getElementById('deptModalTitle').textContent = t('New department', 'قسم جديد');
    fillForm(null);
    openModal('deptModal');
  }

  function openEdit(id) {
    var d = rows.filter(function (r) { return r.id === id; })[0];
    if (!d) return;
    editingId = id;
    document.getElementById('deptModalTitle').textContent = t('Edit department', 'تعديل القسم');
    fillForm(d);
    openModal('deptModal');
  }

  document.getElementById('btnCreate').addEventListener('click', openCreate);
  document.getElementById('btnRefresh').addEventListener('click', loadList);
  document.getElementById('filterInactive').addEventListener('change', loadList);
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (btn) {
    btn.addEventListener('click', function () {
      closeModal(btn.getAttribute('data-close'));
    });
  });

  document.getElementById('deptForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var body = readForm();
    if (!body.name) {
      document.getElementById('deptHint').textContent = t('Name is required', 'الاسم مطلوب');
      return;
    }
    var btn = document.getElementById('btnSaveDept');
    btn.disabled = true;
    var r = editingId
      ? await Gfp.put('/hr/departments/' + editingId, body)
      : await Gfp.post('/hr/departments', body);
    btn.disabled = false;
    if (!r.ok) {
      document.getElementById('deptHint').textContent = apiError(r);
      return;
    }
    closeModal('deptModal');
    toast(t('Saved', 'تم الحفظ'), 'ok');
    loadList();
  });

  loadList();
})();
