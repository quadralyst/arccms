/**
 * The features this app has, for code that runs whatever the features are and
 * calls into one of them (docs/feature-flags-spec.md, section 5.3).
 *
 * ENABLED_FEATURES is generated from src/custom/features.ts by
 * scripts/arc-features.mjs before every build and test run. FeatureId mirrors
 * src/app/core/features/feature-registry.ts; a test keeps the two in step.
 */
import { ENABLED_FEATURES } from './enabled-features.gen.js';

export const FEATURE_IDS = [
    'content',
    'search',
    'seo',
    'forms',
    'audience',
    'email-marketing',
    'sms',
    'payments',
    'data',
    'pwa',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export function isFeatureOn(id: FeatureId): boolean {
    return ENABLED_FEATURES.includes(id);
}
