/* ==========================================================
   components.js — loads the shared nav and footer into a page
   and wires them up.
   Needs: config.js, ui.js and auth.js loaded first.
   ========================================================== */

(function () {
  'use strict';

  const cfg = window.APP_CONFIG;

  if (!cfg) {
    console.error('[Analytical] components.js needs config.js to load first.');
    return;
  }

  const COMPONENT_PATHS = {
    nav: '/components/nav.html',
    footer: '/components/footer.html'
  };

  /* ---------- Layout fix ----------
     The nav is sticky. A sticky element only sticks inside its parent,
     so the placeholder wrappers must not create a box of their own. */
  function injectLayoutStyle() {
    if (document.getElementById('components-layout-style')) return;
    const style = document.createElement('style');
    style.id = 'components-layout-style';
    style.textContent = '[data-component]{display:contents;}';
    document.head.appendChild(style);
  }

  /* ---------- Load one component ---------- */
  async function loadComponent(slot) {
    const name = slot.getAttribute('data-component');
    const path = COMPONENT_PATHS[name];

    if (!path) {
      console.error('[Analytical] Unknown component:', name);
      return;
    }

    try {
      const response = await fetch(path, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      slot.innerHTML = await response.text();
    } catch (error) {
      console.error('[Analytical] Could not load ' + path + ':', error);
    }
  }

  /* ---------- Brand text ---------- */
  function fillBrand() {
    const brand = cfg.brand;

    document.querySelectorAll('[data-brand-name]').forEach(function (el) {
      el.textContent = brand.name;
    });
    document.querySelectorAll('[data-brand-letter]').forEach(function (el) {
      el.textContent = brand.logoLetter;
    });
    document.querySelectorAll('[data-brand-tagline]').forEach(function (el) {
      el.textContent = brand.tagline;
    });
    document.querySelectorAll('[data-company]').forEach(function (el) {
      el.textContent = brand.company;
    });
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(brand.year);
    });
  }

  /* ---------- Hide links to switched-off modules ---------- */
  function applyFeatureFlags() {
    document.querySelectorAll('[data-feature]').forEach(function (el) {
      const feature = el.getAttribute('data-feature');
      el.classList.toggle('hidden', !cfg.isOn(feature));
    });

    // Hide a whole group when every feature link inside it is hidden
    document.querySelectorAll('[data-feature-group]').forEach(function (group) {
      const items = group.querySelectorAll('[data-feature]');
      if (!items.length) return;

      let anyVisible = false;
      items.forEach(function (item) {
        if (!item.classList.contains('hidden')) anyVisible = true;
      });
      group.classList.toggle('hidden', !anyVisible);
    });
  }

  /* ---------- Mark the current page in the nav ---------- */
  function normalizePath(path) {
    let p = String(path || '/');
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    if (p === '/index.html') p = '/';
    return p;
  }

  function markActiveLinks() {
    const current = normalizePath(window.location.pathname);

    document.querySelectorAll('.site-nav .nav-link, [data-nav-drawer] .nav-link').forEach(function (link) {
      let linkPath;
      try {
        linkPath = normalizePath(new URL(link.getAttribute('href'), window.location.origin).pathname);
      } catch (e) {
        return;
      }

      // Same page, or another page inside the same module folder
      const linkDir = linkPath.slice(0, linkPath.lastIndexOf('/') + 1);
      const sameModule = linkDir !== '/' && (current + '/').indexOf(linkDir) === 0;
      const active = current === linkPath || sameModule;

      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  /* ---------- Skip link for keyboard and screen reader users ---------- */
  function addSkipLink() {
    if (document.querySelector('.skip-link')) return;
    if (!document.getElementById('main')) return;

    const link = document.createElement('a');
    link.className = 'skip-link';
    link.href = '#main';
    link.textContent = 'Skip to content';
    document.body.insertBefore(link, document.body.firstChild);
  }

  /* ---------- Run everything ---------- */
  async function init() {
    injectLayoutStyle();

    const slots = Array.prototype.slice.call(document.querySelectorAll('[data-component]'));
    await Promise.all(slots.map(loadComponent));

    fillBrand();
    applyFeatureFlags();
    markActiveLinks();
    addSkipLink();

    if (window.UI && typeof window.UI.refreshTheme === 'function') {
      window.UI.refreshTheme();
    }

    if (window.Auth && typeof window.Auth.refreshNav === 'function') {
      await window.Auth.refreshNav();
    }

    document.dispatchEvent(new CustomEvent('components:ready'));
  }

  const ready = new Promise(function (resolve) {
    function start() {
      init().then(resolve).catch(function (error) {
        console.error('[Analytical] components init failed:', error);
        resolve();
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  });

  /* ---------- Public API ---------- */
  window.Components = Object.freeze({
    ready: ready
  });
})();