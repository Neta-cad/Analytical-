'use strict';

/* ==========================================================
   _lib.js — shared helpers for the payment functions.
   The leading underscore keeps Vercel from exposing it as a page.
   Secrets are read from Vercel environment settings only.
   ========================================================== */

const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^ANL-[0-9a-f]{24}$/;

/* ---------- Settings ---------- */
function settings() {
  return {
    paystackKey: process.env.PAYSTACK_SECRET_KEY || '',
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    siteUrl: (process.env.SITE_URL || '').replace(/\/+$/, ''),
    commission: parseFloat(process.env.COMMISSION_PERCENT)
  };
}

// Returns the NAMES of settings that are missing or invalid (never their values)
function missingSettings(s) {
  const missing = [];
  if (!/^sk_(test|live)_/.test(s.paystackKey)) missing.push('PAYSTACK_SECRET_KEY');
  if (!/^https:\/\//.test(s.supabaseUrl)) missing.push('SUPABASE_URL');
  if (!s.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!/^https:\/\//.test(s.siteUrl)) missing.push('SITE_URL');
  if (!(s.commission >= 0 && s.commission <= 100)) missing.push('COMMISSION_PERCENT');
  return missing;
}

/* ---------- Request and response helpers ---------- */
function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function bearer(req) {
  const header = String(req.headers.authorization || '');
  return header.indexOf('Bearer ') === 0 ? header.slice(7).trim() : '';
}

function readBody(req) {
  const body = req.body;
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (e) { return {}; }
  }
  return {};
}

function newReference() {
  // Paystack allows letters, numbers and hyphens in a reference
  return 'ANL-' + crypto.randomBytes(12).toString('hex');
}

/* ---------- Who is calling? ---------- */
async function getUser(s, token) {
  try {
    const response = await fetch(s.supabaseUrl + '/auth/v1/user', {
      headers: { apikey: s.serviceKey, Authorization: 'Bearer ' + token }
    });
    if (!response.ok) return null;
    const user = await response.json();
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}

/* ---------- Supabase (server key, bypasses row-level security) ---------- */
async function rest(s, path, options) {
  const opts = options || {};

  const headers = {
    apikey: s.serviceKey,
    Authorization: 'Bearer ' + s.serviceKey,
    'Content-Type': 'application/json'
  };
  if (opts.prefer) headers.Prefer = opts.prefer;

  try {
    const response = await fetch(s.supabaseUrl + '/rest/v1/' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }

    return { ok: response.ok, status: response.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

/* ---------- Paystack ---------- */
async function paystack(s, path, options) {
  const opts = options || {};

  try {
    const response = await fetch('https://api.paystack.co' + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + s.paystackKey,
        'Content-Type': 'application/json'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }

    return { ok: response.ok, status: response.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

/* ==========================================================
   Check a payment with Paystack, then record it.
   Returns one of: paid, duplicate, mismatch, failed, pending,
   not_found, error. Safe to call many times for the same payment.
   ========================================================== */
async function settlePurchase(s, reference) {
  const verified = await paystack(s, '/transaction/verify/' + encodeURIComponent(reference));

  if (verified.status === 404) return 'not_found';

  if (!verified.ok || !verified.data || !verified.data.data) {
    console.error('Paystack verify failed:', verified.status);
    return 'error';
  }

  const tx = verified.data.data;

  if (tx.status === 'success') {
    const done = await rest(s, 'rpc/complete_purchase', {
      method: 'POST',
      body: {
        p_reference: reference,
        p_amount: Number(tx.amount) / 100,   // Paystack sends kobo, we store naira
        p_currency: String(tx.currency || ''),
        p_tx_id: String(tx.id || ''),
        p_commission_rate: s.commission
      }
    });

    if (!done.ok) {
      console.error('complete_purchase failed:', done.status, JSON.stringify(done.data));
      return 'error';
    }

    const result = String(done.data || '');

    if (result === 'paid' || result === 'already_paid') return 'paid';
    if (result === 'duplicate') return 'duplicate';
    if (result === 'mismatch') return 'mismatch';
    if (result === 'not_found') return 'not_found';

    console.error('complete_purchase returned:', result);
    return 'error';
  }

  if (tx.status === 'failed') {
    await rest(s, 'rpc/fail_purchase', { method: 'POST', body: { p_reference: reference } });
    return 'failed';
  }

  // abandoned, ongoing, pending, queued: the buyer has not finished paying
  return 'pending';
}

module.exports = {
  UUID: UUID,
  REFERENCE: REFERENCE,
  settings: settings,
  missingSettings: missingSettings,
  send: send,
  bearer: bearer,
  readBody: readBody,
  newReference: newReference,
  getUser: getUser,
  rest: rest,
  paystack: paystack,
  settlePurchase: settlePurchase
};