/**
 * An app user's host fields for merge tags (docs/coexistence-spec.md 5b, CO6.5a):
 * `##APP.<path>##` in a template reads `appFields[<path>]` on the email log.
 * Read from the host document when the email is queued; credential-like fields
 * are left out entirely, so no template can put one in an email.
 */
import { firestoreFor } from '../init.js';
import { appUsersLocation } from './config.js';
import { flattenFields, isSensitiveField } from './fields.js';

/**
 * App user field merge tag: `##APP.<path>##`, with an optional fallback,
 * `##APP.subscription.tier|free##`. Group 1 is the path, group 2 the fallback.
 * The one definition, for the sender (mailConfig.ts) and the queue.
 */
export const APP_TAG_PATTERN = /##APP\.([A-Za-z0-9_.-]+)(?:\|([^#]*))?##/g;

/**
 * Only the fields an email's `##APP.*##` tags use. The log keeps these, never
 * the person's whole host document.
 */
export function usedAppFields(fields: Record<string, string>, ...texts: Array<string | undefined>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const text of texts) {
        for (const match of (text ?? '').matchAll(APP_TAG_PATTERN)) {
            if (match[1] in fields) out[match[1]] = fields[match[1]];
        }
    }
    return out;
}

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
