(function () {
  'use strict';

  var CONFIG = {
    brand: {
      name: 'Analytical Admin',
      shortName: 'Analytical Admin',
      tagline: 'Staff area',
      description: 'Staff area for Analytical.',
      company: 'Nexabay Technologies',
      supportEmail: '',
      logoLetter: 'A',
      year: new Date().getFullYear()
    },
    supabase: {
      url: 'https://cdfjlntpxwewtiadkbfn.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkZmpsbnRweHdld3RpYWRrYmZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzExNTAsImV4cCI6MjEwNzkwNzE1MH0.f_q5Tkss9KTdhTnoACxW0DItmWqBkc9WqYG5uBfTv-c'
    },
    mainSiteUrl: 'https://analytical-black.vercel.app',
    region: {
      defaultCountry: 'NG',
      defaultCurrency: 'NGN',
      defaultLocale: 'en',
      supportedCurrencies: ['NGN']
    },
    features: {},
    routes: {
      home: '/index.html',
      login: '/login.html',
      dashboard: '/index.html'
    },
    limits: {
      usernameMin: 3,
      usernameMax: 24,
      passwordMin: 8,
      bioMaxChars: 280,
      avatarMaxMB: 2,
      imageMaxMB: 5
    },
    theme: {
      storageKey: 'analytical-theme'
    }
  };

  CONFIG.formatMoney = function (amount, currency) {
    var code = currency || CONFIG.region.defaultCurrency;
    var value = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(value);
    } catch (e) {
      return code + ' ' + value.toFixed(2);
    }
  };

  CONFIG.isOn = function () { return false; };

  CONFIG.isConfigured = function () {
    var s = CONFIG.supabase;
    return typeof s.url === 'string' && s.url.indexOf('https://') === 0 &&
           typeof s.anonKey === 'string' && s.anonKey.length > 20;
  };

  Object.freeze(CONFIG.brand);
  Object.freeze(CONFIG.supabase);
  Object.freeze(CONFIG.region);
  Object.freeze(CONFIG.features);
  Object.freeze(CONFIG.routes);
  Object.freeze(CONFIG.limits);
  Object.freeze(CONFIG.theme);

  window.APP_CONFIG = Object.freeze(CONFIG);
})();
