/**
 * @gymflowpro/i18n — Node-safe entry (no JSON import attributes).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en.json'), 'utf8'));
const ar = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/ar.json'), 'utf8'));

/** @typedef {'en'|'ar'} Locale */

const catalogs = { en, ar };

function applyPlural(template, params) {
  return template.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
    (_, name, one, other) => {
      const n = Number(params[name] ?? 0);
      const branch = n === 1 ? one : other;
      return branch.replace(/#/g, String(n));
    },
  );
}

function interpolate(template, params) {
  if (!params) return template;
  let out = applyPlural(template, params);
  return out.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] != null ? String(params[key]) : `{${key}}`,
  );
}

export function t(key, params, locale = 'en', opts = {}) {
  const mode = opts.missingKey || 'fallback';
  const primary = catalogs[locale] || catalogs.en;
  const fallback = catalogs.en;
  let template = primary[key];
  if (template == null) template = fallback[key];
  if (template == null) {
    if (mode === 'throw') throw new Error(`Missing i18n key: ${key}`);
    if (mode === 'key') return key;
    return key;
  }
  return interpolate(String(template), params);
}

export function hasKey(key) {
  return Object.prototype.hasOwnProperty.call(catalogs.en, key)
    || Object.prototype.hasOwnProperty.call(catalogs.ar, key);
}

export function listKeys() {
  return [...new Set([...Object.keys(catalogs.en), ...Object.keys(catalogs.ar)])].sort();
}

export function pickBilingual(message, messageAr, locale) {
  const enStr = String(message ?? '').trim();
  const arStr = String(messageAr ?? '').trim();
  if (enStr || arStr) {
    if (locale === 'ar') return arStr || enStr;
    return enStr || arStr;
  }
  return '';
}

export function splitSlashBilingual(combined) {
  const raw = String(combined ?? '').trim();
  if (!raw) return { message: '', messageAr: '' };
  const idx = raw.indexOf(' / ');
  if (idx === -1) return { message: raw, messageAr: raw };
  return {
    message: raw.slice(0, idx).trim(),
    messageAr: raw.slice(idx + 3).trim(),
  };
}

export function displayBilingualText(input, locale) {
  if (input == null) return '';
  if (typeof input === 'string') {
    const parts = splitSlashBilingual(input);
    return pickBilingual(parts.message, parts.messageAr, locale);
  }
  if (input.message != null || input.messageAr != null) {
    return pickBilingual(input.message, input.messageAr, locale);
  }
  if (input.detail) {
    const parts = splitSlashBilingual(input.detail);
    return pickBilingual(parts.message, parts.messageAr, locale);
  }
  return '';
}

export function tLabel(enStr, arStr, locale) {
  return pickBilingual(enStr, arStr, locale);
}

const STATUS_KEY = {
  active: 'status.active',
  expired: 'status.expired',
  pending: 'status.pending',
  frozen: 'status.frozen',
  cancelled: 'status.cancelled',
  canceled: 'status.cancelled',
  completed: 'status.completed',
  refunded: 'status.refunded',
  failed: 'status.failed',
  draft: 'status.draft',
  accepted: 'status.accepted',
  ready: 'status.ready',
  rejected: 'status.rejected',
  open: 'status.open',
  closed: 'status.closed',
  trialing: 'status.trialing',
  past_due: 'status.past_due',
  suspended: 'status.suspended',
  none: 'membership.none',
};

export function statusLabel(code, locale = 'en') {
  const key = STATUS_KEY[String(code || '').toLowerCase()];
  if (!key) return String(code || '');
  return t(key, undefined, locale);
}

export function formatMoney(amount, locale = 'en') {
  const n = Number(amount);
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return t('format.currency', { amount: formatted }, locale);
}

export function formatNumber(value, locale = 'en', opts = {}) {
  const n = Number(value);
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', opts).format(
    Number.isFinite(n) ? n : 0,
  );
}

export function formatDate(isoOrDate, locale = 'en') {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function formatDateTime(isoOrDate, locale = 'en') {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export { catalogs };
export default {
  t,
  hasKey,
  listKeys,
  pickBilingual,
  splitSlashBilingual,
  displayBilingualText,
  tLabel,
  statusLabel,
  formatMoney,
  formatNumber,
  formatDate,
  formatDateTime,
  catalogs,
};
