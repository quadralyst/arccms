/**
 * Install configuration for the browser app and SSR (docs/coexistence-spec.md, CO-D3).
 *
 * Written by `npm run arc:configure` from `arccms.config.json`; do not edit by hand.
 * Empty means the defaults every standalone install uses: the `(default)`
 * Firestore database, the bucket in `firebaseConfig.storageBucket`, uploads at
 * the bucket root.
 */
import type { ArcInstallConfig } from '../app/core/config/arc-config';

export const arcInstall: ArcInstallConfig = {};
