/* ==========================================================
   ui.js — toasts, modals, confirm dialogs, loading states,
   tabs, theme switch, mobile menu, user dropdown
   Needs: config.js loaded first. Works with the CSS files.
   ========================================================== */

(function () {
  'use strict';

  const cfg = window.APP_CONFIG;
  const THEME_KEY = cfg && cfg.theme ? cfg.theme.storageKey : 'analytical-theme';
  const DESKTOP_BREAKPOINT = 960;

  /* ---------- Theme ---------- */
  function readSavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch (e) {
      return null;
    }
  }

  function getTheme() {
    const saved = readSavedTheme();
    if (saved) return saved;
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1020' : '#ffffff');

    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  function setTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* storage blocked: the theme still applies for this visit */
    }
    applyTheme(theme);
  }

  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  // Apply immediately so the page does not flash the wrong theme
  applyTheme(getTheme());

  /* ---------- Toasts ---------- */
  function getToastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type, duration) {
    const kind = type || 'info';
    const ms = typeof duration === 'number' ? duration : 4000;

    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;

    const text = document.createElement('span');
    text.textContent = String(message); // textContent keeps user text safe
    el.appendChild(text);

    function remove() {
      if (!el.parentNode) return;
      el.classList.add('leaving');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 250);
    }

    el.addEventListener('click', remove);
    getToastStack().appendChild(el);
    if (ms > 0) setTimeout(remove, ms);
    return remove;
  }

  toast.success = function (message, duration) { return toast(message, 'success', duration); };
  toast.error   = function (message, duration) { return toast(message, 'error', duration || 6000); };
  toast.info    = function (message, duration) { return toast(message, 'info', duration); };

  /* ---------- Modals ---------- */
  let lastFocused = null;

  function resolveModal(target) {
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  function openModal(target) {
    const modal = resolveModal(target);
    if (!modal) return;

    lastFocused = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const focusable = modal.querySelector(
      '[autofocus], input, select, textarea, button:not([data-modal-close]), a[href]'
    ) || modal.querySelector('button');
    if (focusable) setTimeout(function () { focusable.focus(); }, 50);
  }

  function closeModal(target) {
    const modal = resolveModal(target);
    if (!modal || !modal.classList.contains('open')) return;

    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');

    if (!document.querySelector('.modal-backdrop.open')) {
      document.body.style.overflow = '';
    }

    if (typeof modal._onClose === 'function') modal._onClose();

    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  function closeTopModal() {
    const open = document.querySelectorAll('.modal-backdrop.open');
    if (open.length) closeModal(open[open.length - 1]);
  }

  /* ---------- Confirm dialog (returns a Promise) ---------- */
  // Usage: const ok = await UI.confirm({ title, message, confirmText, danger: true });
  function confirmDialog(options) {
    const opts = options || {};

    return new Promise(function (resolve) {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-hidden', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal';

      const head = document.createElement('div');
      head.className = 'modal-head';
      const title = document.createElement('h3');
      title.textContent = opts.title || 'Are you sure?';
      head.appendChild(title);

      const body = document.createElement('div');
      body.className = 'modal-body';
      const message = document.createElement('p');
      message.textContent = opts.message || '';
      body.appendChild(message);

      const foot = document.createElement('div');
      foot.className = 'modal-foot';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = opts.cancelText || 'Cancel';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      okBtn.textContent = opts.confirmText || 'Confirm';

      foot.appendChild(cancelBtn);
      foot.appendChild(okBtn);
      modal.appendChild(head);
      modal.appendChild(body);
      modal.appendChild(foot);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      let finished = false;
      function finish(value) {
        if (finished) return;
        finished = true;
        closeModal(backdrop);
        setTimeout(function () {
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }, 0);
        resolve(value);
      }

      backdrop._onClose = function () { finish(false); }; // ESC or backdrop click = cancel
      cancelBtn.addEventListener('click', function () { finish(false); });
      okBtn.addEventListener('click', function () { finish(true); });

      openModal(backdrop);
      setTimeout(function () { okBtn.focus(); }, 60);
    });
  }

  /* ---------- Button loading state ---------- */
  function setLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle('is-loading', !!isLoading);
    button.disabled = !!isLoading;
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  /* ---------- Mobile drawer ---------- */
  function getDrawer() { return document.querySelector('[data-nav-drawer]'); }
  function getDrawerToggle() { return document.querySelector('[data-nav-toggle]'); }

  function setDrawer(open) {
    const drawer = getDrawer();
    const toggle = getDrawerToggle();
    if (!drawer) return;

    drawer.classList.toggle('open', open);
    document.body.classList.toggle('nav-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }

  function toggleDrawer() {
    const drawer = getDrawer();
    if (!drawer) return;
    setDrawer(!drawer.classList.contains('open'));
  }

  /* ---------- User dropdown ---------- */
  function setUserMenu(open) {
    const menu = document.querySelector('[data-user-menu]');
    const toggle = document.querySelector('[data-user-toggle]');
    if (!menu) return;

    menu.classList.toggle('open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }

  function toggleUserMenu() {
    const menu = document.querySelector('[data-user-menu]');
    if (!menu) return;
    setUserMenu(!menu.classList.contains('open'));
  }

  /* ---------- Tabs ---------- */
  // Markup: <div data-tabs><button class="tab" data-tab="a">..</button></div>
  //         <div class="tab-panel" data-panel="a">..</div>   (panels sit beside the tabs)
  function activateTab(tab) {
    const bar = tab.closest('[data-tabs]');
    if (!bar) return;

    const name = tab.getAttribute('data-tab');
    const root = bar.parentElement;

    bar.querySelectorAll('.tab').forEach(function (t) {
      const active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });

    root.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === name);
    });
  }

  /* ---------- One click handler for the whole page ---------- */
  document.addEventListener('click', function (e) {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const openBtn = target.closest('[data-modal-open]');
    if (openBtn) {
      e.preventDefault();
      openModal(openBtn.getAttribute('data-modal-open'));
      return;
    }

    const closeBtn = target.closest('[data-modal-close]');
    if (closeBtn) {
      closeModal(closeBtn.closest('.modal-backdrop'));
      return;
    }

    if (target.classList.contains('modal-backdrop')) {
      closeModal(target);
      return;
    }

    if (target.closest('[data-theme-toggle]')) {
      toggleTheme();
      return;
    }

    if (target.closest('[data-nav-toggle]')) {
      toggleDrawer();
      return;
    }

    if (target.closest('[data-nav-drawer] a')) {
      setDrawer(false);
    }

    if (target.closest('[data-user-toggle]')) {
      toggleUserMenu();
      return;
    }

    if (!target.closest('[data-user-menu]')) {
      setUserMenu(false);
    }

    const tab = target.closest('[data-tabs] .tab[data-tab]');
    if (tab) activateTab(tab);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeTopModal();
    setDrawer(false);
    setUserMenu(false);
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth >= DESKTOP_BREAKPOINT) setDrawer(false);
  });

  // Follow the device theme live, but only when the user has not chosen one
  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () {
      if (!readSavedTheme()) applyTheme(getTheme());
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(getTheme()); // refresh toggle labels once the page exists
  });

  /* ---------- Public API ---------- */
  window.UI = Object.freeze({
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    confirm: confirmDialog,
    setLoading: setLoading,
    getTheme: getTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    refreshTheme: function () { applyTheme(getTheme()); },
    closeDrawer: function () { setDrawer(false); },
    closeUserMenu: function () { setUserMenu(false); }
  });
})();