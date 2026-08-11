// GymFlowPro — Analytics (§16 snapshots) + Detailed Reports (§17 live)
(function () {
  'use strict';

  function getToken() {
    return localStorage.getItem('gfp_access_token') || sessionStorage.getItem('gfp_access_token');
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

  const user = JSON.parse(
    localStorage.getItem('gfp_user') || sessionStorage.getItem('gfp_user') || '{}',
  );
  const role = user.role || '';
  const perms = getPerms();
  const canFinance = perms.has('reports.financial.view') || /Owner|Manager/i.test(role);
  const canMembers = perms.has('members.view') || /Owner|Manager|Trainer|Receptionist/i.test(role);

  let attendanceChart = null;
  let revenueChart = null;
  let statusChart = null;
  let revMethod = '';

  // Narrow default for live reports (7 days) — revenue has no pagination
  const today = new Date();
  const fromD = new Date(today);
  fromD.setDate(fromD.getDate() - 6);
  document.getElementById('dateTo').value = today.toISOString().slice(0, 10);
  document.getElementById('dateFrom').value = fromD.toISOString().slice(0, 10);

  // Trial month default: current YYYY-MM
  document.getElementById('trialMonth').value = today.toISOString().slice(0, 7);

  function toast(msg, type) {
    type = type || 'success';
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'error' : 'success');
    el.innerHTML =
      '<i class="ti ' +
      (type === 'error' ? 'ti-alert-circle' : 'ti-check') +
      '"></i>' +
      msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function fmt(d) {
    if (!d) return '—';
    return new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium' }).format(new Date(d));
  }
  function money(n) {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(Number(n) || 0);
  }
  function asOfLocal(iso) {
    if (!iso) return 'as of —';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'as of —';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return 'as of ' + hh + ':' + mm;
  }
  function dateRange() {
    return {
      from: document.getElementById('dateFrom').value,
      to: document.getElementById('dateTo').value,
    };
  }
  function payChip(m) {
    const key = (m || '').toLowerCase();
    const map = {
      cash: ['pay-cash', 'Cash'],
      card_paymob: ['pay-paymob', 'Paymob'],
      paymob: ['pay-paymob', 'Paymob'],
      fawry: ['pay-fawry', 'Fawry'],
      vodafone: ['pay-voda', 'Vodafone'],
      vodafone_cash: ['pay-voda', 'Vodafone'],
      instapay: ['pay-paymob', 'Instapay'],
    };
    const v = map[key] || ['pay-cash', m || '—'];
    return '<span class="pay-chip ' + v[0] + '">' + v[1] + '</span>';
  }
  function isAllZero(nums) {
    return nums.every((n) => !n || Number(n) === 0);
  }
  function emptyHtml(msg) {
    return '<div class="empty-state show">' + msg + '</div>';
  }

  // Financial sections: gate with blur (Trainers see non-money analytics)
  if (!canFinance) {
    ['blurOverview', 'blurRevChart', 'blurRevenue', 'blurRetention'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    });
  }

  document.getElementById('btnApply').addEventListener('click', loadLive);
  document.querySelectorAll('.rev-filters .ftab').forEach((btn) => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.rev-filters .ftab').forEach((b) => b.classList.remove('active'));
      this.classList.add('active');
      revMethod = this.dataset.m;
      loadRevenue();
    });
  });
  document.getElementById('btnExport').addEventListener('click', function () {
    const rows = document.querySelectorAll('#tbAttendance tr');
    if (!rows.length) return;
    let csv = 'Date,Check-ins,Unique Members\n';
    rows.forEach((r) => {
      const cells = r.querySelectorAll('td');
      if (cells.length >= 3)
        csv += cells[0].textContent + ',' + cells[1].textContent + ',' + cells[2].textContent + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'attendance_report.csv';
    a.click();
    toast('CSV exported');
  });

  // ═══════════════════════════════════════════════════════════
  // §16 — Snapshots (load once; do not poll aggressively)
  // ═══════════════════════════════════════════════════════════

  async function loadOverview() {
    if (!canFinance) return;
    try {
      const data = await apiGet('/analytics/overview');
      if (!data) return;
      document.getElementById('overviewAsOf').textContent = asOfLocal(data.snapshotTimeUtc);
      const cards = [
        ['Active members', data.activeMembers],
        ['Expired members', data.expiredMembers],
        ['New this month', data.newMembersThisMonth],
        ['Revenue this month', money(data.revenueThisMonth), true],
        ['Check-ins today', data.checkinsToday],
        ['Check-ins this week', data.checkinsThisWeek],
      ];
      const zeros = cards.every((c) => (typeof c[1] === 'string' ? false : !c[1]));
      const grid = document.getElementById('overviewGrid');
      if (zeros && !data.revenueThisMonth && !data.activeMembers) {
        grid.innerHTML = emptyHtml('No snapshot data yet');
        return;
      }
      grid.innerHTML = cards
        .map(
          (c) =>
            '<div class="ov-kpi"><span class="lbl">' +
            c[0] +
            '</span><strong>' +
            (c[2] ? c[1] : Number(c[1] || 0).toLocaleString()) +
            '</strong></div>',
        )
        .join('');
    } catch (e) {
      document.getElementById('overviewGrid').innerHTML = emptyHtml('Could not load overview');
    }
  }

  async function loadRevenueChart() {
    if (!canFinance) return;
    const empty = document.getElementById('revChartEmpty');
    const canvas = document.getElementById('chartRevenue');
    try {
      const data = await apiGet('/analytics/revenue?months=6');
      const labels = (data && data.labels) || [];
      const values = (data && data.values) || [];
      if (!labels.length || isAllZero(values)) {
        empty.style.display = 'block';
        empty.classList.add('show');
        if (revenueChart) {
          revenueChart.destroy();
          revenueChart = null;
        }
        return;
      }
      empty.style.display = 'none';
      if (revenueChart) revenueChart.destroy();
      // Feed Chart.js directly from parallel arrays
      revenueChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Revenue',
              data: values,
              borderColor: '#7ACC00',
              backgroundColor: 'rgba(122,204,0,.15)',
              fill: true,
              tension: 0.3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
            x: { ticks: { font: { family: 'JetBrains Mono', size: 10 } } },
          },
        },
      });
    } catch (e) {
      empty.style.display = 'block';
      empty.textContent = 'Could not load revenue chart';
    }
  }

  async function loadStatusPie() {
    if (!canMembers) return;
    const empty = document.getElementById('statusEmpty');
    try {
      const data = await apiGet('/analytics/members-status');
      if (!data) return;
      const slices = [
        { label: 'Active', v: data.active || 0, c: '#22C55E' },
        { label: 'Expired', v: data.expired || 0, c: '#EF4444' },
        { label: 'Frozen', v: data.frozen || 0, c: '#22D3EE' },
        { label: 'Cancelled', v: data.cancelled || 0, c: '#8C8C8C' },
      ];
      if ((data.total || 0) === 0 || isAllZero(slices.map((s) => s.v))) {
        empty.style.display = 'block';
        if (statusChart) {
          statusChart.destroy();
          statusChart = null;
        }
        return;
      }
      empty.style.display = 'none';
      if (statusChart) statusChart.destroy();
      statusChart = new Chart(document.getElementById('chartStatus'), {
        type: 'doughnut',
        data: {
          labels: slices.map((s) => s.label),
          datasets: [{ data: slices.map((s) => s.v), backgroundColor: slices.map((s) => s.c) }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans', size: 11 } } } },
        },
      });
    } catch (e) {
      empty.style.display = 'block';
      empty.textContent = 'Could not load status';
    }
  }

  async function loadHeatmap() {
    if (!canMembers) return;
    const wrap = document.getElementById('heatmapWrap');
    const empty = document.getElementById('heatmapEmpty');
    try {
      const data = await apiGet('/analytics/heatmap');
      const matrix = (data && data.data) || [];
      // Mon-first 7×24
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      let max = 0;
      matrix.forEach((row) => (row || []).forEach((v) => { if (v > max) max = v; }));
      if (!matrix.length || max === 0) {
        wrap.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      let html = '<div class="hm-corner"></div>';
      for (let h = 0; h < 24; h++) html += '<div class="hm-h">' + h + '</div>';
      for (let d = 0; d < 7; d++) {
        html += '<div class="hm-d">' + days[d] + '</div>';
        const row = matrix[d] || [];
        for (let h = 0; h < 24; h++) {
          const v = Number(row[h] || 0);
          let lvl = 0;
          if (max > 0) {
            const r = v / max;
            lvl = r === 0 ? 0 : r < 0.34 ? 1 : r < 0.67 ? 2 : 3;
          }
          html +=
            '<div class="hm-cell c' +
            lvl +
            '" title="' +
            days[d] +
            ' ' +
            h +
            ':00 — ' +
            v +
            '"></div>';
        }
      }
      wrap.innerHTML = html;
    } catch (e) {
      wrap.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = 'Could not load heatmap';
    }
  }

  function renderFunnel(el, steps, emptyMsg) {
    const vals = steps.map((s) => s.v);
    if (isAllZero(vals)) {
      el.innerHTML = emptyHtml(emptyMsg);
      return;
    }
    const max = Math.max(...vals, 1);
    el.innerHTML = steps
      .map((s) => {
        const w = Math.max(8, (s.v / max) * 100);
        return (
          '<div class="funnel-row"><span class="f-lbl">' +
          s.l +
          '</span><div class="f-bar-wrap"><div class="f-bar" style="width:' +
          w +
          '%"></div></div><span class="f-val">' +
          (typeof s.display === 'string' ? s.display : Number(s.v).toLocaleString()) +
          '</span></div>'
        );
      })
      .join('');
  }

  async function loadInvitations() {
    if (!canMembers) return;
    try {
      const data = await apiGet('/analytics/invitations');
      if (!data) return;

      function typeSteps(slice, emptyLabel) {
        slice = slice || {};
        return {
          steps: [
            { l: 'Sent', v: slice.sent || 0 },
            { l: 'Visited', v: slice.visited || 0 },
            { l: 'Converted', v: slice.converted || 0 },
            {
              l: 'Conversion',
              v: slice.conversionRate || 0,
              display: (slice.conversionRate || 0).toFixed(1) + '%',
            },
          ],
          empty: emptyLabel,
        };
      }

      renderFunnel(
        document.getElementById('inviteFunnelOverall'),
        [
          { l: 'Sent (all)', v: data.sent || 0 },
          { l: 'Visited', v: data.visited || 0 },
          { l: 'Converted', v: data.converted || 0 },
          {
            l: 'Conversion',
            v: data.conversionRate || 0,
            display: (data.conversionRate || 0).toFixed(1) + '%',
          },
        ],
        'No invitation activity',
      );

      const guest = typeSteps(data.guestPass, 'No guest-pass invites');
      renderFunnel(document.getElementById('inviteFunnelGuest'), guest.steps, guest.empty);

      const ref = typeSteps(data.referral, 'No referral invites');
      renderFunnel(document.getElementById('inviteFunnelReferral'), ref.steps, ref.empty);

      const contrib = document.getElementById('inviteContribution');
      if (contrib) {
        const pct = data.percentNewMembersFromReferrals != null
          ? Number(data.percentNewMembersFromReferrals).toFixed(1)
          : '0.0';
        const nm = data.newMembersThisMonth || 0;
        const rc = data.referralConvertedMembersThisMonth || 0;
        contrib.innerHTML =
          '<div class="contrib-row"><span class="contrib-label">New members this month (Cairo)</span>' +
          '<strong>' +
          Number(nm).toLocaleString() +
          '</strong></div>' +
          '<div class="contrib-row"><span class="contrib-label">From referrals (this month)</span>' +
          '<strong>' +
          Number(rc).toLocaleString() +
          '</strong></div>' +
          '<div class="contrib-pct">' +
          pct +
          '% <span>of new members from referrals</span></div>';
      }
    } catch (e) {
      ['inviteFunnelOverall', 'inviteFunnelGuest', 'inviteFunnelReferral'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = emptyHtml('Could not load invitations');
      });
    }
  }

  function loadSnapshots() {
    // One-shot — no interval polling for §16
    loadOverview();
    loadRevenueChart();
    loadStatusPie();
    loadHeatmap();
    loadInvitations();
  }

  // ═══════════════════════════════════════════════════════════
  // §17 — Live drill-downs (on Apply / filters)
  // ═══════════════════════════════════════════════════════════

  async function loadAttendance() {
    if (!canMembers) {
      document.getElementById('tbAttendance').innerHTML =
        '<tr><td colspan="3" class="tbl-empty">Need members.view</td></tr>';
      return;
    }
    const { from, to } = dateRange();
    const tb = document.getElementById('tbAttendance');
    const empty = document.getElementById('attEmpty');
    tb.innerHTML =
      '<tr><td colspan="3"><div class="sk" style="height:14px;width:60%;margin:8px auto"></div></td></tr>';
    try {
      const data = await apiGet('/reports/attendance-summary?from=' + from + '&to=' + to);
      const items = Array.isArray(data) ? data : [];
      if (!items.length || isAllZero(items.map((r) => r.checkinCount || 0))) {
        tb.innerHTML = '<tr><td colspan="3" class="tbl-empty">No attendance in range</td></tr>';
        empty.style.display = 'block';
        renderAttChart([]);
        return;
      }
      empty.style.display = 'none';
      tb.innerHTML = items
        .map(
          (r) =>
            '<tr><td>' +
            fmt(r.date) +
            '</td><td style="font-weight:600">' +
            Number(r.checkinCount || 0).toLocaleString() +
            '</td><td>' +
            Number(r.uniqueMembers || 0).toLocaleString() +
            '</td></tr>',
        )
        .join('');
    renderAttChart(items);
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="3" class="tbl-empty">Failed to load attendance</td></tr>';
      renderAttChart([]);
    }
  }

  function renderAttChart(items) {
    const ctx = document.getElementById('chartAttendance');
    if (attendanceChart) attendanceChart.destroy();
    if (!items.length) {
      attendanceChart = null;
      return;
    }
    const labels = items.map((r) => {
      const d = new Date(r.date);
      return d.getDate() + '/' + String(d.getMonth() + 1).padStart(2, '0');
    });
    const vals = items.map((r) => r.checkinCount || 0);
    attendanceChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Check-ins',
            data: vals,
            backgroundColor: 'rgba(122,204,0,.6)',
            borderColor: '#7ACC00',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.04)' } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  async function loadRevenue() {
    if (!canFinance) return;
    const { from, to } = dateRange();
    const tb = document.getElementById('tbRevenue');
    const tf = document.getElementById('tfRevenue');
    tb.innerHTML =
      '<tr><td colspan="5"><div class="sk" style="height:14px;width:60%;margin:8px auto"></div></td></tr>';
    tf.innerHTML = '';
    try {
      const q =
        '/reports/revenue-detail?from=' +
        from +
        '&to=' +
        to +
        (revMethod ? '&method=' + encodeURIComponent(revMethod) : '');
      const data = await apiGet(q);
      const items = Array.isArray(data) ? data : [];
      if (!items.length) {
        tb.innerHTML = '<tr><td colspan="5" class="tbl-empty">No revenue in range</td></tr>';
        return;
      }
      let total = 0;
      tb.innerHTML = items
        .map((r) => {
          const a = Number(r.amount || 0);
          total += a;
          return (
            '<tr><td>' +
            fmt(r.transactionDate) +
            '</td><td>' +
            (r.memberName || '—') +
            '</td><td>' +
            (r.planName || '—') +
            '</td><td class="amt amt-pos">' +
            money(a) +
            '</td><td>' +
            payChip(r.paymentMethod) +
            '</td></tr>'
          );
        })
        .join('');
      tf.innerHTML =
        '<tr><td colspan="3" style="text-align:right;font-size:12px">Subtotal</td><td class="amt amt-total">' +
        money(total) +
        '</td><td></td></tr>';
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="5" class="tbl-empty">Failed to load revenue</td></tr>';
    }
  }

  async function loadPeak() {
    if (!canMembers) {
      document.getElementById('peakContent').innerHTML = emptyHtml('Need members.view');
      return;
    }
    const el = document.getElementById('peakContent');
    el.innerHTML = '<div class="sk" style="height:14px;width:50%;margin:12px 0"></div>'.repeat(3);
    try {
      const data = await apiGet('/reports/peak-hours');
      const items = (Array.isArray(data) ? data : []).slice(0, 5);
      if (!items.length || isAllZero(items.map((r) => r.checkinCount || 0))) {
        el.innerHTML = emptyHtml('No peak hour data');
        return;
      }
      const max = Math.max(...items.map((r) => r.checkinCount || 0), 1);
      const colors = ['var(--l500)', 'var(--inf500)', 'var(--wrn500)', 'var(--frz500)', 'var(--c300)'];
      el.innerHTML = items
        .map((r, i) => {
          const c = r.checkinCount || 0;
          const pctBar = ((c / max) * 100).toFixed(1);
          const pct = r.percentage != null ? Number(r.percentage).toFixed(1) : '0';
          const rcls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : 'rn';
          return (
            '<div class="peak-item"><div class="peak-rank ' +
            rcls +
            '">' +
            (i + 1) +
            '</div><div class="peak-time">' +
            (r.timeSlot || '—') +
            '</div><div class="peak-bar-wrap"><div class="peak-bar" style="width:' +
            pctBar +
            '%;background:' +
            colors[i] +
            '"></div></div><div class="peak-count">' +
            c +
            '</div><div class="peak-pct">' +
            pct +
            '%</div></div>'
          );
        })
        .join('');
    } catch (e) {
      el.innerHTML = emptyHtml('Failed to load peak hours');
    }
  }

  async function loadRetention() {
    if (!canFinance) return;
    try {
      const data = await apiGet('/reports/member-retention');
      if (!data) return;
      const expired = data.totalExpiredMemberships || 0;
      const renewed = data.renewedMemberships || 0;
      const rate = Number(data.retentionRate || 0);
      if (!expired && !renewed && !rate) {
        document.getElementById('retExpired').textContent = '0';
        document.getElementById('retRenewed').textContent = '0';
        renderGauge(0);
        document.getElementById('retBench').textContent = 'No retention data yet';
        return;
      }
      document.getElementById('retExpired').textContent = expired.toLocaleString();
      document.getElementById('retRenewed').textContent = renewed.toLocaleString();
    renderGauge(rate);
      const bench = document.getElementById('retBench');
      const cls = rate >= 35 ? 'bench-good' : 'bench-low';
      bench.innerHTML =
        '<i class="ti ' +
        (rate >= 35 ? 'ti-trending-up' : 'ti-trending-down') +
        '" style="font-size:14px"></i><span class="' +
        cls +
        '">' +
        rate.toFixed(1) +
        '%</span> — Industry avg: ~35%';
      bench.className = 'benchmark ' + cls;
    } catch (e) {
      /* gated */
    }
  }

  function renderGauge(pct) {
    const el = document.getElementById('retGauge');
    pct = Math.min(100, Math.max(0, pct));
    const deg = 180 * (pct / 100);
    const color = pct >= 35 ? 'var(--suc500)' : pct >= 20 ? 'var(--wrn500)' : 'var(--dng500)';
    el.innerHTML =
      '<div class="semi-gauge-bg"></div><div class="semi-gauge-fill" style="border-top-color:' +
      color +
      ';border-right-color:' +
      color +
      ';transform:rotate(' +
      (deg - 45) +
      'deg)"></div><div class="semi-gauge-val">' +
      pct.toFixed(1) +
      '%</div>';
  }

  function loadLive() {
    loadAttendance();
    loadRevenue();
    loadPeak();
    loadRetention();
  }

  // Snapshots once; live on demand — no aggressive snapshot polling
  loadSnapshots();
  loadLive();
})();
