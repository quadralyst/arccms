import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { buildWaitlistTemplateDefs } from './defaultTemplates.js';

/**
 * Admin callable: the current default OTP + welcome templates, read-only.
 *
 * Exists so the admin Templates page has no copy of its own. It used to keep
 * `DEFAULT_OTP_TEMPLATE` / `DEFAULT_WELCOME_TEMPLATE` locally, and they had drifted
 * into an entirely different document from what the server seeds — a full
 * `<!DOCTYPE html>` page rather than an embeddable body, different copy, and a
 * subject that never named the form. "Reset to default" therefore replaced the
 * admin's template with something the system would never have produced.
 *
 * Writes nothing; seeding is {@link ensureWaitlistTemplates}'s job.
 */
export const getWaitlistTemplateDefaults = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const defs = buildWaitlistTemplateDefs().map((def) => ({
    type: def.type,
    category: def.category,
    subject: def.subject,
    title: def.title,
    previewText: def.previewText,
    template: def.body,
  }));

  return { defaults: defs };
});
