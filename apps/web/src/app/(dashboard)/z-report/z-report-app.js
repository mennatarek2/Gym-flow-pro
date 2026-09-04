(function (global) {
  'use strict';
  const API_BASE = window.API_BASE || window.GFP_DEFAULT_API_BASE || '/api';

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
  }
  function getH(opts) {
    const t = getToken();
    const h = { 'ngrok-skip-browser-warning': 'true' };
    if (!(opts && opts.noJson)) h['Content-Type'] = 'application/json';
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
  const canView = perms.has('reports.financial.view') || /Owner|Manager/i.test(role);

  if (!user || !getToken()) {
    location.href = '/auth/login/';
    return;
  }
  document.getElementById('userAvatar').textContent = (user.fullName || 'U')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  document.getElementById('userName').textContent = user.fullName || 'User';
  document.getElementById('userRole').textContent = user.role || 'Staff';
  document.getElementById('btnLogout').onclick = function () {
    ['gfp_access_token', 'gfp_refresh_token', 'gfp_user', 'gfp_expires_at'].forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    location.href = '/auth/login/';
  };

  let current = null;
  const params = new URLSearchParams(location.search);
  let shiftId = params.get('shiftId') || '';
  let rangePreset = 'last7';
  const PAGE_SIZE = 25;
  let listPage = 1;
  let listRowHtmls = [];
  let lastListCsv = [];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(Number(n));
  }
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function cairoParts(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const parts = {};
    fmt.formatToParts(d).forEach((p) => {
      parts[p.type] = p.value;
    });
    return parts;
  }
  function dt(iso) {
    const p = cairoParts(iso);
    if (!p) return iso ? esc(iso) : '—';
    return p.day + ' ' + p.month + ' ' + p.year + ' · ' + p.hour + ':' + p.minute + ' ' + p.dayPeriod;
  }
  function windowLabel(opened, closed) {
    const a = cairoParts(opened);
    if (!a) return '—';
    const date = a.day + ' ' + a.month + ' ' + a.year;
    const start = a.hour + ':' + a.minute + ' ' + a.dayPeriod;
    if (!closed) return date + ' · ' + start + ' – Open';
    const b = cairoParts(closed);
    if (!b) return date + ' · ' + start;
    return date + ' · ' + start + ' – ' + b.hour + ':' + b.minute + ' ' + b.dayPeriod;
  }
  function statusLabel(s) {
    if (s === 'open') return 'Open';
    if (s === 'approved') return 'Approved';
    if (s === 'closed') return 'Closed';
    return s || '—';
  }
  function methodLabel(m) {
    const map = {
      cash: 'Cash',
      card_paymob: 'Card (Paymob)',
      fawry: 'Fawry',
      vodafone: 'Vodafone',
      instapay: 'Instapay',
      account_credit: 'Credit',
    };
    return map[m] || m || '—';
  }
  function toast(msg, type) {
    return globalThis.toastShared(msg, type);
  }
  function safeError(status) {
    if (!canView || status === 403) return "You don't have permission to view this report.";
    return "We couldn't load this report.";
  }
  function parseYmd(s) {
    const p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function fmtShort(s) {
    const d = parseYmd(s);
    if (!d) return s || '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function setRangeLabel() {
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    let text = fmtShort(from) + ' – ' + fmtShort(to);
    if (rangePreset === 'last7') text = 'Last 7 days';
    else if (rangePreset === 'last30') text = 'Last 30 days';
    else if (rangePreset === 'thisMonth') text = 'This month';
    document.getElementById('rangeLabel').textContent = text;
    document.querySelectorAll('#rangePop .range-opt').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === rangePreset);
    });
  }
  function applyPreset(preset) {
    rangePreset = preset;
    const cairoDates = global.GfpCairoDates;
    if (cairoDates && cairoDates.presetRange) {
      const range = cairoDates.presetRange(preset);
      document.getElementById('dateFrom').value = range.from;
      document.getElementById('dateTo').value = range.to;
    } else {
      const now = new Date();
      if (preset === 'last7') {
        const fromD = new Date(now);
        fromD.setDate(fromD.getDate() - 6);
        document.getElementById('dateFrom').value = ymd(fromD);
        document.getElementById('dateTo').value = ymd(now);
      } else if (preset === 'last30') {
        const fromD = new Date(now);
        fromD.setDate(fromD.getDate() - 29);
        document.getElementById('dateFrom').value = ymd(fromD);
        document.getElementById('dateTo').value = ymd(now);
      } else if (preset === 'thisMonth') {
        document.getElementById('dateFrom').value = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
        document.getElementById('dateTo').value = ymd(now);
      }
    }
    setRangeLabel();
  }
  function closePops() {
    document.getElementById('rangePop').hidden = true;
    document.getElementById('btnRange').setAttribute('aria-expanded', 'false');
  }
  function stampColLabels(sel) {
    const table = document.querySelector(sel);
    if (!table) return;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        td.setAttribute('data-col', headers[i] || '');
      });
    });
  }
  async function apiJson(method, path) {
    const res = await fetch(API_BASE + path, { method, headers: getH() });
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, data: null };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  function syncUrl() {
    const url = new URL(location.href);
    if (shiftId) url.searchParams.set('shiftId', shiftId);
    else url.searchParams.delete('shiftId');
    history.replaceState({}, '', url);
  }

  function showListChrome() {
    document.getElementById('crumb').innerHTML =
      '<span>Shifts</span><span class="sep">/</span><span class="current">Z-Reports</span>';
    document.getElementById('pageTitle').textContent = 'Z-Reports';
    document.getElementById('pageSub').textContent =
      'What happened during each shift, and can the cash be reconciled?';
    document.getElementById('pageStaff').hidden = true;
    document.getElementById('pageWindow').hidden = true;
    document.getElementById('btnBack').href = '/dashboard/shifts/';
    document.getElementById('btnBack').innerHTML = '<i class="ti ti-arrow-left"></i> Shifts';
    document.getElementById('listFilters').hidden = false;
    document.getElementById('btnExport').hidden = false;
    document.getElementById('btnPrint').hidden = true;
    document.getElementById('btnPdf').hidden = true;
    document.getElementById('listError').hidden = true;
    document.getElementById('detailError').hidden = true;
    document.getElementById('viewList').hidden = false;
    document.getElementById('viewDetail').hidden = true;
  }

  function showDetailChrome(r) {
    document.getElementById('crumb').innerHTML =
      '<span>Shifts</span><span class="sep">/</span><a href="/dashboard/z-report/">Z-Reports</a><span class="sep">/</span><span class="current">Z-Report</span>';
    document.getElementById('pageTitle').textContent = 'Z-Report';
    document.getElementById('pageSub').textContent = 'Shift closing';
    document.getElementById('pageStaff').hidden = false;
    document.getElementById('pageStaff').textContent = r.staffName || 'Staff';
    document.getElementById('pageWindow').hidden = false;
    document.getElementById('pageWindow').textContent = windowLabel(r.openedAt, r.closedAt);
    document.getElementById('btnBack').href = '/dashboard/z-report/';
    document.getElementById('btnBack').innerHTML = '<i class="ti ti-arrow-left"></i> Z-Reports';
    document.getElementById('listFilters').hidden = true;
    document.getElementById('btnExport').hidden = true;
    document.getElementById('btnPrint').hidden = false;
    document.getElementById('btnPdf').hidden = false;
    document.getElementById('btnPdf').disabled = !canView;
    document.getElementById('listError').hidden = true;
    document.getElementById('detailError').hidden = true;
    document.getElementById('zDoc').hidden = false;
    document.getElementById('viewList').hidden = true;
    document.getElementById('viewDetail').hidden = false;
  }

  function kpi(label, value, extra) {
    return (
      '<div class="z-kpi' +
      (extra || '') +
      '"><div class="l">' +
      esc(label) +
      '</div><div class="v">' +
      value +
      '</div></div>'
    );
  }
  function dl(rows) {
    return rows
      .map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>')
      .join('');
  }

  function renderDetail(r) {
    current = r;
    showDetailChrome(r);
    document.getElementById('zDoc').hidden = false;
    document.getElementById('detailError').hidden = true;

    const closed = document.getElementById('closedBanner');
    const openNote = document.getElementById('openNote');
    closed.hidden = !r.isFinal;
    openNote.hidden = r.status !== 'open';
    document.getElementById('closedWhen').textContent = r.closedAt
      ? 'Closed ' + dt(r.closedAt)
      : '';

    document.getElementById('shiftInfo').innerHTML = dl([
      ['Shift', esc(r.staffName) + ' · ' + dt(r.openedAt)],
      ['Staff', esc(r.staffName)],
      ['Opened at', dt(r.openedAt)],
      ['Closed at', r.closedAt ? dt(r.closedAt) : 'Open'],
      ['Status', '<span class="st ' + esc(r.status) + '">' + esc(statusLabel(r.status)) + '</span>'],
    ]);

    document.getElementById('salesKpis').innerHTML =
      kpi('Gross sales', esc(money(r.grossSales))) +
      kpi('Discounts', esc(money(r.discounts))) +
      kpi('Refunds', esc(money(r.refunds))) +
      kpi('Net sales', esc(money(r.netSales)), ' is-net') +
      kpi('Transactions', String(r.transactionCount || 0));

    const methods = r.methods || [];
    document.getElementById('methodBody').innerHTML = methods.length
      ? methods
          .map(
            (m) =>
              '<tr><td>' +
              esc(methodLabel(m.method)) +
              '</td><td>' +
              esc(String(m.count)) +
              '</td><td class="amt">' +
              esc(money(m.total)) +
              '</td></tr>',
          )
          .join('')
      : '<tr><td colspan="3" class="muted">No payments on this shift</td></tr>';

    const hero = document.getElementById('cashHero');
    if (r.revealCash) {
      const diff = Number(r.difference);
      let diffCls = '';
      if (!Number.isNaN(diff) && r.difference != null) {
        if (diff < 0) diffCls = ' is-neg';
        else if (diff > 0) diffCls = ' is-pos';
      }
      hero.innerHTML =
        '<div class="box"><div class="l">Expected cash</div><div class="v">' +
        esc(money(r.expectedCash)) +
        '</div></div>' +
        '<div class="box"><div class="l">Counted cash</div><div class="v">' +
        esc(money(r.countedCash)) +
        '</div></div>' +
        '<div class="box is-diff' +
        diffCls +
        '"><div class="l">Difference</div><div class="v">' +
        esc(money(r.difference)) +
        '</div></div>';
    } else {
      hero.innerHTML =
        '<div class="box"><div class="l">Expected cash</div><div class="v">Hidden</div></div>' +
        '<div class="box"><div class="l">Counted cash</div><div class="v">—</div></div>' +
        '<div class="box"><div class="l">Difference</div><div class="v">—</div></div>';
    }

    const cashRows = [
      ['Opening cash', money(r.openingCash)],
      ['Cash sales', money(r.cashSales)],
      ['Cash refunds', money(r.cashRefunds)],
      ['Cash expenses', money(r.cashExpenses)],
    ];
    if (Number(r.cashPaidIn)) cashRows.push(['Paid in', money(r.cashPaidIn)]);
    if (Number(r.floatAdjust)) cashRows.push(['Float adjust', money(r.floatAdjust)]);
    cashRows.push(['Expected cash', r.revealCash ? money(r.expectedCash) : 'Hidden']);
    cashRows.push(['Counted cash', r.revealCash ? money(r.countedCash) : '—']);
    cashRows.push(['Cash difference', r.revealCash ? money(r.difference) : '—']);
    document.getElementById('cashLines').innerHTML = dl(cashRows.map(([k, v]) => [k, esc(v)]));

    const cats = [
      ['Memberships', r.membershipCount, r.memberships],
      ['Renewals', r.renewalCount, r.renewals],
      ['Products', r.productCount, r.products],
      ['Other', r.otherCount, r.other],
    ].filter((c) => Number(c[1]) > 0 || Number(c[2]) !== 0);
    document.getElementById('breakBody').innerHTML = cats.length
      ? cats
          .map(
            ([name, n, amt]) =>
              '<tr><td>' +
              esc(name) +
              '</td><td>' +
              esc(String(n || 0)) +
              '</td><td class="amt">' +
              esc(money(amt)) +
              '</td></tr>',
          )
          .join('')
      : '<tr><td colspan="3" class="muted">No sale lines on this shift</td></tr>';

    document.getElementById('activityDl').innerHTML = dl([
      ['Transactions', String(r.transactionCount || 0)],
      ['Refunds', String(r.refundCount || 0)],
      ['Discounts', String(r.discountCount || 0)],
    ]);
    document.querySelectorAll('#viewDetail .rpt-table').forEach((table) => stampColLabelsTable(table));
  }

  function stampColLabelsTable(table) {
    if (!table) return;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        td.setAttribute('data-col', headers[i] || '');
      });
    });
  }

  function showListSkeleton() {
    document.getElementById('listEmpty').hidden = true;
    document.getElementById('listError').hidden = true;
    document.getElementById('listWrap').hidden = false;
    document.getElementById('listPager').hidden = true;
    document.getElementById('listBody').innerHTML = Array.from({ length: 6 }, () => {
      return (
        '<tr>' +
        Array.from({ length: 7 }, () => '<td><div class="sk-block"></div></td>').join('') +
        '</tr>'
      );
    }).join('');
  }

  function paintListPage() {
    const total = listRowHtmls.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    if (listPage > pages) listPage = pages;
    const start = (listPage - 1) * PAGE_SIZE;
    document.getElementById('listBody').innerHTML = listRowHtmls.slice(start, start + PAGE_SIZE).join('');
    stampColLabels('#listWrap table');
    document.querySelectorAll('#listBody tr[data-shift]').forEach((tr) => {
      tr.onclick = () => {
        shiftId = tr.getAttribute('data-shift') || '';
        syncUrl();
        loadDetail();
      };
    });
    const pager = document.getElementById('listPager');
    if (total <= PAGE_SIZE) {
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }
    pager.hidden = false;
    const from = start + 1;
    const to = Math.min(total, start + PAGE_SIZE);
    pager.innerHTML =
      '<span class="pager-meta">' +
      from +
      '–' +
      to +
      ' of ' +
      total +
      '</span>' +
      '<button type="button" class="btn secondary" id="zPgPrev"' +
      (listPage <= 1 ? ' disabled' : '') +
      '>Prev</button>' +
      '<button type="button" class="btn secondary" id="zPgNext"' +
      (listPage >= pages ? ' disabled' : '') +
      '>Next</button>';
    document.getElementById('zPgPrev').onclick = () => {
      listPage -= 1;
      paintListPage();
    };
    document.getElementById('zPgNext').onclick = () => {
      listPage += 1;
      paintListPage();
    };
  }

  async function loadList() {
    showListChrome();
    showListSkeleton();
    lastListCsv = [];
    listRowHtmls = [];
    if (!canView) {
      document.getElementById('listWrap').hidden = true;
      document.getElementById('listEmpty').hidden = true;
      document.getElementById('listError').hidden = false;
      return;
    }
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    const res = await apiJson('GET', '/reports/z/shifts?from=' + from + '&to=' + to);
    if (!res.ok) {
      document.getElementById('listWrap').hidden = true;
      document.getElementById('listEmpty').hidden = true;
      document.getElementById('listError').hidden = false;
      return;
    }
    const items = (res.data && res.data.items) || [];
    if (!items.length) {
      document.getElementById('listWrap').hidden = true;
      document.getElementById('listPager').hidden = true;
      document.getElementById('listEmpty').hidden = false;
      lastListCsv = [
        ['Report', 'Z-Reports'],
        ['From', from],
        ['To', to],
        [],
        ['Staff', 'Opened', 'Closed', 'Sales', 'Refunds', 'Difference', 'Status'],
      ];
      return;
    }
    lastListCsv = [
      ['Report', 'Z-Reports'],
      ['From', from],
      ['To', to],
      [],
      ['Staff', 'Opened', 'Closed', 'Sales', 'Refunds', 'Difference', 'Status'],
    ].concat(
      items.map((s) => [
        s.staffName,
        dt(s.openedAt),
        s.closedAt ? dt(s.closedAt) : 'Open',
        (Number(s.sales) || 0).toFixed(2),
        (Number(s.refunds) || 0).toFixed(2),
        s.status === 'open' || s.difference == null ? '' : Number(s.difference).toFixed(2),
        statusLabel(s.status),
      ]),
    );
    listRowHtmls = items.map((s) => {
      const diff = s.difference;
      let diffHtml = '—';
      let diffCls = '';
      if (s.status !== 'open' && diff != null) {
        diffCls = Number(diff) < 0 ? 'diff-neg' : Number(diff) > 0 ? 'diff-pos' : '';
        diffHtml = money(diff);
      }
      return (
        '<tr data-shift="' +
        esc(s.shiftId) +
        '"><td>' +
        esc(s.staffName) +
        '</td><td>' +
        dt(s.openedAt) +
        '</td><td>' +
        (s.closedAt ? dt(s.closedAt) : 'Open') +
        '</td><td class="amt">' +
        money(s.sales) +
        '</td><td class="amt">' +
        money(s.refunds) +
        '</td><td class="amt ' +
        diffCls +
        '">' +
        diffHtml +
        '</td><td><span class="st ' +
        esc(s.status) +
        '">' +
        esc(statusLabel(s.status)) +
        '</span></td></tr>'
      );
    });
    document.getElementById('listEmpty').hidden = true;
    document.getElementById('listWrap').hidden = false;
    listPage = 1;
    paintListPage();
  }

  async function loadDetail() {
    if (!shiftId) {
      await loadList();
      return;
    }
    document.getElementById('viewList').hidden = true;
    document.getElementById('viewDetail').hidden = false;
    document.getElementById('zDoc').hidden = true;
    document.getElementById('detailError').hidden = true;
    document.getElementById('listFilters').hidden = true;
    document.getElementById('btnExport').hidden = true;
    if (!canView) {
      document.getElementById('detailError').hidden = false;
      return;
    }
    const res = await apiJson('GET', '/reports/z/shifts/' + encodeURIComponent(shiftId));
    if (!res.ok) {
      document.getElementById('zDoc').hidden = true;
      document.getElementById('detailError').hidden = false;
      document.getElementById('pageTitle').textContent = 'Z-Report';
      document.getElementById('btnBack').href = '/dashboard/z-report/';
      document.getElementById('btnBack').innerHTML = '<i class="ti ti-arrow-left"></i> Z-Reports';
      document.getElementById('btnPrint').hidden = true;
      document.getElementById('btnPdf').hidden = true;
      return;
    }
    renderDetail(res.data);
  }

  async function downloadPdf() {
    if (!shiftId) return;
    const res = await fetch(API_BASE + '/reports/z/shifts/' + encodeURIComponent(shiftId) + '/pdf', {
      method: 'GET',
      headers: getH({ noJson: true }),
    });
    if (res.status === 401) {
      location.href = '/auth/login/';
      return;
    }
    if (!res.ok) {
      toast("We couldn't export this PDF. Try again.", 'err');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'z-report-shift.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('PDF downloaded.', 'ok');
  }

  function exportListCsv() {
    if (!lastListCsv.length) {
      toast('Nothing to export', 'err');
      return;
    }
    const csv = lastListCsv
      .map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'z-reports.csv';
    a.click();
    toast('CSV exported');
  }

  (function initDates() {
    applyPreset('last7');
  })();

  document.getElementById('btnRange').onclick = (ev) => {
    ev.stopPropagation();
    const pop = document.getElementById('rangePop');
    const open = pop.hidden;
    closePops();
    if (open) {
      pop.hidden = false;
      document.getElementById('btnRange').setAttribute('aria-expanded', 'true');
    }
  };
  document.querySelectorAll('#rangePop .range-opt').forEach((btn) => {
    btn.onclick = () => {
      applyPreset(btn.getAttribute('data-preset'));
      closePops();
      shiftId = '';
      syncUrl();
      loadList();
    };
  });
  document.getElementById('btnApply').onclick = () => {
    rangePreset = 'custom';
    setRangeLabel();
    closePops();
    shiftId = '';
    syncUrl();
    loadList();
  };
  document.getElementById('btnChangeDate').onclick = (ev) => {
    ev.stopPropagation();
    document.getElementById('rangePop').hidden = false;
    document.getElementById('btnRange').setAttribute('aria-expanded', 'true');
  };
  document.getElementById('btnRetryList').onclick = () => loadList();
  document.getElementById('btnRetryDetail').onclick = () => loadDetail();
  document.getElementById('btnExport').onclick = exportListCsv;
  document.getElementById('btnPrint').onclick = () => window.print();
  document.getElementById('btnPdf').onclick = downloadPdf;
  document.getElementById('btnBack').addEventListener('click', (ev) => {
    if (!shiftId) return;
    ev.preventDefault();
    shiftId = '';
    syncUrl();
    loadList();
  });
  document.getElementById('crumb').addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    shiftId = '';
    syncUrl();
    loadList();
  });
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('.range-wrap')) return;
    closePops();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closePops();
  });

  (async () => {
    try {
      const r = await fetch(API_BASE + '/settings', { headers: getH() });
      if (r.ok) {
        const s = await r.json();
        document.getElementById('gymName').textContent = s.gymName || '';
      }
    } catch (_) {}
    if (shiftId) await loadDetail();
    else await loadList();
  })();
})(typeof window !== 'undefined' ? window : globalThis);
