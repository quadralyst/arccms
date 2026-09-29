/**
 * The features this app has: `src/custom/features.ts` resolved against the core
 * list (docs/feature-flags-spec.md). vite.config.ts resolves the same choice at
 * build start, so a choice that cannot be built never reaches the browser.
 */
import type { CanMatchFn } from '@angular/router';
import { CUSTOM_FEATURES } from '../../../custom/features';
import { CUSTOM_PWA } from '../../../custom/pwa';
import { resolvePwaConfig } from '../pwa/pwa-config';
import { resolveFeatures, type FeatureId } from './feature-registry';

export const FEATURES = resolveFeatures(CUSTOM_FEATURES, resolvePwaConfig(CUSTOM_PWA).enabled);

export function isOn(id: FeatureId): boolean {
    return FEATURES.has(id);
}

/** A route of a feature that is off never matches, so the visitor gets the not-found page. */
export function featureGuard(id: FeatureId): CanMatchFn {
    return () => isOn(id);
}
