/* ==========================================================
   auth.js — sign up, login, logout, password reset,
   page protection and nav login state
   Needs (in this order): supabase library, config.js,
   supabase.js, ui.js, utils.js, then this file.
   ========================================================== */

(function () {
  'use strict';

  const cfg = window.APP_CONFIG;
  const sb = window.sb;
  const helpers = window.sbHelpers;

  if (!cfg || !sb || !helpers) {
    console.error('[Analytical] auth.js needs config.js and supabase.js to load first.');
    return;
  }

  const routes = cfg.routes;
  let cachedProfile = null;

  /* ---------- Result helpers ---------- */
  function ok(data) {
    return { ok: true, error: '', data: data || null };
  }

  function fail(error) {
    return { ok: false, error: helpers.friendlyError(error), data: null };
  }

  function cleanEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function absoluteUrl(path) {
    return window.location.origin + path;
  }

  /* ---------- Profile ---------- */
  async function getProfile(userId, forceRefresh) {
    let id = userId;

    if (!id) {
      const user = await helpers.getUser();
      if (!user) return null;
      id = user.id;
      if (cachedProfile && cachedProfile.id === id && !forceRefresh) return cachedProfile;
    }

    const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();

    if (error) {
      console.error('[Analytical] getProfile failed:', error);
      return null;
    }

    const user = await helpers.getUser();
    if (data && user && data.id === user.id) cachedProfile = data;
    return data;
  }

  /* ---------- Username availability ---------- */
  async function isUsernameAvailable(username) {
    const name = String(username || '').trim().toLowerCase();
    if (Utils.validate.username(name)) return false;

    const { data, error } = await sb
      .from('profiles')
      .select('id')
      .eq('username', name)
      .maybeSingle();

    if (error) {
      console.error('[Analytical] username check failed:', error);
      return false;
    }
    return !data;
  }

  /* ---------- Sign up ---------- */
  async function signUp(fields) {
    const email = cleanEmail(fields.email);
    const username = String(fields.username || '').trim().toLowerCase();
    const fullName = String(fields.fullName || '').trim();
    const country = String(fields.country || '').trim().toUpperCase();
    const password = String(fields.password || '');

    const problem =
      Utils.validate.fullName(fullName) ||
      Utils.validate.username(username) ||
      Utils.validate.email(email) ||
      Utils.validate.password(password);

    if (problem) return { ok: false, error: problem, data: null };

    if (!(await isUsernameAvailable(username))) {
      return { ok: false, error: 'That username is already taken.', data: null };
    }

    const { data, error } = await sb.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: fullName, username: username, country: country },
        emailRedirectTo: absoluteUrl(routes.login)
      }
    });

    if (error) return fail(error);

    // Supabase hides whether an email exists: an empty identities list means it does.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, error: 'An account with this email already exists.', data: null };
    }

    return ok({
      needsConfirmation: !data.session,
      user: data.user
    });
  }

  async function resendConfirmation(email) {
    const address = cleanEmail(email);
    const problem = Utils.validate.email(address);
    if (problem) return { ok: false, error: problem, data: null };

    const { error } = await sb.auth.resend({
      type: 'signup',
      email: address,
      options: { emailRedirectTo: absoluteUrl(routes.login) }
    });

    return error ? fail(error) : ok();
  }

  /* ---------- Log in ---------- */
  async function signIn(email, password) {
    const address = cleanEmail(email);
    const problem = Utils.validate.email(address);
    if (problem) return { ok: false, error: problem, data: null };
    if (!password) return { ok: false, error: 'Enter your password.', data: null };

    const { data, error } = await sb.auth.signInWithPassword({
      email: address,
      password: String(password)
    });

    if (error) return fail(error);
    cachedProfile = null;
    return ok(data);
  }

  // Social login. The provider must first be switched on in
  // Supabase > Authentication > Providers (Google, GitHub).
  async function signInWithProvider(provider) {
    if (provider !== 'google' && provider !== 'github') {
      return { ok: false, error: 'That sign-in method is not supported.', data: null };
    }

    const { error } = await sb.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: absoluteUrl(routes.dashboard) }
    });

    return error ? fail(error) : ok();
  }

  /* ---------- Log out ---------- */
  async function signOut(redirect) {
    const { error } = await sb.auth.signOut();
    cachedProfile = null;

    if (error) {
      console.error('[Analytical] signOut failed:', error);
      UI.toast.error(helpers.friendlyError(error));
      return fail(error);
    }

    if (redirect !== false) window.location.href = routes.home;
    return ok();
  }

  /* ---------- Password reset ---------- */
  async function sendPasswordReset(email) {
    const address = cleanEmail(email);
    const problem = Utils.validate.email(address);
    if (problem) return { ok: false, error: problem, data: null };

    const { error } = await sb.auth.resetPasswordForEmail(address, {
      redirectTo: absoluteUrl(routes.reset)
    });

    return error ? fail(error) : ok();
  }

  // Used on the reset page after the person opens the link from their email.
  async function updatePassword(newPassword) {
    const problem = Utils.validate.password(newPassword);
    if (problem) return { ok: false, error: problem, data: null };

    const { error } = await sb.auth.updateUser({ password: String(newPassword) });
    return error ? fail(error) : ok();
  }

  /* ---------- Page protection ---------- */
  // Call at the top of any private page.
  // Options: { role: 'admin' } to also require a role.
  async function requireAuth(options) {
    const opts = options || {};
    const session = await helpers.getSession();

    if (!session) {
      const here = window.location.pathname + window.location.search;
      window.location.replace(routes.login + '?next=' + encodeURIComponent(here));
      return null;
    }

    const profile = await getProfile(session.user.id, true);

    if (opts.role && (!profile || profile.user_role !== opts.role)) {
      UI.toast.error('You do not have access to that page.');
      window.location.replace(routes.dashboard);
      return null;
    }

    return { user: session.user, profile: profile };
  }

  // Call on login and register pages so signed-in people skip them.
  async function redirectIfLoggedIn() {
    const session = await helpers.getSession();
    if (!session) return false;

    const next = Utils.safeRedirectPath(Utils.getParam('next'), routes.dashboard);
    window.location.replace(next);
    return true;
  }

  // Where to send someone after a successful login.
  function goAfterLogin() {
    const next = Utils.safeRedirectPath(Utils.getParam('next'), routes.dashboard);
    window.location.href = next;
  }

  /* ---------- Nav login state ---------- */
  // Markup hooks:
  //   data-auth="in"    shown only when logged in
  //   data-auth="out"   shown only when logged out
  //   data-user-name    gets the person's name
  //   data-user-username gets @username
  //   data-user-avatar  gets the avatar image or initials
  async function refreshNav() {
    const session = await helpers.getSession();
    const loggedIn = !!session;

    document.querySelectorAll('[data-auth="in"]').forEach(function (el) {
      el.classList.toggle('hidden', !loggedIn);
    });
    document.querySelectorAll('[data-auth="out"]').forEach(function (el) {
      el.classList.toggle('hidden', loggedIn);
    });

    if (!loggedIn) return;

    const profile = await getProfile(session.user.id);
    const displayName = (profile && (profile.full_name || profile.username)) || 'Member';

    document.querySelectorAll('[data-user-name]').forEach(function (el) {
      el.textContent = displayName;
    });

    document.querySelectorAll('[data-user-username]').forEach(function (el) {
      el.textContent = profile && profile.username ? '@' + profile.username : '';
    });

    document.querySelectorAll('[data-user-avatar]').forEach(function (el) {
      el.innerHTML = '';
      const avatarUrl = profile && Utils.safeUrl(profile.avatar_url);

      if (avatarUrl) {
        const img = document.createElement('img');
        img.src = avatarUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', function () {
          el.textContent = Utils.initials(displayName);
        });
        el.appendChild(img);
      } else {
        el.textContent = Utils.initials(displayName);
      }
    });
  }

  /* ---------- Logout buttons anywhere on the page ---------- */
  document.addEventListener('click', function (e) {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const btn = target.closest('[data-logout]');
    if (!btn) return;

    e.preventDefault();
    signOut();
  });

  /* ---------- React to login and logout ---------- */
  // Supabase warns against awaiting its own calls inside this callback,
  // so the work is pushed to the next tick.
  helpers.onAuthChange(function (event) {
    setTimeout(function () {
      if (event === 'SIGNED_OUT') cachedProfile = null;
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        refreshNav();
      }
    }, 0);
  });

  /* ---------- Public API ---------- */
  window.Auth = Object.freeze({
    signUp: signUp,
    resendConfirmation: resendConfirmation,
    signIn: signIn,
    signInWithProvider: signInWithProvider,
    signOut: signOut,
    sendPasswordReset: sendPasswordReset,
    updatePassword: updatePassword,
    isUsernameAvailable: isUsernameAvailable,
    getProfile: getProfile,
    requireAuth: requireAuth,
    redirectIfLoggedIn: redirectIfLoggedIn,
    goAfterLogin: goAfterLogin,
    refreshNav: refreshNav
  });
})();