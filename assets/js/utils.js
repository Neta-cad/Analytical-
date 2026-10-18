/* ==========================================================
   utils.js — small helpers used across the whole site
   Needs: config.js loaded first.
   ========================================================== */

(function () {
  'use strict';

  const cfg = window.APP_CONFIG;
  const limits = cfg && cfg.limits ? cfg.limits : {
    usernameMin: 3,
    usernameMax: 24,
    passwordMin: 8,
    bioMaxChars: 280,
    avatarMaxMB: 2,
    imageMaxMB: 5
  };

  /* ---------- Safe text ---------- */
  // Always run user-written text through this before putting it inside HTML.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(text, max) {
    const s = String(text == null ? '' : text);
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0].charAt(0);
    const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  /* ---------- Numbers ---------- */
  function formatNumber(value) {
    const n = Number(value) || 0;
    try {
      return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    } catch (e) {
      return String(n);
    }
  }

  /* ---------- Dates ---------- */
  function toDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value) {
    const d = toDate(value);
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
    } catch (e) {
      return d.toDateString();
    }
  }

  function timeAgo(value) {
    const d = toDate(value);
    if (!d) return '';

    const seconds = Math.round((d.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);

    const steps = [
      ['year', 31536000],
      ['month', 2592000],
      ['week', 604800],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60]
    ];

    try {
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      if (abs < 45) return rtf.format(0, 'second');
      for (let i = 0; i < steps.length; i++) {
        const unit = steps[i][0];
        const size = steps[i][1];
        if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
      }
      return rtf.format(Math.round(seconds / 60), 'minute');
    } catch (e) {
      return formatDate(d);
    }
  }

  /* ---------- Timing ---------- */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait || 300);
    };
  }

  function throttle(fn, wait) {
    let last = 0;
    return function () {
      const now = Date.now();
      if (now - last >= (wait || 200)) {
        last = now;
        fn.apply(this, arguments);
      }
    };
  }

  /* ---------- URLs and navigation ---------- */
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  // Only allow redirects to pages on this same site (blocks open-redirect tricks).
  function safeRedirectPath(path, fallback) {
    const backup = fallback || '/index.html';
    if (typeof path !== 'string' || !path) return backup;
    if (path.charAt(0) !== '/') return backup;
    if (path.charAt(1) === '/' || path.charAt(1) === '\\') return backup;
    if (/[\r\n]/.test(path)) return backup;
    return path;
  }

  // Accepts only http and https links. Returns '' for anything else.
  function safeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (e) {
      return '';
    }
  }

  /* ---------- Validation ---------- */
  // Each validator returns an error message, or '' when the value is fine.
  const validate = {
    email: function (value) {
      const v = String(value || '').trim();
      if (!v) return 'Enter your email address.';
      if (v.length > 254) return 'That email address is too long.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Enter a valid email address.';
      return '';
    },

    username: function (value) {
      const v = String(value || '').trim();
      if (!v) return 'Choose a username.';
      if (v.length < limits.usernameMin) return 'Username must be at least ' + limits.usernameMin + ' characters.';
      if (v.length > limits.usernameMax) return 'Username must be at most ' + limits.usernameMax + ' characters.';
      if (!/^[a-z0-9_]+$/.test(v)) return 'Use only lowercase letters, numbers and underscores.';
      return '';
    },

    password: function (value) {
      const v = String(value || '');
      if (!v) return 'Enter a password.';
      if (v.length < limits.passwordMin) return 'Password must be at least ' + limits.passwordMin + ' characters.';
      if (v.length > 72) return 'Password must be 72 characters or fewer.';
      if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return 'Use at least one letter and one number.';
      return '';
    },

    fullName: function (value) {
      const v = String(value || '').trim();
      if (!v) return 'Enter your full name.';
      if (v.length < 2) return 'Name is too short.';
      if (v.length > 80) return 'Name must be 80 characters or fewer.';
      return '';
    },

    bio: function (value) {
      const v = String(value || '');
      if (v.length > limits.bioMaxChars) return 'Bio must be ' + limits.bioMaxChars + ' characters or fewer.';
      return '';
    },

    optionalUrl: function (value) {
      const v = String(value || '').trim();
      if (!v) return '';
      return safeUrl(v) ? '' : 'Enter a full link starting with https://';
    },

    imageFile: function (file, maxMB) {
      if (!file) return 'Choose an image.';
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowed.indexOf(file.type) === -1) return 'Use a JPG, PNG or WebP image.';
      const cap = (typeof maxMB === 'number' ? maxMB : limits.imageMaxMB) * 1024 * 1024;
      if (file.size > cap) return 'Image must be smaller than ' + (cap / 1048576) + ' MB.';
      return '';
    }
  };

  /* ---------- Inline form errors ---------- */
  // Puts a message under a field. Pass '' to clear it.
  // The field needs an id, and a following element: <p class="form-error" id="<id>-error"></p>
  function showFieldError(input, message) {
    if (!input) return;
    const errorEl = document.getElementById(input.id + '-error');
    const hasError = !!message;

    input.classList.toggle('is-invalid', hasError);
    input.setAttribute('aria-invalid', hasError ? 'true' : 'false');

    if (errorEl) {
      errorEl.textContent = message || '';
      errorEl.classList.toggle('hidden', !hasError);
    }
  }

  /* ---------- Countries ---------- */
  const COUNTRY_CODES = (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
    'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
    'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
    'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
    'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
    'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' ');

  function countryName(code) {
    if (!code) return '';
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
    } catch (e) {
      return code;
    }
  }

  // Returns [{ code: 'NG', name: 'Nigeria' }, ...] sorted by name.
  function getCountries() {
    return COUNTRY_CODES
      .map(function (code) { return { code: code, name: countryName(code) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // Fills a <select> with every country.
  function fillCountrySelect(select, selectedCode) {
    if (!select) return;
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select your country';
    select.appendChild(placeholder);

    getCountries().forEach(function (c) {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.name;
      if (c.code === selectedCode) opt.selected = true;
      select.appendChild(opt);
    });
  }

  /* ---------- Clipboard ---------- */
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      /* fall through to the older method */
    }

    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Public API ---------- */
  window.Utils = Object.freeze({
    escapeHtml: escapeHtml,
    truncate: truncate,
    initials: initials,
    slugify: slugify,
    formatNumber: formatNumber,
    formatDate: formatDate,
    timeAgo: timeAgo,
    debounce: debounce,
    throttle: throttle,
    getParam: getParam,
    safeRedirectPath: safeRedirectPath,
    safeUrl: safeUrl,
    validate: validate,
    showFieldError: showFieldError,
    getCountries: getCountries,
    countryName: countryName,
    fillCountrySelect: fillCountrySelect,
    copyText: copyText
  });
})();