/* ==========================================================
   admin.js — staff guard and helpers for the admin site.
   Needs (loaded first): config.js, supabase.js, ui.js, utils.js, components.js
   ========================================================== */

(function () {
  'use strict';

  var cfg = window.APP_CONFIG;
  var sb = window.sb;
  var helpers = window.sbHelpers;

  if (!cfg || !sb || !helpers) {
    console.error('[Analytical Admin] admin.js needs config.js and supabase.js to load first.');
    return;
  }

  var STAFF_ROLES = ['admin', 'moderator'];
  var ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator' };

  function mkEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  // Messages raised by our own database rules are already written for people
  function message(error) {
    if (error && error.code === 'P0001') return error.message;
    return helpers.friendlyError(error);
  }

  // A missing column, table or function means a database file has not been run
  function isMissingSetup(error) {
    var t = String((error && error.message) || '').toLowerCase();
    return !!error && (
      error.code === '42703' ||
      error.code === '42P01' ||
      error.code === 'PGRST202' ||
      error.code === 'PGRST204' ||
      error.code === 'PGRST205' ||
      t.indexOf('does not exist') !== -1 ||
      t.indexOf('could not find') !== -1 ||
      t.indexOf('schema cache') !== -1
    );
  }

  /* ---------- Who is signed in, and are they staff? ---------- */
  async function check() {
    var session = await helpers.getSession();
    if (!session) return { state: 'login' };

    var result = await sb
      .from('profiles')
      .select('id, username, full_name, user_role, is_suspended')
      .eq('id', session.user.id)
      .maybeSingle();

    if (result.error) return { state: 'error', error: result.error };
    if (!result.data) return { state: 'error', error: null };

    var profile = result.data;

    if (profile.is_suspended || STAFF_ROLES.indexOf(profile.user_role) === -1) {
      return { state: 'denied', user: session.user, profile: profile };
    }

    return { state: 'ok', user: session.user, profile: profile };
  }

  /* ---------- Replace the page content with a message ---------- */
  function showPanel(title, text, options) {
    var opts = options || {};
    var main = document.getElementById('main');
    if (!main) return;

    main.innerHTML = '';

    var wrap = mkEl('div', 'container');
    wrap.style.paddingBlock = 'var(--sp-12)';

    var box = mkEl('div', 'empty-state');
    box.appendChild(mkEl('h2', null, title));
    box.appendChild(mkEl('p', null, text));

    if (opts.signOut) {
      var out = mkEl('button', 'btn btn-primary', 'Sign out');
      out.type = 'button';
      out.setAttribute('data-logout', '');
      box.appendChild(out);
    }

    if (opts.retry) {
      var retry = mkEl('button', 'btn btn-primary', 'Refresh');
      retry.type = 'button';
      retry.addEventListener('click', function () { window.location.reload(); });
      box.appendChild(retry);
    }

    wrap.appendChild(box);
    main.appendChild(wrap);
  }

  /* ---------- Fill the nav with the staff member ---------- */
  function fillNav(profile) {
    var name = profile.full_name || profile.username;

    document.querySelectorAll('[data-user-name]').forEach(function (el) {
      el.textContent = name;
    });

    document.querySelectorAll('[data-user-role]').forEach(function (el) {
      el.textContent = ROLE_LABEL[profile.user_role] || 'Staff';
    });

    // Links tagged data-admin-only are hidden from moderators
    document.querySelectorAll('[data-admin-only]').forEach(function (el) {
      el.classList.toggle('hidden', profile.user_role !== 'admin');
    });
  }

  function fillMainSiteLinks() {
    document.querySelectorAll('[data-main-site]').forEach(function (a) {
      a.href = cfg.mainSiteUrl + (a.getAttribute('data-main-site') || '');
    });
  }

  if (window.Components && window.Components.ready) {
    window.Components.ready.then(fillMainSiteLinks);
  }

  /* ---------- The guard every admin page calls first ---------- */
  // Options: { adminOnly: true } to also refuse moderators.
  // Returns { user, profile } when the page may be shown, otherwise null.
  async function requireStaff(options) {
    var opts = options || {};
    var result = await check();

    if (window.Components && window.Components.ready) {
      await window.Components.ready; // wait for the nav so it can be filled in
    }

    if (result.state === 'login') {
      window.location.replace('/login.html?next=' + encodeURIComponent(window.location.pathname + window.location.search));
      return null;
    }

    if (result.state === 'error') {
      console.error('[Analytical Admin] Could not check access:', result.error);
      showPanel(
        'Could not check your access',
        isMissingSetup(result.error)
          ? 'Run the admin.sql file in the Supabase SQL Editor, then refresh this page.'
          : (result.error ? helpers.friendlyError(result.error) : 'Your profile could not be found.'),
        { retry: true, signOut: false }
      );
      return null;
    }

    if (result.state === 'denied') {
      showPanel('No access', 'This account does not have staff access.', { signOut: true });
      return null;
    }

    fillNav(result.profile);

    if (opts.adminOnly && result.profile.user_role !== 'admin') {
      showPanel('Admins only', 'This page is only for administrators.');
      return null;
    }

    return { user: result.user, profile: result.profile };
  }

  /* ---------- Sign out ---------- */
  async function signOut() {
    await sb.auth.signOut();
    window.location.replace('/login.html');
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-logout]')) {
      e.preventDefault();
      signOut();
    }
  });

  window.Admin = Object.freeze({
    check: check,
    require: requireStaff,
    signOut: signOut,
    message: message,
    isMissingSetup: isMissingSetup
  });
})();