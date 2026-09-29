/**
 * One trigger per collection an app made searchable (docs/feature-flags-spec.md,
 * section 6.5), exported as a group: `Products` deploys as
 * `arccms-searchSync-Products`. Adding a collection to
 * functions/src/custom/search-sources.ts adds its trigger on the next deploy;
 * a write to any other collection starts no search function.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { arcDocument } from '../arc-config.js';
import { syncDocument } from './sync.js';
import { triggerName, triggeredCollections } from './registry.js';
import type { SearchDocument } from './source.js';

export const searchSync = Object.fromEntries(triggeredCollections().map((collection) => [
    triggerName(collection),
    onDocumentWritten(arcDocument(`${collection}/{docId}`), async (event) => {
        const after = event.data?.after;
        await syncDocument(collection, event.params.docId, after?.exists ? (after.data() as SearchDocument) : null);
    }),
]));
