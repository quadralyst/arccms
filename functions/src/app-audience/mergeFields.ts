/**
 * An app user's host fields for merge tags (docs/coexistence-spec.md 5b, CO6.5a):
 * `##APP.<path>##` in a template reads `appFields[<path>]` on the email log.
 * Read from the host document when the email is queued; credential-like fields
 * are left out entirely, so no template can put one in an email.
 */
import { firestoreFor } from '../init.js';
import { appUsersLocation } from './config.js';
import { flattenFields, isSensitiveField } from './fields.js';

export function appMergeFields(data: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, value] of Object.entries(flattenFields(data))) {
        if (!isSensitiveField(path)) out[path] = value;
    }
    return out;
}

/** The merge fields of one host document, or {} when it is gone or no app is configured. */
export async function readAppMergeFields(docId: string): Promise<Record<string, string>> {
    const location = appUsersLocation();
    if (!location.configured || !docId) return {};
    const snap = await firestoreFor(location.database).collection(location.collection).doc(docId).get();
    return snap.exists ? appMergeFields(snap.data() ?? {}) : {};
}
