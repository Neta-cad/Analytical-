/* ==========================================================
   supabase.js — the single Supabase client for the whole site
   Needs: the Supabase library script, then config.js, then this file.
   ========================================================== */

(function () {
  'use strict';

  const cfg = window.APP_CONFIG;

  /* ---------- Safety checks ---------- */
  function showBanner(message) {
    function render() {
      if (document.getElementById('config-banner')) return;
      const bar = document.createElement('div');
      bar.id = 'config-banner';
      bar.setAttribute('role', 'alert');
      bar.style.cssText =
        'position:fixed;left:0;right:0;top:0;z-index:99999;' +
        'padding:12px 16px;background:#dc2626;color:#fff;' +
        'font:600 14px/1.4 system-ui,sans-serif;text-align:center;';
      bar.textContent = message;
      document.body.appendChild(bar);
    }
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render);
  }

  if (!cfg) {
    console.error('[Analytical] config.js must load before supabase.js');
    showBanner('Setup error: config.js is missing or loaded in the wrong order.');
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[Analytical] The Supabase library did not load.');
    showBanner('Setup error: the Supabase library failed to load. Check your internet connection.');
    return;
  }

  if (!cfg.isConfigured()) {
    console.error('[Analytical] Supabase URL or anon key is still a REPLACE_ value in config.js');
    showBanner('Setup needed: add your Supabase URL and anon key in assets/js/config.js');
    return;
  }

  /* ---------- Client ---------- */
  const client = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey, {
    auth: {
      persistSession: true,        // stay logged in after refresh
      autoRefreshToken: true,      // renew the session quietly
      detectSessionInUrl: true,    // needed for password reset and social login links
      storageKey: 'analytical-auth'
    }
  });

  window.sb = client;

  /* ---------- Friendly error messages ---------- */
  function friendlyError(error) {
    if (!error) return 'Something went wrong. Please try again.';

    const raw = String(error.message || error.error_description || error).toLowerCase();

    if (raw.includes('invalid login credentials')) return 'Email or password is incorrect.';
    if (raw.includes('email not confirmed')) return 'Please confirm your email first. Check your inbox.';
    if (raw.includes('user already registered')) return 'An account with this email already exists.';
    if (raw.includes('password should be at least')) return 'Your password is too short.';
    if (raw.includes('rate limit') || raw.includes('too many requests')) return 'Too many attempts. Please wait a minute and try again.';
    if (raw.includes('failed to fetch') || raw.includes('network')) return 'Network problem. Check your connection and try again.';
    if (raw.includes('jwt expired')) return 'Your session expired. Please log in again.';
    if (raw.includes('duplicate key') || raw.includes('already exists')) return 'That value is already taken.';
    if (raw.includes('row-level security') || raw.includes('permission denied')) return 'You do not have permission to do that.';
    if (raw.includes('signup is disabled') || raw.includes('signups not allowed')) return 'Sign ups are currently closed.';

    return error.message || 'Something went wrong. Please try again.';
  }

  /* ---------- Small helpers ---------- */
  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) {
      console.error('[Analytical] getSession failed:', error);
      return null;
    }
    return data.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session ? session.user : null;
  }

  // Calls back whenever someone logs in, logs out, or their session refreshes.
  function onAuthChange(callback) {
    const { data } = client.auth.onAuthStateChange(function (event, session) {
      callback(event, session);
    });
    return function unsubscribe() {
      data.subscription.unsubscribe();
    };
  }

  window.sbHelpers = Object.freeze({
    friendlyError: friendlyError,
    getSession: getSession,
    getUser: getUser,
    onAuthChange: onAuthChange
  });
})();