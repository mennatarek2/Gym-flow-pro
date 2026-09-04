(function () {
  'use strict';
  const API_BASE = window.API_BASE || 'https://reach-lullaby-tighten.ngrok-free.dev/api';
  const MAX_BYTES = 5 * 1024 * 1024;
  const TARGET_FIELDS = [
    '',
    'fullName',
    'phoneNumber',
    'planName',
    'startDate',
    'endDate',
    'sessionsRemaining',
    'dateOfBirth',
  ];
  const PLAN_TYPES = [
    'monthly_unlimited',
    'session_pack',
    'time_limited',
    'pt_credits',
    'family',
    'trial',
    'day_pass',
  ];
  const STEP_ORDER = [
    'none',
    'validating',
    'dry_run_ready',
    'importing',
    'completed',
    'failed',
    'rolled_back',
  ];
  const BATCH_KEY = 'gfp_import_batch_id';

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
  const canImport = perms.has('settings.manage') || /Owner/i.test(role);
  const canPlans = perms.has('plans.manage') || /Owner/i.test(role);
  const canRollback = /Owner|Manager/i.test(role);

  /** Server batch — ONLY source of wizard step. */
  let batch = null;
  let pollTimer = null;
  let unmatchedPlans = [];

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function toast(msg, type) {
    return globalThis.toastShared(msg, type);
  }
  function problemMessage(data, status) {
    if (!data) return 'Request failed (' + status + ')';
    const title = data.title || '';
    const detail = data.detail || data.message || '';
    const map = {
      BATCH_NOT_FOUND: 'Import batch not found.',
      INVALID_STATUS: 'Invalid batch status for this action.',
      FILE_TOO_LARGE: 'File too large (max 5 MB).',
      TOO_MANY_ROWS: 'Too many rows (max 10,000).',
      UNSUPPORTED_FILE_TYPE: 'Unsupported file type — use .xlsx or .csv.',
      ROLLBACK_WINDOW_EXPIRED: '7-day rollback window has expired.',
      FEATURE_DISABLED: 'Imports feature is disabled for this tenant.',
    };
    if (map[title]) return map[title];
    return detail || title || 'Request failed (' + status + ')';
  }

  async function api(method, path, body, opts) {
    const headers = getH(opts);
    const fetchOpts = { method, headers };
    if (body !== undefined && !(opts && opts.formData)) {
      fetchOpts.body = JSON.stringify(body);
    }
    if (opts && opts.formData) {
      fetchOpts.body = opts.formData;
      // browser sets multipart boundary
    }
    const res = await fetch(API_BASE + path, fetchOpts);
    if (res.status === 401) {
      location.href = '/auth/login/';
      return { ok: false, status: 401, data: null, blob: null };
    }
    if (opts && opts.asBlob) {
      if (!res.ok) {
        let data = null;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) data = await res.json().catch(() => null);
        return { ok: false, status: res.status, data, blob: null };
      }
      return { ok: true, status: res.status, data: null, blob: await res.blob() };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, blob: null };
  }

  function setBatchIdInUrl(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set('batch', id);
    else u.searchParams.delete('batch');
    history.replaceState(null, '', u.pathname + u.search);
    if (id) localStorage.setItem(BATCH_KEY, id);
    else localStorage.removeItem(BATCH_KEY);
  }

  function readBatchIdFromUrl() {
    const u = new URL(location.href);
    return u.searchParams.get('batch') || localStorage.getItem(BATCH_KEY) || null;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPollIfNeeded() {
    stopPoll();
    if (!batch) return;
    if (batch.status === 'validating' || batch.status === 'importing') {
      pollTimer = setInterval(() => refreshBatch(false), 2000);
    }
  }

  function renderStepTrack() {
    const status = batch ? batch.status : 'none';
    const labels = {
      none: 'Upload',
      validating: 'Validating',
      dry_run_ready: 'Dry-run',
      importing: 'Importing',
      completed: 'Completed',
      failed: 'Failed',
      rolled_back: 'Rolled back',
    };
    const el = document.getElementById('stepTrack');
    el.innerHTML = STEP_ORDER.map((s) => {
      let cls = 'step-pill';
      if (s === status) cls += ' on';
      else if (
        STEP_ORDER.indexOf(s) < STEP_ORDER.indexOf(status) &&
        status !== 'failed' &&
        status !== 'rolled_back'
      )
        cls += ' done';
      return '<span class="' + cls + '">' + esc(labels[s] || s) + '</span>';
    }).join('');
  }

  function kpisHtml(b) {
    return (
      '<div class="kpi"><span class="lbl">Total</span><strong>' +
      esc(String(b.totalRows || 0)) +
      '</strong></div>' +
      '<div class="kpi"><span class="lbl">OK</span><strong>' +
      esc(String(b.okRows || 0)) +
      '</strong></div>' +
      '<div class="kpi"><span class="lbl">Errors</span><strong>' +
      esc(String(b.errorRows || 0)) +
      '</strong></div>' +
      '<div class="kpi"><span class="lbl">Status</span><strong><span class="st-chip ' +
      esc(b.status) +
      '">' +
      esc(b.status) +
      '</span></strong></div>'
    );
  }

  /** Drive visible panels ONLY from batch.status */
  function applyStatusUi() {
    renderStepTrack();
    const status = batch ? batch.status : 'none';
    const meta = document.getElementById('batchMeta');
    if (batch) {
      meta.style.display = 'flex';
      document.getElementById('metaTitle').textContent =
        (batch.fileName || 'Batch') + ' · ' + batch.status;
      document.getElementById('metaLine').innerHTML =
        'id <code>' +
        esc(batch.id) +
        '</code> · created ' +
        esc(batch.createdAtUtc || '—') +
        (batch.completedAt ? ' · completed ' + esc(batch.completedAt) : '');
    } else {
      meta.style.display = 'none';
    }

    document.querySelectorAll('.panel').forEach((panel) => {
      const when = (panel.getAttribute('data-show-when') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const show = when.includes(status);
      panel.style.display = show ? 'block' : 'none';
    });

    document.getElementById('validatingNote').style.display =
      status === 'validating' ? 'inline' : 'none';

    if (status === 'validating' || status === 'dry_run_ready' || status === 'failed') {
      renderMappingFromServer();
    }
    if (status === 'dry_run_ready') {
      document.getElementById('dryKpis').innerHTML = kpisHtml(batch);
    }
    if (status === 'importing') {
      document.getElementById('importingKpis').innerHTML = kpisHtml(batch);
    }
    if (status === 'completed') {
      document.getElementById('doneKpis').innerHTML = kpisHtml(batch);
      updateRollbackUi();
    }
    if (status === 'rolled_back') {
      document.getElementById('rolledKpis').innerHTML = kpisHtml(batch);
    }

    startPollIfNeeded();
  }

  function renderMappingFromServer() {
    const wrap = document.getElementById('mappingRows');
    const mapping = (batch && batch.mapping) || {};
    const headers = Object.keys(mapping);
    if (!headers.length) {
      wrap.innerHTML = '<p class="muted">No mapping on server yet.</p>';
      return;
    }
    // Always render server's current mapping — never a local cache copy
    wrap.innerHTML = headers
      .map((src) => {
        const cur = mapping[src] || '';
        const opts = TARGET_FIELDS.map(
          (t) =>
            '<option value="' +
            esc(t) +
            '"' +
            (t === cur ? ' selected' : '') +
            '>' +
            (t || '(ignore)') +
            '</option>',
        ).join('');
        return (
          '<div class="map-row">' +
          '<label>Source header<input class="map-src" readonly dir="ltr" value="' +
          esc(src) +
          '"></label>' +
          '<label>Target field<select class="map-tgt">' +
          opts +
          '</select></label>' +
          '</div>'
        );
      })
      .join('');
  }

  function readMappingFromForm() {
    const rows = document.querySelectorAll('#mappingRows .map-row');
    const mapping = {};
    rows.forEach((row) => {
      const src = row.querySelector('.map-src').value;
      const tgt = row.querySelector('.map-tgt').value;
      if (src) mapping[src] = tgt;
    });
    return mapping;
  }

  function updateRollbackUi() {
    const btn = document.getElementById('btnRollback');
    const note = document.getElementById('rollbackNote');
    if (!canRollback) {
      btn.style.display = 'none';
      note.textContent = 'Rollback requires Manager+.';
      return;
    }
    if (!batch || !batch.completedAt) {
      btn.style.display = 'none';
      note.textContent = '';
      return;
    }
    const completed = new Date(batch.completedAt);
    const msLeft = completed.getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now();
    if (msLeft <= 0) {
      btn.style.display = 'none';
      note.textContent = 'Rollback window expired (7 days).';
      return;
    }
    btn.style.display = 'inline-flex';
    const days = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    note.textContent = '~' + days + ' day(s) left in rollback window.';
  }

  async function refreshBatch(showErr) {
    if (!batch || !batch.id) return;
    const res = await api('GET', '/imports/' + batch.id);
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      if (showErr) toast(problemMessage(res.data, res.status), 'err');
      if (res.status === 404) {
        batch = null;
        setBatchIdInUrl(null);
        applyStatusUi();
      }
      return;
    }
    document.getElementById('featureDisabled').style.display = 'none';
    batch = res.data;
    applyStatusUi();
  }

  async function loadBatch(id) {
    const res = await api('GET', '/imports/' + id);
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      toast(problemMessage(res.data, res.status), 'err');
      batch = null;
      setBatchIdInUrl(null);
      applyStatusUi();
      return;
    }
    document.getElementById('featureDisabled').style.display = 'none';
    batch = res.data;
    setBatchIdInUrl(batch.id);
    applyStatusUi();
  }

  async function downloadTemplate() {
    if (!canImport) {
      toast('Need settings.manage', 'err');
      return;
    }
    const res = await api('GET', '/imports/template.xlsx', undefined, {
      asBlob: true,
      noJson: true,
    });
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function uploadFile() {
    if (!canImport) {
      toast('Need settings.manage', 'err');
      return;
    }
    const input = document.getElementById('fileInput');
    const file = input.files && input.files[0];
    if (!file) {
      toast('Choose a file', 'err');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast('File too large (max 5 MB).', 'err');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    const res = await api('POST', '/imports', undefined, { formData: fd, noJson: true });
    if (!res.ok) {
      if (res.data && res.data.title === 'FEATURE_DISABLED') {
        document.getElementById('featureDisabled').style.display = 'flex';
      }
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    batch = res.data;
    setBatchIdInUrl(batch.id);
    toast('Uploaded — validating…', 'ok');
    applyStatusUi();
  }

  async function saveMapping() {
    if (!batch) return;
    const mapping = readMappingFromForm();
    const res = await api('POST', '/imports/' + batch.id + '/mapping', { mapping });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    batch = res.data;
    toast('Mapping saved — re-validating…', 'ok');
    applyStatusUi();
  }

  async function downloadErrors() {
    if (!batch) return;
    const res = await api('GET', '/imports/' + batch.id + '/errors.csv', undefined, {
      asBlob: true,
      noJson: true,
    });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-errors.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function executeImport() {
    if (!batch) return;
    // Ack only — then poll status (double-execute safe when already importing/completed)
    const res = await api('POST', '/imports/' + batch.id + '/execute');
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      await refreshBatch(false);
      return;
    }
    toast(res.data && res.data.message ? res.data.message : 'Import execution started.', 'ok');
    await refreshBatch(false);
  }

  async function rollback() {
    if (!batch || !canRollback) return;
    if (!confirm('Rollback this completed import? Members without activity will be removed.')) return;
    const res = await api('POST', '/imports/' + batch.id + '/rollback');
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    batch = res.data;
    toast('Rollback completed.', 'ok');
    applyStatusUi();
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  async function scanUnmatchedPlans() {
    if (!batch) return;
    if (!canPlans) {
      toast('Need plans.manage to create missing plans.', 'err');
      return;
    }
    const res = await api('GET', '/imports/' + batch.id + '/errors.csv', undefined, {
      asBlob: true,
      noJson: true,
    });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    const text = await res.blob.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      toast('No error rows in CSV.', 'err');
      return;
    }
    const header = parseCsvLine(lines[0]);
    const idxCodes = header.findIndex((h) => /errorcodes/i.test(h));
    const idxPlan = header.findIndex((h) => /planname/i.test(h));
    const names = new Set();
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const codes = (cols[idxCodes] || '').toUpperCase();
      if (codes.indexOf('PLAN_UNMATCHED') === -1) continue;
      const name = (cols[idxPlan] || '').trim();
      if (name) names.add(name);
    }
    unmatchedPlans = Array.from(names);
    renderPlanSpecs();
    if (!unmatchedPlans.length) {
      toast('No PLAN_UNMATCHED plan names found.', 'err');
    } else {
      toast('Found ' + unmatchedPlans.length + ' unmatched plan name(s).', 'ok');
    }
  }

  function renderPlanSpecs() {
    const wrap = document.getElementById('planSpecs');
    const btn = document.getElementById('btnCreatePlans');
    if (!unmatchedPlans.length) {
      wrap.innerHTML = '';
      btn.style.display = 'none';
      return;
    }
    btn.style.display = canPlans ? 'inline-flex' : 'none';
    wrap.innerHTML = unmatchedPlans
      .map((name, i) => {
        const typeOpts = PLAN_TYPES.map(
          (t) =>
            '<option value="' +
            t +
            '"' +
            (t === 'monthly_unlimited' ? ' selected' : '') +
            '>' +
            t +
            '</option>',
        ).join('');
        return (
          '<div class="plan-spec" data-i="' +
          i +
          '">' +
          '<label>Name<input class="ps-name" value="' +
          esc(name) +
          '"></label>' +
          '<label>Type<select class="ps-type">' +
          typeOpts +
          '</select></label>' +
          '<label>Days<input type="number" class="ps-days" value="30" min="1"></label>' +
          '<label>Price<input type="number" class="ps-price" value="0" min="0" step="0.01"></label>' +
          '</div>'
        );
      })
      .join('');
  }

  async function createPlans() {
    if (!batch || !canPlans) return;
    const specs = [];
    document.querySelectorAll('#planSpecs .plan-spec').forEach((row) => {
      specs.push({
        name: row.querySelector('.ps-name').value.trim(),
        planType: row.querySelector('.ps-type').value,
        durationDays: Number(row.querySelector('.ps-days').value) || 30,
        price: Number(row.querySelector('.ps-price').value) || 0,
      });
    });
    if (!specs.length) {
      toast('No plans to create', 'err');
      return;
    }
    const res = await api('POST', '/imports/' + batch.id + '/create-plans', { plans: specs });
    if (!res.ok) {
      toast(problemMessage(res.data, res.status), 'err');
      return;
    }
    batch = res.data;
    unmatchedPlans = [];
    renderPlanSpecs();
    toast('Plans created — re-validating…', 'ok');
    applyStatusUi();
  }

  function newBatch() {
    stopPoll();
    batch = null;
    unmatchedPlans = [];
    renderPlanSpecs();
    setBatchIdInUrl(null);
    document.getElementById('fileInput').value = '';
    applyStatusUi();
  }

  // Wire events
  document.getElementById('btnTemplate').onclick = downloadTemplate;
  document.getElementById('btnUpload').onclick = uploadFile;
  document.getElementById('btnSaveMapping').onclick = saveMapping;
  document.getElementById('btnErrorsCsv').onclick = downloadErrors;
  document.getElementById('btnErrorsCsvDone').onclick = downloadErrors;
  document.getElementById('btnErrorsCsvFail').onclick = downloadErrors;
  document.getElementById('btnExecute').onclick = executeImport;
  document.getElementById('btnRollback').onclick = rollback;
  document.getElementById('btnScanPlans').onclick = scanUnmatchedPlans;
  document.getElementById('btnCreatePlans').onclick = createPlans;
  document.getElementById('btnNewBatch').onclick = newBatch;

  document.getElementById('fileInput').addEventListener('change', () => {
    const f = document.getElementById('fileInput').files[0];
    const hint = document.getElementById('uploadHint');
    if (!f) {
      hint.textContent = '';
      return;
    }
    const mb = (f.size / (1024 * 1024)).toFixed(2);
    hint.textContent =
      f.name + ' · ' + mb + ' MB' + (f.size > MAX_BYTES ? ' — TOO LARGE (max 5 MB)' : '');
  });

  if (!canImport) {
    toast('Need settings.manage to use imports.', 'err');
  }

  const existing = readBatchIdFromUrl();
  if (existing) loadBatch(existing);
  else applyStatusUi();
})();
