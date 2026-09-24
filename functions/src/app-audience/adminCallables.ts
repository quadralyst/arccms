/**
 * Admin callables behind Settings, App audience (docs/coexistence-spec.md 5b, CO6.2).
 * They read the host collection with the functions' admin rights; nothing is written
 * to it, and nothing read is stored.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, firestoreFor } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import {
    appUsersLocation, normalizeAppAudienceSettings, DEFAULT_APP_AUDIENCE_SETTINGS,
    type AppAudienceSettings, type AppUsersLocation,
} from './config.js';
import { flattenFields, isSensitiveField, MASKED_VALUE, resolveAppUser, type ResolvedAppUser } from './fields.js';

const SAMPLE_SIZE = 20;

export async function readAppAudienceSettings(): Promise<AppAudienceSettings> {
    const snap = await db.collection('Settings').doc('app_audience').get();
    return snap.exists ? normalizeAppAudienceSettings(snap.data()) : DEFAULT_APP_AUDIENCE_SETTINGS;
}

function requireConfigured(): AppUsersLocation & { configured: true } {
    const location = appUsersLocation();
    if (!location.configured) {
        throw new HttpsError(
            'failed-precondition',
            'No host collection is configured. Run npm run arc:configure -- --app-users-path=<collection>/{id} and deploy the functions.',
        );
    }
    return location as AppUsersLocation & { configured: true };
}

/** Where the host users are (from the deploy) and how they are read (from Settings). */
export const appAudienceStatus = onCall(async (request) => {
    await requireAdmin(request);
    return { location: appUsersLocation(), settings: await readAppAudienceSettings() };
});

export interface SampledField {
    path: string;
    /** Up to three distinct example values. */
    examples: string[];
    /** In how many of the sampled documents the field appears. */
    seenIn: number;
}

/** Every field found in a sample of host documents, for the admin's field pickers. */
export const sampleAppUsers = onCall(async (request): Promise<{ sampleSize: number; fields: SampledField[] }> => {
    await requireAdmin(request);
    const location = requireConfigured();
    const snap = await firestoreFor(location.database).collection(location.collection).limit(SAMPLE_SIZE).get();

    const byPath = new Map<string, SampledField>();
    for (const doc of snap.docs) {
        for (const [path, value] of Object.entries(flattenFields(doc.data()))) {
            const entry = byPath.get(path) ?? { path, examples: [], seenIn: 0 };
            entry.seenIn++;
            if (value && entry.examples.length < 3 && !entry.examples.includes(value)) entry.examples.push(value);
            byPath.set(path, entry);
        }
    }
    const fields = [...byPath.values()].sort((a, b) => b.seenIn - a.seenIn || a.path.localeCompare(b.path));
    return { sampleSize: snap.size, fields };
});

/**
 * One host document read with the given (possibly unsaved) settings, so the admin
 * can check them before saving. `docId` picks a document; otherwise the first one.
 */
export const testAppUser = onCall(async (request): Promise<{ resolved: ResolvedAppUser | null; fields: Record<string, string> }> => {
    await requireAdmin(request);
    const location = requireConfigured();
    const settings = normalizeAppAudienceSettings(request.data?.settings ?? await readAppAudienceSettings());
    const host = firestoreFor(location.database).collection(location.collection);
    const docId = typeof request.data?.docId === 'string' ? request.data.docId.trim() : '';

    const doc = docId
        ? await host.doc(docId).get()
        : (await host.limit(1).get()).docs[0];
    if (!doc?.exists) return { resolved: null, fields: {} };

    const data = doc.data() ?? {};
    const resolved = resolveAppUser(doc.id, data, settings);
    // Credential-like fields never reach the browser, even when picked as a channel.
    const mask = (path: string | undefined, value: string) => (path && isSensitiveField(path) ? MASKED_VALUE : value);
    return {
        resolved: {
            ...resolved,
            key: mask(settings.key.source === 'field' ? settings.key.field : undefined, resolved.key),
            email: mask(settings.emailField, resolved.email),
            phone: mask(settings.phoneField, resolved.phone),
            name: mask(settings.nameField, resolved.name),
        },
        fields: flattenFields(data),
    };
});
