/**
 * Audience, App users (docs/coexistence-spec.md 5b, CO6.3): the host app's users,
 * read live from their own collection with the admin's settings, plus ArcCMS's
 * own state for each. Nothing read here is stored.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, firestoreFor } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { appUsersLocation } from './config.js';
import { readAppAudienceSettings } from './adminCallables.js';
import { flattenFields, maskResolvedAppUser, resolveAppUser } from './fields.js';
import { APP_AUDIENCE_STATE, appUserStateId, stateFrom, type AppUserState } from './state.js';

/** A host app is expected to have hundreds of users; beyond this the list is cut short, and says so. */
export const MAX_APP_USERS = 2000;

export interface AppUserRow {
    docId: string;
    key: string;
    email: string;
    phone: string;
    name: string;
    consent: AppUserState['consent'];
}

export interface AppUserList {
    rows: AppUserRow[];
    /** Documents read from the host collection. */
    scanned: number;
    /** Documents skipped because their unique key is empty. */
    withoutKey: number;
    /** True when the host collection has more than MAX_APP_USERS documents. */
    truncated: boolean;
}

function requireLocation() {
    const location = appUsersLocation();
    if (!location.configured) {
        throw new HttpsError('failed-precondition', 'No host collection is configured. See Settings, App audience.');
    }
    return location;
}

async function readStates(keys: string[]): Promise<Map<string, AppUserState>> {
    const states = new Map<string, AppUserState>();
    for (let i = 0; i < keys.length; i += 100) {
        const chunk = keys.slice(i, i + 100);
        const refs = chunk.map((key) => db.collection(APP_AUDIENCE_STATE).doc(appUserStateId(key)));
        const snaps = refs.length ? await db.getAll(...refs) : [];
        snaps.forEach((snap, j) => states.set(chunk[j], stateFrom(snap.exists ? snap.data() : undefined)));
    }
    return states;
}

/** Every app user, optionally narrowed by a search over key, email, phone and name. */
export const listAppUsers = onCall(async (request): Promise<AppUserList> => {
    await requireAdmin(request);
    const location = requireLocation();
    const settings = await readAppAudienceSettings();
    const search = typeof request.data?.search === 'string' ? request.data.search.trim().toLowerCase() : '';

    const snap = await firestoreFor(location.database).collection(location.collection).limit(MAX_APP_USERS + 1).get();
    const truncated = snap.size > MAX_APP_USERS;
    const docs = snap.docs.slice(0, MAX_APP_USERS);

    let withoutKey = 0;
    const people = [];
    for (const doc of docs) {
        const person = resolveAppUser(doc.id, doc.data(), settings);
        if (!person.key) { withoutKey++; continue; }
        // Search what the admin can see, so a hidden value is never matched.
        const shown = maskResolvedAppUser(person, settings);
        if (search && ![shown.key, shown.email, shown.phone, shown.name].some((v) => v.toLowerCase().includes(search))) continue;
        people.push({ key: person.key, shown });
    }

    const states = await readStates(people.map((p) => p.key));
    const rows = people
        .map(({ key, shown }) => ({ ...shown, consent: (states.get(key) ?? stateFrom(undefined)).consent }))
        .sort((a, b) => (a.name || a.email || a.key).localeCompare(b.name || b.email || b.key));

    return { rows, scanned: docs.length, withoutKey, truncated };
});

/** One app user: every host field (credential-like values hidden) and ArcCMS's state. */
export const getAppUser = onCall(async (request) => {
    await requireAdmin(request);
    const location = requireLocation();
    const docId = typeof request.data?.docId === 'string' ? request.data.docId.trim() : '';
    if (!docId) throw new HttpsError('invalid-argument', 'docId is required.');

    const doc = await firestoreFor(location.database).collection(location.collection).doc(docId).get();
    if (!doc.exists) throw new HttpsError('not-found', 'That app user no longer exists in the host collection.');

    const settings = await readAppAudienceSettings();
    const data = doc.data() ?? {};
    const person = resolveAppUser(doc.id, data, settings);
    const state = person.key ? (await readStates([person.key])).get(person.key) : undefined;
    return { person: maskResolvedAppUser(person, settings), fields: flattenFields(data), state: state ?? stateFrom(undefined) };
});
