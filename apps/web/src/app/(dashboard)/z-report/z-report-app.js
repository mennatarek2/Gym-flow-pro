(function () {
  'use strict';
  const API_BASE = window.API_BASE || 'https://localhost:5001/api';

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
  }
  function getH(opts) {
    const t = getToken();
    const h = {};
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
  const canRegen = /Owner|Manager/i.test(role);

  if (canRegen) {
    const btn = document.getElementById('btnRegen');
    btn.style.display = 'inline-flex';
  }

  let currentReport = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(Number(n));
  }
  function dt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? esc(iso)
      : d.toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  }
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
    el.textContent = msg;
    setTimeout(() => el.classList.remove('show'), 4200);
  }

  /** Cairo calendar date YYYY-MM-DD */
  function cairoToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch (_) {
      const d = new Date();
      return d.toISOString().slice(0, 10);
    }
  }

  function problemMessage(data, status) {
    if (!data) return 'Request failed (' + status + ')';
    const title = data.title || '';
    const detail = data.detail || data.message || '';
    if (title === 'ZREPORT_NOT_FOUND') return 'ZREPORT_NOT_FOUND';
    if (detail && detail.indexOf(' / ') !== -1) return detail.split(' / ')[0].trim();
    return detail || title || 'Request failed (' + status + ')';
  }

  async function apiJson(method, path, body) {
    const opts = { method, headers: getH() };
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

  function hideAll() {
    document.getElementById('notYet').style.display = 'none';
    document.getElementById('errorBanner').style.display = 'none';
    document.getElementById('reportBody').style.display = 'none';
  }

  function showNotYet(dateStr) {
    hideAll();
    currentReport = null;
    document.getElementById('btnPdf').disabled = true;
    document.getElementById('btnRegen').disabled = !canRegen;
    const el = document.getElementById('notYet');
    el.style.display = 'flex';
    const today = cairoToday();
    if (dateStr === today) {
      document.getElementById('notYetMsg').textContent =
        'Z-report for today (Cairo) is generated after ~23:59. A 404 ZREPORT_NOT_FOUND before then is normal — not an error.';
    } else if (dateStr > today) {
      document.getElementById('notYetMsg').textContent =
        'That date is still in the future (Cairo). No Z-report exists yet.';
    } else {
      document.getElementById('notYetMsg').textContent =
        'No Z-report snapshot for ' +
        dateStr +
        '. Manager+ can regenerate to build (or rebuild) the immutable snapshot.';
    }
  }

  function showError(msg) {
    hideAll();
    currentReport = null;
    document.getElementById('btnPdf').disabled = true;
    document.getElementById('btnRegen').disabled = !canRegen;
    document.getElementById('errorBanner').style.display = 'flex';
    document.getElementById('errorMsg').textContent = msg;
  }

  function renderReport(r) {
    hideAll();
    currentReport = r;
    document.getElementById('reportBody').style.display = 'block';
    document.getElementById('btnPdf').disabled = !canView;
    document.getElementById('btnRegen').disabled = !canRegen;

    document.getElementById('mDate').textContent = r.reportDate || '—';
    document.getElementById('mGenerated').textContent = dt(r.generatedAt);
    const pdfEl = document.getElementById('mPdf');
    if (r.pdfUrl) {
      pdfEl.innerHTML =
        '<a href="' + esc(r.pdfUrl) + '" target="_blank" rel="noopener">Open stored PDF</a>';
    } else {
      pdfEl.textContent = 'Use PDF button (or not linked yet)';
    }

    document.getElementById('summaryKv').innerHTML = [
      ['Membership revenue', money(r.membershipRevenueToday)],
      ['Promo discounts', money(r.promoDiscountTotal)],
      ['Manual discounts', money(r.manualDiscountTotal) + ' (' + (r.manualDiscountCount || 0) + ')'],
      ['Refunds total', money(r.refundsTotal)],
      ['Outstanding added today', money(r.outstandingAddedToday)],
    ]
      .map(
        ([k, v]) =>
          '<div class="kv-row"><span>' + esc(k) + '</span><span>' + v + '</span></div>',
      )
      .join('');

    const methods = Array.isArray(r.methodTotals) ? r.methodTotals : [];
    document.getElementById('methodTbody').innerHTML = methods.length
      ? methods
          .map(
            (m) =>
              '<tr><td>' +
              esc(m.method) +
              '</td><td>' +
              esc(String(m.count)) +
              '</td><td>' +
              esc(money(m.total)) +
              '</td></tr>',
          )
          .join('')
      : '<tr><td colspan="3" class="muted">None</td></tr>';

    const lines = Array.isArray(r.lineTypeTotals) ? r.lineTypeTotals : [];
    document.getElementById('lineTbody').innerHTML = lines.length
      ? lines
          .map(
            (m) =>
              '<tr><td>' +
              esc(m.lineType) +
              '</td><td>' +
              esc(String(m.count)) +
              '</td><td>' +
              esc(money(m.revenue)) +
              '</td></tr>',
          )
          .join('')
      : '<tr><td colspan="3" class="muted">None</td></tr>';

    const shifts = Array.isArray(r.shifts) ? r.shifts : [];
    document.getElementById('shiftTbody').innerHTML = shifts.length
      ? shifts
          .map((s) => {
            const v = s.variance;
            let vCls = '';
            let vTxt = '—';
            if (v != null && !Number.isNaN(Number(v))) {
              vCls = Number(v) >= 0 ? 'var-pos' : 'var-neg';
              vTxt = money(v);
            }
            return (
              '<tr>' +
              '<td>' +
              esc(s.userName || s.userId) +
              '</td>' +
              '<td>' +
              esc(dt(s.openedAt)) +
              '</td>' +
              '<td>' +
              esc(s.closedAt ? dt(s.closedAt) : '—') +
              '</td>' +
              '<td>' +
              esc(money(s.openingFloat)) +
              '</td>' +
              '<td>' +
              esc(s.expectedCash != null ? money(s.expectedCash) : '—') +
              '</td>' +
              '<td>' +
              esc(s.countedCash != null ? money(s.countedCash) : '—') +
              '</td>' +
              '<td class="' +
              vCls +
              '">' +
              esc(vTxt) +
              '</td>' +
              '<td><span class="st ' +
              esc(s.status) +
              '">' +
              esc(s.status) +
              '</span></td>' +
              '</tr>'
            );
          })
          .join('')
      : '<tr><td colspan="8" class="muted">No shifts</td></tr>';
  }

  async function loadReport() {
    if (!canView) {
      showError('Need reports.financial.view');
      return;
    }
    const date = document.getElementById('reportDate').value;
    if (!date) {
      toast('Pick a date', 'err');
      return;
    }
    const res = await apiJson('GET', '/reports/z/' + date);
    if (res.ok) {
      renderReport(res.data);
      return;
    }
    const code =
      (res.data && res.data.title) ||
      (res.status === 404 ? 'ZREPORT_NOT_FOUND' : '');
    if (res.status === 404 || code === 'ZREPORT_NOT_FOUND') {
      showNotYet(date);
      return;
    }
    showError(problemMessage(res.data, res.status));
  }

  async function downloadPdf() {
    const date = document.getElementById('reportDate').value;
    if (!date) return;
    const res = await fetch(API_BASE + '/reports/z/' + date + '/pdf', {
      method: 'GET',
      headers: getH({ noJson: true }),
    });
    if (res.status === 401) {
      location.href = '/auth/login/';
      return;
    }
    if (res.status === 404) {
      const ct = res.headers.get('content-type') || '';
      let title = '';
      if (ct.includes('json')) {
        const data = await res.json().catch(() => null);
        title = data && data.title;
      }
      if (title === 'ZREPORT_NOT_FOUND' || !title) {
        showNotYet(date);
        toast('PDF not yet available for this date.', 'err');
        return;
      }
    }
    if (!res.ok) {
      let msg = 'PDF download failed (' + res.status + ')';
      try {
        const data = await res.json();
        msg = problemMessage(data, res.status);
      } catch (_) {}
      toast(msg, 'err');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'z-report-' + date + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('PDF downloaded.', 'ok');
  }

  async function regenerate() {
    if (!canRegen) {
      toast('Manager or Owner required to regenerate.', 'err');
      return;
    }
    const date = document.getElementById('reportDate').value;
    if (!date) return;
    if (
      !confirm(
        'Regenerate Z-report for ' +
          date +
          '?\n\nThis replaces the immutable snapshot for that day.',
      )
    ) {
      return;
    }
    const res = await apiJson('POST', '/reports/z/' + date + '/regenerate');
    if (!res.ok) {
      if (res.status === 404 && (res.data && res.data.title) === 'ZREPORT_NOT_FOUND') {
        showNotYet(date);
      }
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    toast('Z-report regenerated (snapshot replaced).', 'ok');
    if (res.data && res.data.reportDate) {
      renderReport(res.data);
    } else {
      await loadReport();
    }
  }

  // Default to yesterday Cairo (today often not yet available)
  (function initDate() {
    const today = cairoToday();
    const parts = today.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    d.setUTCDate(d.getUTCDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    document.getElementById('reportDate').value = y + '-' + m + '-' + day;
  })();

  document.getElementById('btnLoad').onclick = loadReport;
  document.getElementById('btnPdf').onclick = downloadPdf;
  document.getElementById('btnRegen').onclick = regenerate;
  document.getElementById('reportDate').addEventListener('change', loadReport);

  // Prefer loading yesterday; if missing, UI shows not-yet / empty gracefully
  loadReport();
})();
