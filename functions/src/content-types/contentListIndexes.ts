/**
 * The indexes a content list needs to filter by status and sort by date
 * (docs/features/content.html#status-filter).
 *
 * Each content type has a collection of its own, made when an admin adds the type, so these
 * cannot be listed in firestore.indexes.json. An admin creates a type's pair from its list
 * (createContentListIndexes.ts). Both directions: Previous and Last read in the reverse order.
 */
import { GoogleAuth } from 'google-auth-library';
import { arcDatabaseId } from '../arc-config.js';

const FIRESTORE_ADMIN_API = 'https://firestore.googleapis.com/v1';
const FILTER_FIELD = 'publishedStatus';
const SORT_FIELD = 'modifiedAt';
const DIRECTIONS = ['ASCENDING', 'DESCENDING'] as const;

export type ContentListIndexes = 'requested' | 'failed';

let auth: GoogleAuth | null = null;

/** A call to Firestore's admin API, as the functions' own service account. */
async function adminApi(path: string, init: RequestInit = {}): Promise<Response> {
    auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
    const token = await auth.getAccessToken();
    return fetch(`${FIRESTORE_ADMIN_API}/${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
    });
}

function indexesPath(collectionName: string): string {
    const project = process.env.GCLOUD_PROJECT;
    if (!project) throw new Error('GCLOUD_PROJECT is not set');
    return `projects/${project}/databases/${arcDatabaseId()}/collectionGroups/${encodeURIComponent(collectionName)}/indexes`;
}

/**
 * Asks for the pair. An index takes minutes to build, and the list works without it, so a
 * failure is logged and answered, never thrown: the usual cause is a service
 * account without `roles/datastore.indexAdmin`, or the database's limit on indexes.
 */
export async function requestContentListIndexes(collectionName: string): Promise<ContentListIndexes> {
    try {
        const path = indexesPath(collectionName);
        for (const order of DIRECTIONS) {
            const response = await adminApi(path, {
                method: 'POST',
                body: JSON.stringify({
                    queryScope: 'COLLECTION',
                    fields: [
                        { fieldPath: FILTER_FIELD, order: 'ASCENDING' },
                        { fieldPath: SORT_FIELD, order },
                    ],
                }),
            });
            // 409: it exists already, or is building.
            if (!response.ok && response.status !== 409) {
                throw new Error(`${response.status} ${await response.text()}`);
            }
        }
        return 'requested';
    } catch (error) {
        console.warn(`Could not request the list indexes of ${collectionName}:`, error);
        return 'failed';
    }
}

interface ListedIndex {
    name: string;
    fields?: { fieldPath: string }[];
}

/** Frees the pair when a content type goes: a database has a limit on indexes. Never throws. */
export async function deleteContentListIndexes(collectionName: string): Promise<void> {
    try {
        const listed = await adminApi(indexesPath(collectionName));
        if (!listed.ok) throw new Error(`${listed.status} ${await listed.text()}`);
        const { indexes = [] } = (await listed.json()) as { indexes?: ListedIndex[] };
        for (const index of indexes.filter(isContentListIndex)) {
            const removed = await adminApi(index.name, { method: 'DELETE' });
            if (!removed.ok) throw new Error(`${removed.status} ${await removed.text()}`);
        }
    } catch (error) {
        console.warn(`Could not delete the list indexes of ${collectionName}:`, error);
    }
}

/** This pair, and not an index an app made on the same collection. Firestore adds `__name__` last. */
function isContentListIndex(index: ListedIndex): boolean {
    const fields = (index.fields ?? []).map((field) => field.fieldPath).filter((field) => field !== '__name__');
    return fields.length === 2 && fields[0] === FILTER_FIELD && fields[1] === SORT_FIELD;
}
