/**
 * The features this app has: `src/custom/features.ts` resolved against the core
 * list (docs/feature-flags-spec.md). vite.config.ts resolves the same choice at
 * build start, so a choice that cannot be built never reaches the browser.
 */
import { inject } from '@angular/core';
import { RedirectCommand, Router, type CanActivateFn } from '@angular/router';
import { CUSTOM_FEATURES } from '../../../custom/features';
import { resolveFeatures, type FeatureId } from './feature-registry';

export const FEATURES = resolveFeatures(CUSTOM_FEATURES);

export function isOn(id: FeatureId): boolean {
    return FEATURES.has(id);
}

/**
 * For a page of a feature that is off: shows the not-found page and keeps the
 * address. A `canActivate`, not a `canMatch`: the file router wraps each page in
 * a parent route, which would still match (and render nothing) if the page
 * itself refused to.
 */
export function featureGuard(id: FeatureId): CanActivateFn {
    // browserUrl keeps the address the visitor asked for, on a first load and after
    // an in-app link alike (skipLocationChange kept the previous page's address).
    return (_route, state) => isOn(id) || new RedirectCommand(inject(Router).parseUrl('/not-found'), { browserUrl: state.url });
}
