const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const STATIC_ROOT = path.join(__dirname, 'src', 'app');
const DASH_ROOT = path.join(STATIC_ROOT, '(dashboard)');
const SHARED_ROOT = path.join(STATIC_ROOT, 'shared');
const SHARED_SCRIPTS = [
  '/shared/api-config.js',
  '/shared/api-client.js',
  '/shared/authz.js',
  '/shared/features.js?v=3',
  '/shared/i18n.js',
  '/shared/nav.js',
  '/shared/inventory-api.js',
  '/shared/member-orders-api.js',
  '/shared/gfp-branding.js?v=4',
  '/shared/shell.js?v=6',
];

const SHARED_STYLES = ['/shared/rtl.css'];

function sharedScriptTags() {
  return SHARED_SCRIPTS.map((src) => `<script src="${src}"></script>`).join('\n') + '\n';
}

function hasScriptSrc(html, src) {
  // Must match a real <script src="..."> tag — not comments / console.error text that
  // mention the same path (login page cites api-client.js in comments and blocked injection).
  const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('<script[^>]+src=["\']' + esc + '["\']', 'i').test(html);
}

function hasStylesheetHref(html, href) {
  const esc = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('<link[^>]+href=["\']' + esc + '["\']', 'i').test(html);
}

function sendHtml(res, filePath) {
  let html = fs.readFileSync(filePath, 'utf8');

  const missingCss = SHARED_STYLES.filter((href) => !hasStylesheetHref(html, href));
  const missingJs = SHARED_SCRIPTS.filter((src) => !hasScriptSrc(html, src));
  const needEarly = !html.includes('data-gfp-early-locale');

  const parts = [];
  if (needEarly) {
    parts.push(
      '<script data-gfp-early-locale>(function(){try{var l=localStorage.getItem("gfp_locale");if(l!=="ar"&&l!=="en")l="en";var h=document.documentElement;h.lang=l;h.dir=l==="ar"?"rtl":"ltr";var u=JSON.parse(localStorage.getItem("gfp_user")||"null");var tid=u&&(u.tenantId||u.TenantId);var raw=tid&&localStorage.getItem("gfp_branding:"+tid);if(!raw)raw=localStorage.getItem("gfp_branding");if(!raw)return;var b=JSON.parse(raw);var p=b.primaryColor||b.PrimaryColor||"#7ACC00";var a=b.accentColor||b.AccentColor||"#A0E040";h.style.setProperty("--gfp-brand-primary",p);h.style.setProperty("--gfp-brand-accent",a);h.style.setProperty("--l500",p);h.style.setProperty("--l400",a);h.style.setProperty("--l600",p);h.style.setProperty("--l300",a);}catch(e){}})();</script>'
    );
  }
  missingCss.forEach((href) => parts.push(`<link rel="stylesheet" href="${href}">`));
  missingJs.forEach((src) => parts.push(`<script src="${src}"></script>`));

  if (parts.length) {
    const inject = parts.join('\n') + '\n';
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + inject);
    } else {
      html = inject + html;
    }
  }
  res.type('html').send(html);
}

// ── CORS ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Expose-Headers', 'Token-Expired');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Shared assets (api-config, etc.) ──
app.get('/shared/:file', (req, res) => {
  const f = path.join(SHARED_ROOT, path.basename(req.params.file));
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.sendFile(f);
    return;
  }
  res.status(404).end();
});

// ── / → redirect ──
app.get('/', (req, res) => res.redirect('/dashboard/'));

// ── All routing via middleware ──
app.use((req, res, next) => {
  const url = decodeURIComponent(req.path);

  // -- AUTH --
  if (url === '/auth/login' || url === '/auth/login/') {
    const f = path.join(STATIC_ROOT, 'auth', 'login', 'index.html');
    if (fs.existsSync(f)) {
      sendHtml(res, f);
      return;
    }
  }
  if (url.startsWith('/auth/')) {
    const rel = url.slice(6).replace(/\/+$/, ''); // strip '/auth/' and trailing slash
    // Exact file
    const f = path.join(STATIC_ROOT, 'auth', rel);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      if (f.endsWith('.html')) sendHtml(res, f);
      else res.sendFile(f);
      return;
    }
    // Directory → index.html (/auth/member-otp/ → auth/member-otp/index.html)
    const idx = path.join(STATIC_ROOT, 'auth', rel, 'index.html');
    if (fs.existsSync(idx)) {
      if (!url.endsWith('/')) {
        const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(301, '/auth/' + rel + '/' + q);
        return;
      }
      sendHtml(res, idx);
      return;
    }
  }

  // -- DASHBOARD --
  if (url.startsWith('/dashboard')) {
    const sub = url.replace(/^\/dashboard\/?/, '').replace(/\/+$/, '');

    // Root
    if (!sub) {
      // Prefer trailing slash so relative CSS/JS under /dashboard/ resolve correctly
      if (url === '/dashboard') {
        res.redirect(301, '/dashboard/');
        return;
      }
      const f = path.join(DASH_ROOT, 'index.html');
      if (fs.existsSync(f)) {
        sendHtml(res, f);
        return;
      }
    }

    // Exact file (CSS, JS, images)
    const exact = path.join(DASH_ROOT, sub);
    if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
      if (exact.endsWith('.html')) sendHtml(res, exact);
      else res.sendFile(exact);
      return;
    }

    // Directory → index.html
    const idx = path.join(DASH_ROOT, sub, 'index.html');
    if (fs.existsSync(idx)) {
      // /dashboard/settings (no slash) breaks relative href="settings.css" → /dashboard/settings.css
      if (!url.endsWith('/')) {
        const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(301, '/dashboard/' + sub + '/' + q);
        return;
      }
      sendHtml(res, idx);
      return;
    }

    // Dynamic: /dashboard/members/abc → (dashboard)/members/[id]/index.html
    const parts = sub.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const parent = parts.slice(0, -1).join(path.sep);
      const dynIdx = path.join(DASH_ROOT, parent, '[id]', 'index.html');
      if (fs.existsSync(dynIdx)) {
        sendHtml(res, dynIdx);
        return;
      }

      // Asset in [id] folder
      const file = parts[parts.length - 1];
      const dynAsset = path.join(DASH_ROOT, parent, '[id]', file);
      if (fs.existsSync(dynAsset) && fs.statSync(dynAsset).isFile()) {
        res.sendFile(dynAsset);
        return;
      }
    }

    // 3-level: /dashboard/members/abc/style.css → (dashboard)/members/[id]/style.css
    if (parts.length >= 3) {
      const gp = parts.slice(0, -2).join(path.sep);
      const file = parts[parts.length - 1];
      const dynAsset = path.join(DASH_ROOT, gp, '[id]', file);
      if (fs.existsSync(dynAsset) && fs.statSync(dynAsset).isFile()) {
        res.sendFile(dynAsset);
        return;
      }
    }
  }

  next();
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).send(`<!DOCTYPE html><html><head><title>404</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0D0D0D;color:#F0F0F0}
.c{text-align:center}.c h1{font-size:72px;color:#7ACC00;margin:0}.c p{color:#888;margin:8px 0 24px}
.c a{padding:10px 24px;background:#7ACC00;color:#0D0D0D;text-decoration:none;border-radius:8px;font-weight:700}</style>
</head><body><div class="c"><h1>404</h1><p>${req.originalUrl} not found</p><a href="/dashboard/">← Dashboard</a></div></body></html>`);
});

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║           GymFlowPro Dev Server                ║
  ╠═══════════════════════════════════════════════╣
  ║  Local:  http://localhost:${PORT}                  ║
  ║  Login:  http://localhost:${PORT}/auth/login/      ║
  ║  Admin:  http://localhost:${PORT}/dashboard/       ║
  ║  API:    https://reach-lullaby-tighten.ngrok-free.dev/api  ║
  ╚═══════════════════════════════════════════════╝
  `);
});
