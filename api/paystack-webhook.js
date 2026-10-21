'use strict';

/* ==========================================================
   paystack-webhook.js — Paystack tells us a payment happened.
   The message is never trusted on its own: we take the payment
   reference from it and ask Paystack directly whether it succeeded.
   ========================================================== */

const lib = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return lib.send(res, 405, { error: 'Method not allowed.' });

  const s = lib.settings();
  const missing = lib.missingSettings(s);
  if (missing.length) {
    console.error('Missing or invalid settings:', missing.join(', '));
    return lib.send(res, 500, { error: 'Not configured.' });
  }

  const body = lib.readBody(req);
  const reference = body && body.data ? String(body.data.reference || '') : '';

  // Only handle successful charges for Analytical. Ignore everything else
  // (this also keeps other projects on the same Paystack account untouched).
  if (body.event !== 'charge.success' || !lib.REFERENCE.test(reference)) {
    return lib.send(res, 200, { received: true });
  }

  const state = await lib.settlePurchase(s, reference);

  // A temporary problem: tell Paystack to try again later
  if (state === 'error') {
    return lib.send(res, 500, { error: 'Temporary problem. Please retry.' });
  }

  return lib.send(res, 200, { received: true });
};