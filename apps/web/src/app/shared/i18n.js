/**
 * GymFlowPro — bilingual messages (message / messageAr) + full-page RTL locale toggle.
 * html[dir=rtl|ltr] drives shared/rtl.css for the entire page (not sidebar-only).
 */
(function (global) {
  'use strict';

  var LOCALE_KEY = 'gfp_locale';

  function getLocale() {
    var v = global.localStorage.getItem(LOCALE_KEY);
    return v === 'ar' ? 'ar' : 'en';
  }

  function setLocale(locale) {
    locale = locale === 'ar' ? 'ar' : 'en';
    global.localStorage.setItem(LOCALE_KEY, locale);
    applyDocumentLocale(locale);
    try {
      global.dispatchEvent(new CustomEvent('gfp:locale', { detail: { locale: locale } }));
    } catch (e) { /* ignore */ }
    return locale;
  }

  /**
   * Flip the whole document. Pages must not hardcode dir="ltr" as permanent —
   * this overwrites html.lang / html.dir on every load and toggle.
   */
  function applyDocumentLocale(locale) {
    locale = locale || getLocale();
    var html = global.document && global.document.documentElement;
    if (!html) return;
    html.lang = locale;
    html.dir = locale === 'ar' ? 'rtl' : 'ltr';
    html.setAttribute('data-locale', locale);
    if (global.document.body) {
      global.document.body.classList.toggle('gfp-rtl', locale === 'ar');
      global.document.body.classList.toggle('gfp-ltr', locale !== 'ar');
    }
    applyDataLocaleAttributes(locale);
  }

  /**
   * Elements with data-en / data-ar swap visible text on locale change.
   * Optional data-en-title / data-ar-title for title/placeholder/aria-label.
   */
  function applyDataLocaleAttributes(locale) {
    locale = locale || getLocale();
    var root = global.document;
    if (!root || !root.querySelectorAll) return;

    root.querySelectorAll('[data-en],[data-ar]').forEach(function (el) {
      var en = el.getAttribute('data-en');
      var ar = el.getAttribute('data-ar');
      var text = locale === 'ar' ? ar || en : en || ar;
      if (text == null) return;
      // Prefer updating a dedicated label child; else textContent if no nested controls
      var label = el.querySelector('[data-i18n-text]');
      if (label) {
        label.textContent = text;
      } else if (!el.querySelector('input,select,textarea,button,a,i,svg,img')) {
        el.textContent = text;
      } else if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
        el.textContent = text;
      }
    });

    root.querySelectorAll('[data-en-title],[data-ar-title]').forEach(function (el) {
      var en = el.getAttribute('data-en-title');
      var ar = el.getAttribute('data-ar-title');
      var t = locale === 'ar' ? ar || en : en || ar;
      if (t != null) el.setAttribute('title', t);
    });

    root.querySelectorAll('[data-en-placeholder],[data-ar-placeholder]').forEach(function (el) {
      var en = el.getAttribute('data-en-placeholder');
      var ar = el.getAttribute('data-ar-placeholder');
      var t = locale === 'ar' ? ar || en : en || ar;
      if (t != null) el.setAttribute('placeholder', t);
    });
  }

  function pickBilingual(message, messageAr, locale) {
    locale = locale || getLocale();
    var en = String(message || '').trim();
    var ar = String(messageAr || '').trim();
    if (en || ar) {
      if (locale === 'ar') return ar || en;
      return en || ar;
    }
    return '';
  }

  function splitSlashBilingual(combined) {
    var raw = String(combined || '').trim();
    if (!raw) return { message: '', messageAr: '' };
    var idx = raw.indexOf(' / ');
    if (idx === -1) return { message: raw, messageAr: raw };
    return {
      message: raw.slice(0, idx).trim(),
      messageAr: raw.slice(idx + 3).trim()
    };
  }

  function displayBilingualText(input, locale) {
    locale = locale || getLocale();
    if (input == null) return '';
    if (typeof input === 'string') {
      var parts = splitSlashBilingual(input);
      return pickBilingual(parts.message, parts.messageAr, locale);
    }
    if (input.message != null || input.messageAr != null) {
      return pickBilingual(input.message, input.messageAr, locale);
    }
    if (input.detail) {
      var p2 = splitSlashBilingual(input.detail);
      return pickBilingual(p2.message, p2.messageAr, locale);
    }
    if (input.error && typeof input.error === 'object') {
      return displayBilingualText(input.error, locale);
    }
    return '';
  }

  /** Prefer message/messageAr from API result envelopes; else parsed error / detail slash-split. */
  function displayApiError(resultOrError, locale) {
    locale = locale || getLocale();
    if (!resultOrError) return '';

    function fromObj(obj) {
      if (!obj || typeof obj !== 'object') return '';
      if (obj.message != null || obj.messageAr != null) {
        var picked = pickBilingual(obj.message, obj.messageAr, locale);
        if (obj.messageAr == null || String(obj.messageAr).trim() === '') {
          var parts = splitSlashBilingual(obj.message);
          if (parts.messageAr && parts.messageAr !== parts.message) {
            return pickBilingual(parts.message, parts.messageAr, locale);
          }
        }
        return picked;
      }
      if (obj.detail) {
        var p2 = splitSlashBilingual(obj.detail);
        return pickBilingual(p2.message, p2.messageAr, locale);
      }
      return '';
    }

    if (resultOrError.error) {
      var fromErr = fromObj(resultOrError.error);
      if (fromErr) return fromErr;
    }
    if (resultOrError.data) {
      var fromData = fromObj(resultOrError.data);
      if (fromData) return fromData;
    }
    var direct = fromObj(resultOrError);
    if (direct) return direct;
    if (typeof resultOrError === 'string') {
      return displayBilingualText(resultOrError, locale);
    }
    return '';
  }

  function tLabel(en, ar, locale) {
    return pickBilingual(en, ar, locale || getLocale());
  }

  function toggleLocale() {
    return setLocale(getLocale() === 'ar' ? 'en' : 'ar');
  }

  function isRtl() {
    return getLocale() === 'ar';
  }

  // Apply early so first paint matches stored locale (also set by early head script)
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () {
        applyDocumentLocale();
      });
    } else {
      applyDocumentLocale();
    }
  }

  global.GfpI18n = {
    getLocale: getLocale,
    setLocale: setLocale,
    toggleLocale: toggleLocale,
    applyDocumentLocale: applyDocumentLocale,
    applyDataLocaleAttributes: applyDataLocaleAttributes,
    pickBilingual: pickBilingual,
    splitSlashBilingual: splitSlashBilingual,
    displayBilingualText: displayBilingualText,
    displayApiError: displayApiError,
    tLabel: tLabel,
    isRtl: isRtl
  };
})(typeof window !== 'undefined' ? window : globalThis);
