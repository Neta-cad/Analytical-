/* ==========================================================
   report.js — the "Report" window shared by dataset and profile pages.
   Needs (loaded first): config.js, supabase.js, ui.js, utils.js, auth.js
   Use: Report.open({ type: 'dataset' or 'profile', id: '...', label: 'Name shown in the window' })
   ========================================================== */

(function () {
  'use strict';

  var cfg = window.APP_CONFIG;

  if (!cfg || !window.sb || !window.sbHelpers || !window.UI || !window.Utils) {
    console.error('[Analytical] report.js needs the main scripts to load first.');
    return;
  }

  var sb = window.sb;

  var REASONS = {
    spam: 'Spam or advertising',
    copyright: 'Copyright: it uses work without permission',
    inappropriate: 'Inappropriate or harmful content',
    scam: 'Scam or fraud',
    misleading: 'Misleading or fake information',
    other: 'Something else'
  };

  var HINTS = {
    spam: 'Content that only advertises something or repeats itself.',
    copyright: 'If you own the work, say so in the details and tell us where it was published.',
    inappropriate: 'Anything abusive, hateful, sexual or harmful.',
    scam: 'Someone trying to take money or information dishonestly.',
    misleading: 'The description or preview does not match what it really is.',
    other: 'Tell us what is wrong in the details below.'
  };

  var modal = null;
  var target = null;
  var busy = false;
  var els = {};

  function $(id) { return document.getElementById(id); }

  /* ---------- Build the window once ---------- */
  function build() {
    if (modal) return;

    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'report-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'report-heading');
    modal.setAttribute('aria-hidden', 'true');

    modal.innerHTML =
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<h2 id="report-heading" style="font-size: var(--fs-lg);">Report</h2>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-modal-close aria-label="Close">Close</button>' +
        '</div>' +
        '<form id="report-form" novalidate>' +
          '<div class="modal-body">' +
            '<p class="text-sm" id="report-target" style="margin-bottom: var(--sp-4); word-break: break-word;"></p>' +
            '<div class="alert alert-danger hidden" id="report-error" role="alert" style="margin-bottom: var(--sp-4);"></div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="report-reason">Why are you reporting this? <span class="req">*</span></label>' +
              '<select class="select" id="report-reason"></select>' +
              '<p class="form-hint" id="report-hint"></p>' +
              '<p class="form-error hidden" id="report-reason-error"></p>' +
            '</div>' +
            '<div class="form-group" style="margin-bottom: 0;">' +
              '<label class="form-label" for="report-details">Details (optional)</label>' +
              '<textarea class="textarea" id="report-details" maxlength="1000" style="min-height: 110px;" ' +
                'placeholder="Add anything that helps us review this quickly."></textarea>' +
              '<div class="text-xs text-muted" id="report-counter" style="text-align: right;">0 / 1000</div>' +
              '<p class="form-error hidden" id="report-details-error"></p>' +
            '</div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-secondary" type="button" data-modal-close>Cancel</button>' +
            '<button class="btn btn-primary" type="submit" id="report-submit">Send report</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    document.body.appendChild(modal);

    els.heading = $('report-heading');
    els.target = $('report-target');
    els.error = $('report-error');
    els.form = $('report-form');
    els.reason = $('report-reason');
    els.hint = $('report-hint');
    els.details = $('report-details');
    els.counter = $('report-counter');
    els.submit = $('report-submit');

    // Fill the reasons
    var first = document.createElement('option');
    first.value = '';
    first.textContent = 'Select a reason';
    els.reason.appendChild(first);

    Object.keys(REASONS).forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = REASONS[key];
      els.reason.appendChild(opt);
    });

    els.reason.addEventListener('change', function () {
      els.hint.textContent = HINTS[els.reason.value] || '';
      Utils.showFieldError(els.reason, checkReason());
    });

    els.details.addEventListener('input', function () {
      var length = els.details.value.length;
      els.counter.textContent = length + ' / 1000';
      if (els.details.classList.contains('is-invalid')) Utils.showFieldError(els.details, checkDetails());
    });

    els.form.addEventListener('submit', submit);
  }

  /* ---------- Validation ---------- */
  function checkReason() {
    return REASONS[els.reason.value] ? '' : 'Select a reason.';
  }

  function checkDetails() {
    return els.details.value.length > 1000 ? 'Details must be 1000 characters or fewer.' : '';
  }

  /* ---------- Send ---------- */
  async function submit(e) {
    e.preventDefault();
    if (busy || !target) return;

    els.error.classList.add('hidden');

    var reasonProblem = checkReason();
    var detailsProblem = checkDetails();

    Utils.showFieldError(els.reason, reasonProblem);
    Utils.showFieldError(els.details, detailsProblem);

    if (reasonProblem) { els.reason.focus(); return; }
    if (detailsProblem) { els.details.focus(); return; }

    busy = true;
    UI.setLoading(els.submit, true);

    var result = await sb.rpc('create_report', {
      p_target_type: target.type,
      p_target_id: target.id,
      p_reason: els.reason.value,
      p_details: els.details.value.trim() || null
    });

    UI.setLoading(els.submit, false);
    busy = false;

    if (result.error) {
      console.error('[Analytical] Could not send the report:', result.error);

      var text = String(result.error.message || '').toLowerCase();
      var missing =
        result.error.code === 'PGRST202' ||
        text.indexOf('could not find the function') !== -1 ||
        text.indexOf('schema cache') !== -1;

      els.error.textContent = missing
        ? 'Reports are not set up yet. Run the admin.sql file in the Supabase SQL Editor, then try again.'
        : (result.error.code === 'P0001' ? result.error.message : sbHelpers.friendlyError(result.error));

      els.error.classList.remove('hidden');
      return;
    }

    UI.closeModal(modal);
    UI.toast.success('Thank you. Your report was sent to our team.');
  }

  /* ---------- Open the window ---------- */
  async function open(options) {
    var opts = options || {};

    if (opts.type !== 'dataset' && opts.type !== 'profile') return;
    if (!opts.id) return;

    // Reporting needs an account, so send visitors to log in and bring them back
    var session = await sbHelpers.getSession();
    if (!session) {
      var here = window.location.pathname + window.location.search;
      window.location.href = cfg.routes.login + '?next=' + encodeURIComponent(here);
      return;
    }

    build();

    target = { type: opts.type, id: opts.id };

    els.heading.textContent = opts.type === 'dataset' ? 'Report this dataset' : 'Report this profile';
    els.target.textContent = opts.label ? 'You are reporting: ' + opts.label : '';

    els.error.classList.add('hidden');
    els.reason.value = '';
    els.hint.textContent = '';
    els.details.value = '';
    els.counter.textContent = '0 / 1000';
    Utils.showFieldError(els.reason, '');
    Utils.showFieldError(els.details, '');

    UI.openModal(modal);
  }

  window.Report = Object.freeze({ open: open });
})();