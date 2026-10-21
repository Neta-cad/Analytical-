'use strict';

/* ==========================================================
   paystack-initialize.js — start buying a dataset.
   POST { datasetId } with the member's login token.
   Returns { authorization_url, reference }.
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

  /* Who is buying? */
  const token = lib.bearer(req);
  if (!token) return lib.send(res, 401, { error: 'Log in to continue.' });

  const user = await lib.getUser(s, token);
  if (!user || !user.email) return lib.send(res, 401, { error: 'Log in to continue.' });

  /* Which dataset? */
  const datasetId = String(lib.readBody(req).datasetId || '');
  if (!lib.UUID.test(datasetId)) return lib.send(res, 400, { error: 'That dataset link is not valid.' });

  /* The price comes from the database, never from the browser */
  const found = await lib.rest(
    s,
    'datasets?id=eq.' + datasetId + '&select=id,title,owner_id,price_amount,currency,status&limit=1'
  );

  if (!found.ok) {
    console.error('Dataset lookup failed:', found.status);
    return lib.send(res, 500, { error: 'Something went wrong. Please try again.' });
  }

  const dataset = Array.isArray(found.data) ? found.data[0] : null;

  if (!dataset || dataset.status !== 'published') {
    return lib.send(res, 404, { error: 'This dataset is not available.' });
  }

  const price = Number(dataset.price_amount);

  if (!(price > 0)) return lib.send(res, 400, { error: 'This dataset is free. You can download it directly.' });
  if (dataset.currency !== 'NGN') return lib.send(res, 400, { error: 'This dataset cannot be bought yet.' });
  if (dataset.owner_id === user.id) return lib.send(res, 400, { error: 'You cannot buy your own dataset.' });

  /* Already bought? */
  const owned = await lib.rest(
    s,
    'dataset_purchases?dataset_id=eq.' + datasetId +
      '&buyer_id=eq.' + user.id + '&status=eq.paid&select=id&limit=1'
  );

  if (owned.ok && Array.isArray(owned.data) && owned.data.length) {
    return lib.send(res, 409, { error: 'You already own this dataset.' });
  }

  /* Paystack counts in kobo (1 naira = 100 kobo) */
  const kobo = Math.round(price * 100);
  if (!Number.isInteger(kobo) || kobo < 10000) {
    return lib.send(res, 400, { error: 'This dataset has an invalid price.' });
  }

  /* Record the attempt before sending the buyer to pay */
  const reference = lib.newReference();

  const created = await lib.rest(s, 'dataset_purchases', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      dataset_id: dataset.id,
      buyer_id: user.id,
      seller_id: dataset.owner_id,
      amount: price,
      currency: 'NGN',
      provider: 'paystack',
      provider_ref: reference,
      status: 'pending'
    }
  });

  if (!created.ok) {
    console.error('Could not record the purchase:', created.status, JSON.stringify(created.data));
    return lib.send(res, 500, { error: 'Could not start the payment. Please try again.' });
  }

  /* Ask Paystack for a checkout page */
  const started = await lib.paystack(s, '/transaction/initialize', {
    method: 'POST',
    body: {
      email: user.email,
      amount: kobo,
      currency: 'NGN',
      reference: reference,
      callback_url: s.siteUrl + '/pages/data/payment.html',
      metadata: {
        dataset_id: dataset.id,
        buyer_id: user.id,
        dataset_title: String(dataset.title || '').slice(0, 100),
        cancel_action: s.siteUrl + '/pages/data/dataset.html?id=' + dataset.id
      }
    }
  });

  const link = started.data && started.data.data && started.data.data.authorization_url;

  if (!started.ok || !link) {
    console.error('Paystack initialize failed:', started.status, started.data && started.data.message);
    await lib.rest(s, 'rpc/fail_purchase', { method: 'POST', body: { p_reference: reference } });
    return lib.send(res, 502, { error: 'Could not reach the payment service. Please try again.' });
  }

  return lib.send(res, 200, { authorization_url: link, reference: reference });
};