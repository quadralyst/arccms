/**
 * Install configuration for the browser app and SSR, per Firebase project
 * (specs/coexistence-spec.md, CO-D3, CO3.2).
 *
 * Written by `npm run arc:configure` from `arccms.config.json`; do not edit by hand.
 * The app uses the entry for its own `firebaseConfig.projectId`. A project with
 * no entry uses the defaults every standalone install uses: the `(default)`
 * Firestore database, the bucket in `firebaseConfig.storageBucket`, uploads at
 * the bucket root.
 */
import type { ArcInstallConfig } from '../app/core/config/arc-config';

export const arcInstall: Record<string, ArcInstallConfig> = {
    "xlm-project-864ff": {
        databaseId: "arccms",
        storageBucket: "xlm-project-864ff-arccms",
        storagePrefix: "arccms/",
        hostingSite: "xlm-project-864ff-arccms",
    },
};
