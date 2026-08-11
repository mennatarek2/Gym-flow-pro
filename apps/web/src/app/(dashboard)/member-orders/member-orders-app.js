/**
 * Member Orders inbox — staff fulfillment (no payment / POS logic).
 * Real APIs via GfpApi + GfpMemberOrdersApi.
 */
(function () {
  'use strict';

  var Gfp = window.GfpApi;
  var Authz = window.GfpAuthz;
  var Mo = window.GfpMemberOrdersApi;
  var I18n = window.GfpI18n;
  var PAGE_SIZE = 20;

  function t(en, ar) {
    if (I18n && I18n.tLabel) return I18n.tLabel(en, ar);
    return en;
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function money(n, currency) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    try {
      return new Intl.NumberFormat('en-EG', {
        style: 'currency',
        currency: currency || 'EGP'
      }).format(Number(n));
    } catch (e) {
      return Number(n).toFixed(2) + ' ' + (currency || 'EGP');
    }
  }
  function dt(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  function toast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    el.textContent = msg;
    setTimeout(function () {
      el.classList.remove('show');
    }, 4200);
  }
  function apiError(r) {
    if (!r) return t('Unable to load member orders.', 'مش قدرنا نحمّل طلبات الأعضاء.');
    var d = r.data || r.error || {};
    var title = d.title || (d.error && d.error.code) || '';
    if (title === 'FEATURE_DISABLED') {
      return t('Member Orders are turned off for this gym.', 'طلبات الأعضاء مقفولة لهذا النادي.');
    }
    if (title === 'FORBIDDEN' || r.status === 403) {
      return t('You do not have permission for this action.', 'مش عندك صلاحية لهذا الإجراء.');
    }
    var detail = d.detail || d.message || (d.error && d.error.message) || '';
    if (detail && String(detail).indexOf(' / ') !== -1) {
      detail = String(detail).split(' / ')[0].trim();
    }
    if (detail && !/^[A-Z][A-Z0-9_]+$/.test(String(detail))) return String(detail);
    if (r.status === 0) return t('Network error — try again.', 'مشكلة شبكة — حاول تاني.');
    return t('Unable to update this order. Please try again.', 'مش قدرنا نحدّث الطلب. حاول تاني.');
  }

  function getUser() {
    if (Gfp && Gfp.tokens) return Gfp.tokens.getUser();
    try {
      return JSON.parse(localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user'));
    } catch (e) {
      return null;
    }
  }

  var user = getUser();
  if (!user || !(Gfp && Gfp.tokens && Gfp.tokens.getAccess())) {
    location.href = '/auth/login/';
    return;
  }

  var role = (user && user.role) || '';
  var canView =
    (Authz &&
      (Authz.useCan('sales.sell') ||
        Authz.useCan('orders.view') ||
        Authz.useCan('orders.fulfill') ||
        Authz.useCan('memberorders.view') ||
        Authz.useCan('memberorders.manage'))) ||
    /Owner|Manager|Receptionist/i.test(role);
  var canAct =
    (Authz &&
      (Authz.useCan('sales.sell') ||
        Authz.useCan('orders.fulfill') ||
        Authz.useCan('memberorders.manage'))) ||
    /Owner|Manager|Receptionist/i.test(role);

  document.getElementById('userAvatar').textContent = (user.fullName || 'U')
    .split(' ')
    .map(function (w) {
      return w[0];
    })
    .join('')
    .slice(0, 2)
    .toUpperCase();
  document.getElementById('userName').textContent = user.fullName || 'User';
  document.getElementById('userRole').textContent = role || 'Staff';
  document.getElementById('btnLogout').onclick = function () {
    if (Gfp && Gfp.tokens) Gfp.tokens.clear();
    location.href = '/auth/login/';
  };

  var page = 1;
  var statusFilter = '';
  var selectedId = null;
  var selectedOrder = null;
  var actionBusy = false;
  var pollTimer = null;
  var hubConnection = null;

  function setSignal(mode) {
    var dot = document.getElementById('moSignalDot');
    var lab = document.getElementById('moSignalLabel');
    if (!dot || !lab) return;
    dot.className = 'dot' + (mode === 'live' ? ' on' : mode === 'poll' ? ' poll' : '');
    lab.textContent =
      mode === 'live'
        ? t('Live', 'مباشر')
        : mode === 'poll'
          ? t('Polling', 'تحديث دوري')
          : t('Offline', 'غير متصل');
  }

  function showFeatureBanner(msg) {
    var el = document.getElementById('featureDisabled');
    var body = document.getElementById('featureDisabledBody');
    if (body && msg) body.textContent = msg;
    if (el) el.style.display = 'flex';
  }

  async function loadList() {
    var tbody = document.getElementById('tbody');
    if (!canView) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="mo-error">' +
        esc(t('You do not have permission to view member orders.', 'مش عندك صلاحية تشوف طلبات الأعضاء.')) +
        '</td></tr>';
      showFeatureBanner(
        t('You do not have permission to view member orders.', 'مش عندك صلاحية تشوف طلبات الأعضاء.')
      );
      return;
    }
    if (!Gfp || !Mo) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="mo-error">' +
        esc(t('Unable to load member orders.', 'مش قدرنا نحمّل طلبات الأعضاء.')) +
        '</td></tr>';
      return;
    }
    tbody.innerHTML =
      '<tr><td colspan="7" class="mo-loading">' +
      esc(t('Loading…', 'جاري التحميل…')) +
      '</td></tr>';

    var q = { page: page, pageSize: PAGE_SIZE };
    if (statusFilter) q.status = statusFilter;
    var r = await Gfp.get(Mo.paths.list(q));
    if (r.status === 401) {
      location.href = '/auth/login/';
      return;
    }
    if (!r.ok) {
      if (r.data && r.data.title === 'FEATURE_DISABLED') showFeatureBanner(apiError(r));
      tbody.innerHTML =
        '<tr><td colspan="7" class="mo-error">' +
        esc(apiError(r)) +
        ' <button type="button" class="btn secondary" id="btnRetryList">' +
        esc(t('Try again', 'حاول تاني')) +
        '</button></td></tr>';
      var retry = document.getElementById('btnRetryList');
      if (retry) retry.onclick = loadList;
      renderPager(1, 0);
      return;
    }

    var paged = Mo.extractPaged(r.data);
    var items = (paged.items || []).map(Mo.normalizeOrder).filter(Boolean);
    renderPager(paged.totalPages, paged.totalCount);

    if (!items.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="mo-empty">' +
        esc(t('No member orders yet.', 'مفيش طلبات أعضاء لسه.')) +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = items
      .map(function (o) {
        var num = o.orderNumber != null ? '#' + o.orderNumber : (o.id || '').slice(0, 8);
        var sel = o.id === selectedId ? ' row-sel' : '';
        return (
          '<tr class="' +
          sel +
          '" data-id="' +
          esc(o.id) +
          '">' +
          '<td dir="ltr"><strong>' +
          esc(num) +
          '</strong></td>' +
          '<td>' +
          esc(o.memberName) +
          '</td>' +
          '<td dir="ltr">' +
          esc(o.memberNumber) +
          '</td>' +
          '<td><strong>' +
          esc(money(o.total, o.currency)) +
          '</strong></td>' +
          '<td>' +
          esc(dt(o.createdAt)) +
          '</td>' +
          '<td><span class="mo-status ' +
          esc(o.status) +
          '">' +
          esc(o.status || '—') +
          '</span></td>' +
          '<td><button type="button" class="btn secondary" data-view="' +
          esc(o.id) +
          '">' +
          esc(t('View', 'عرض')) +
          '</button></td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-view]').forEach(function (btn) {
      btn.onclick = function () {
        openDetail(btn.getAttribute('data-view'));
      };
    });
    tbody.querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.onclick = function (e) {
        if (e.target.closest('button')) return;
        openDetail(tr.getAttribute('data-id'));
      };
    });
  }

  function renderPager(totalPages, totalCount) {
    var el = document.getElementById('pager');
    if (!el) return;
    var tp = Math.max(1, totalPages || 1);
    el.innerHTML =
      '<button type="button" class="btn secondary js-prev"' +
      (page <= 1 ? ' disabled' : '') +
      '>' +
      esc(t('Prev', 'السابق')) +
      '</button>' +
      '<span>' +
      esc(t('Page', 'صفحة')) +
      ' ' +
      page +
      ' / ' +
      tp +
      ' · ' +
      esc(String(totalCount || 0)) +
      '</span>' +
      '<button type="button" class="btn secondary js-next"' +
      (page >= tp ? ' disabled' : '') +
      '>' +
      esc(t('Next', 'التالي')) +
      '</button>';
    el.querySelector('.js-prev').onclick = function () {
      if (page > 1) {
        page -= 1;
        loadList();
      }
    };
    el.querySelector('.js-next').onclick = function () {
      if (page < tp) {
        page += 1;
        loadList();
      }
    };
  }

  async function openDetail(id) {
    if (!id || !Gfp || !Mo) return;
    selectedId = id;
    document.querySelectorAll('#tbody tr[data-id]').forEach(function (tr) {
      tr.classList.toggle('row-sel', tr.getAttribute('data-id') === id);
    });
    document.getElementById('detailEmpty').style.display = 'none';
    document.getElementById('detailBody').style.display = 'block';
    document.getElementById('dMember').textContent = '…';
    document.getElementById('rejectBox').classList.remove('show');

    var r = await Gfp.get(Mo.paths.detail(id));
    if (r.status === 401) {
      location.href = '/auth/login/';
      return;
    }
    if (!r.ok) {
      toast(apiError(r), 'err');
      document.getElementById('dMember').textContent = '—';
      return;
    }
    selectedOrder = Mo.normalizeOrder(r.data);
    renderDetail(selectedOrder);
  }

  function renderDetail(o) {
    if (!o) return;
    var num = o.orderNumber != null ? '#' + o.orderNumber : (o.id || '').slice(0, 8);
    document.getElementById('dMember').textContent = o.memberName || '—';
    document.getElementById('dMemberNo').textContent = o.memberNumber || '—';
    document.getElementById('dOrderNo').textContent = num;
    document.getElementById('dStatus').innerHTML =
      '<span class="mo-status ' + esc(o.status) + '">' + esc(o.status || '—') + '</span>';
    document.getElementById('dCreated').textContent = dt(o.createdAt);
    document.getElementById('dTotal').textContent = money(o.total, o.currency);

    var lines = document.getElementById('dLines');
    if (!o.lines.length) {
      lines.innerHTML = '<li class="muted">' + esc(t('No line items.', 'مفيش أصناف.')) + '</li>';
    } else {
      lines.innerHTML = o.lines
        .map(function (l) {
          var right =
            l.lineTotal != null
              ? money(l.lineTotal, o.currency)
              : l.unitPrice != null
                ? money(Number(l.unitPrice) * Number(l.qty), o.currency)
                : '';
          return (
            '<li><span>' +
            esc(l.name) +
            ' ×' +
            esc(String(l.qty)) +
            (l.sku ? ' <span class="muted">(' + esc(l.sku) + ')</span>' : '') +
            '</span><strong>' +
            esc(right) +
            '</strong></li>'
          );
        })
        .join('');
    }

    var note = document.getElementById('dNote');
    if (o.note) {
      note.style.display = 'block';
      note.textContent = o.note;
    } else {
      note.style.display = 'none';
      note.textContent = '';
    }

    var linkWrap = document.getElementById('dMemberLinkWrap');
    linkWrap.innerHTML = o.memberId
      ? '<a class="btn secondary" href="/dashboard/members/' +
        encodeURIComponent(o.memberId) +
        '/"><i class="ti ti-user"></i> ' +
        esc(t('Open member', 'افتح العضو')) +
        '</a>'
      : '';

    renderActions(o);
  }

  function renderActions(o) {
    var host = document.getElementById('dActions');
    host.innerHTML = '';
    document.getElementById('rejectBox').classList.remove('show');
    if (!canAct || !o) return;
    var st = Mo.normalizeStatus(o.status);

    function addBtn(id, labelEn, labelAr, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (cls || 'primary');
      b.id = id;
      b.textContent = t(labelEn, labelAr);
      host.appendChild(b);
      return b;
    }

    if (st === 'Pending') {
      addBtn('btnAccept', 'Accept', 'قبول', 'primary').onclick = function () {
        runAction('accept');
      };
      addBtn('btnReject', 'Reject', 'رفض', 'secondary').onclick = function () {
        document.getElementById('rejectBox').classList.add('show');
      };
    } else if (st === 'Accepted') {
      addBtn('btnReady', 'Mark Ready', 'جاهز', 'primary').onclick = function () {
        runAction('ready');
      };
    } else if (st === 'Ready') {
      addBtn('btnComplete', 'Complete', 'إكمال', 'primary').onclick = function () {
        runAction('complete');
      };
    }
  }

  async function runAction(kind) {
    if (!selectedId || actionBusy || !Gfp || !Mo) return;
    actionBusy = true;
    var buttons = document.querySelectorAll('#dActions .btn, #btnRejectConfirm');
    buttons.forEach(function (b) {
      b.disabled = true;
    });

    var path =
      kind === 'accept'
        ? Mo.paths.accept(selectedId)
        : kind === 'reject'
          ? Mo.paths.reject(selectedId)
          : kind === 'ready'
            ? Mo.paths.ready(selectedId)
            : Mo.paths.complete(selectedId);

    var body = {};
    if (kind === 'reject') {
      var reason = (document.getElementById('rejectReason').value || '').trim();
      if (reason) body.reason = reason;
    }

    var r = await Gfp.post(path, body);
    actionBusy = false;
    buttons.forEach(function (b) {
      b.disabled = false;
    });

    if (r.status === 401) {
      location.href = '/auth/login/';
      return;
    }
    if (!r.ok) {
      toast(apiError(r), 'err');
      return;
    }

    toast(t('Order updated.', 'تم تحديث الطلب.'), 'ok');
    document.getElementById('rejectBox').classList.remove('show');
    document.getElementById('rejectReason').value = '';
    if (r.data) {
      selectedOrder = Mo.normalizeOrder(r.data);
      renderDetail(selectedOrder);
    } else {
      await openDetail(selectedId);
    }
    await loadList();
    // Member 360 Orders tab refreshes if open in another tab via next visit; same-page flag reset if shell reused
    try {
      window._ordersLoaded = false;
    } catch (e) {}
  }

  document.getElementById('btnRejectConfirm').onclick = function () {
    runAction('reject');
  };
  document.getElementById('btnRefresh').onclick = function () {
    loadList();
    if (selectedId) openDetail(selectedId);
  };

  document.querySelectorAll('#statusFilters .chip').forEach(function (chip) {
    chip.onclick = function () {
      document.querySelectorAll('#statusFilters .chip').forEach(function (c) {
        c.classList.remove('act');
      });
      chip.classList.add('act');
      statusFilter = chip.getAttribute('data-status') || '';
      page = 1;
      loadList();
    };
  });

  function startPolling(ms) {
    stopPolling();
    setSignal('poll');
    pollTimer = setInterval(function () {
      loadList();
      if (selectedId) openDetail(selectedId);
    }, ms || 20000);
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /**
   * Reuse the same SignalR client as Attendance.
   * Known hubs today: /hubs/attendance (check-in only).
   * Try member-order hubs if backend ships them; otherwise poll every 20s.
   */
  async function trySignalR() {
    if (!window.signalR || !window.signalR.HubConnectionBuilder || !Gfp) {
      startPolling(20000);
      return;
    }
    var candidates = ['/hubs/member-orders', '/hubs/orders'];
    var api = window.API_BASE || '';
    var base = api.replace(/\/api\/?$/, '');
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (hubConnection) {
          try {
            await hubConnection.stop();
          } catch (e) {}
          hubConnection = null;
        }
        hubConnection = new signalR.HubConnectionBuilder()
          .withUrl(base + candidates[i], {
            accessTokenFactory: function () {
              return Gfp.tokens.getAccess() || '';
            }
          })
          .withAutomaticReconnect()
          .build();

        ['MemberOrderCreated', 'MemberOrderUpdated', 'OrderUpdated', 'orderUpdated'].forEach(
          function (evt) {
            hubConnection.on(evt, function () {
              loadList();
              if (selectedId) openDetail(selectedId);
            });
          }
        );

        await hubConnection.start();
        setSignal('live');
        stopPolling();
        // Light safety refresh even when live
        pollTimer = setInterval(function () {
          loadList();
        }, 60000);
        return;
      } catch (e) {
        hubConnection = null;
      }
    }
    // Attendance hub is check-in only — fall back to polling.
    startPolling(20000);
  }

  (async function boot() {
    try {
      var r = await Gfp.get('/settings');
      if (r.ok && r.data) document.getElementById('gymName').textContent = r.data.gymName || 'Gym';
    } catch (e) {}
    await loadList();
    var deepId = new URLSearchParams(location.search).get('orderId');
    if (deepId) await openDetail(deepId);
    trySignalR();
    if (I18n && I18n.applyDocumentLocale) I18n.applyDocumentLocale();
  })();
})();
