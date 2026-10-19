/* ==========================================================
   config.js — one place for brand, region and app settings
   Load this FIRST, before every other script.
   ========================================================== */

(function () {
  'use strict';

  const CONFIG = {
    /* ---------- Brand ---------- */
    brand: {
      name: 'Analytical',
      shortName: 'Analytical',
      tagline: "Where the world's tech people build, learn and earn.",
      description:
        'Analytical is a global home for coders, data analysts, data scientists and tech creators to sell projects, find jobs, learn, and solve problems together.',
      company: 'Nexabay Technologies',
      supportEmail: 'supportanalytical@gmail.com',
      logoLetter: 'A',
      year: new Date().getFullYear()
    },

    /* ---------- Supabase ----------
       Get both values from: Supabase dashboard > Project Settings > API.
       The anon key is safe in the browser ONLY because row-level security
       protects your data. NEVER paste the service_role key here. */
    supabase: {
      url: 'https://cdfjlntpxwewtiadkbfn.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkZmpsbnRweHdld3RpYWRrYmZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzExNTAsImV4cCI6MjEwNzkwNzE1MH0.f_q5Tkss9KTdhTnoACxW0DItmWqBkc9WqYG5uBfTv-c'
    },

    /* ---------- Region and currency ----------
       Global from day one: nothing in the app should assume one country. */
    region: {
      defaultCountry: 'NG',
      defaultCurrency: 'NGN',
      defaultLocale: 'en',
      supportedCurrencies: ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR']
    },

    /* ---------- Feature switches ----------
       A module is switched on only when it is fully built and working.
       Switched-off modules are hidden from nav, footer and search. */
    features: {
      auth: true,
      profiles: true,
      search: true,
      marketplace: false,
      jobs: false,
      qa: false,
      learn: false,
      community: false,
      data: true,
      wallet: false
    },

    /* ---------- Page paths ---------- */
    routes: {
      home: '/index.html',
      login: '/pages/auth/login.html',
      register: '/pages/auth/register.html',
      forgot: '/pages/auth/forgot.html',
      reset: '/pages/auth/reset.html',
      dashboard: '/pages/dashboard/index.html',
      profile: '/pages/profile/view.html',
      profileEdit: '/pages/profile/edit.html',
      search: '/pages/search.html'
    },

    /* ---------- App limits ---------- */
    limits: {
      avatarMaxMB: 2,
      imageMaxMB: 5,
      bioMaxChars: 280,
      usernameMin: 3,
      usernameMax: 24,
      passwordMin: 8
    },

    /* ---------- Theme ---------- */
    theme: {
      storageKey: 'analytical-theme'
    }
  };

  /* ---------- Helpers ---------- */

  // Money formatting that works for any currency and locale.
  CONFIG.formatMoney = function (amount, currency) {
    const code = currency || CONFIG.region.defaultCurrency;
    const value = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 2
      }).format(value);
    } catch (e) {
      return code + ' ' + value.toFixed(2);
    }
  };

  // True when a feature module is switched on.
  CONFIG.isOn = function (featureName) {
    return CONFIG.features[featureName] === true;
  };

  // True when the Supabase values have been filled in.
  CONFIG.isConfigured = function () {
    const s = CONFIG.supabase;
    return (
      typeof s.url === 'string' &&
      typeof s.anonKey === 'string' &&
      s.url.indexOf('REPLACE_') === -1 &&
      s.anonKey.indexOf('REPLACE_') === -1
    );
  };

  // Freeze so no script can change settings by accident.
  Object.freeze(CONFIG.brand);
  Object.freeze(CONFIG.supabase);
  Object.freeze(CONFIG.region);
  Object.freeze(CONFIG.features);
  Object.freeze(CONFIG.routes);
  Object.freeze(CONFIG.limits);
  Object.freeze(CONFIG.theme);

  window.APP_CONFIG = Object.freeze(CONFIG);
})();