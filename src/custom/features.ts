/**
 * The Arc CMS features this app turns off (docs/custom-code.md). Arc CMS ships
 * this empty, with every feature on, and never edits it again.
 *
 *   export const CUSTOM_FEATURES: FeatureChoice = {
 *       off: ['content', 'sms', 'payments'],
 *   };
 *
 * Features: content, search, seo, forms, audience, email-marketing, sms, payments,
 * data. Signup forms and email marketing need audience. The installable app (PWA)
 * is switched in pwa.ts instead. A typo or a missing need stops `npm run dev` and
 * `npm run build` with a message saying what to change.
 */
import type { FeatureChoice } from '../app/core/features/feature-registry';

export const CUSTOM_FEATURES: FeatureChoice = {};
