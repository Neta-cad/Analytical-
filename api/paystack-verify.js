'use strict';

/* ==========================================================
   paystack-verify.js — the buyer returned from Paystack.
   POST { reference } with the member's login token.
   Returns { state, datasetId }.
   ========================================================== */

const lib = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return lib.send(res, 405, { error: 'Method not allowed.' });

  const s = lib.settings();
  const missing = lib.missingSettings(s);
  if (missing.length) {
    console.error('Missing or invalid settings:', missing.join(', '));
    return lib.send(res, 500, { error: 'Payments are not configured yet.' });
  }

  const token = lib.bearer(req);
  if (!token) return lib.send(res, 401, { error: 'Log in to continue.' });

  const user = await lib.getUser(s, token);
  if (!user) return lib.send(res, 401, { error: 'Log in to continue.' });

  const reference = String(lib.readBody(req).reference || '');
  if (!lib.REFERENCE.test(reference)) {
    return lib.send(res, 400, { error: 'That payment reference is not valid.' });
  }

  /* Only the buyer can check their own payment */
  const found = await lib.rest(
    s,
    'dataset_purchases?provider_ref=eq.' + reference + '&select=id,buyer_id,dataset_id,status&limit=1'
  );

  if (!found.ok) {
    console.error('Purchase lookup failed:', found.status);
    return lib.send(res, 500, { error: 'Something went wrong. Please try again.' });
  }

  const purchase = Array.isArray(found.data) ? found.data[0] : null;

  if (!purchase) return lib.send(res, 404, { error: 'We could not find that payment.' });
  if (purchase.buyer_id !== user.id) return lib.send(res, 403, { error: 'That payment belongs to another account.' });

  if (purchase.status === 'paid') {
    return lib.send(res, 200, { state: 'paid', datasetId: purchase.dataset_id });
  }

  const state = await lib.settlePurchase(s, reference);

  if (state === 'error') {
    return lib.send(res, 502, { error: 'We could not confirm the payment yet. Please try again in a moment.' });
  }

  return lib.send(res, 200, { state: state, datasetId: purchase.dataset_id });
};