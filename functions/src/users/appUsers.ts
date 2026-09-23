/**
 * App users: people who sign in to a host app, not to ArcCMS
 * (docs/coexistence-spec.md, CO-D12, CO-D13, CO-D16, CO6).
 *
 * When ArcCMS is the backend for another app in the same Firebase project, that
 * app's users already have Firebase Auth accounts. ArcCMS never creates or
 * deletes those accounts. It keeps a `users` document for each, so payments,
 * entitlements, contacts, drips and notifications have somewhere to attach, and
 * it marks the document `authOwner: 'host'`.
 *
 * Two ways in:
 * - `ensureAppUser`: the host app calls it after each sign-in, as the user.
 * - `importAppUsers`: an admin brings in accounts that existed before ArcCMS was
 *   installed (or that the host app never registered).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { upsertContact } from '../email-core/contacts.js';
import { setContactFields } from '../email-core/contactFields.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';

/** Who owns a user's Firebase Auth account. A document without the field is `arccms`. */
export const AUTH_OWNER = { ARCCMS: 'arccms', HOST: 'host' } as const;
export type AuthOwner = typeof AUTH_OWNER[keyof typeof AUTH_OWNER];

/** Whether ArcCMS may delete this user's Auth account (it may not delete a host app's). */
export function arccmsOwnsAuthAccount(userDoc: Record<string, unknown> | undefined): boolean {
    return userDoc?.['authOwner'] !== AUTH_OWNER.HOST;
}

const MAX_NAME = 200;
const MAX_ATTRIBUTES = 30;

function cleanString(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanLanguage(value: unknown): string {
    const lang = cleanString(value, 16).toLowerCase();
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang) ? lang : '';
}

/** Attribute values a contact field can hold; anything else is dropped. */
function cleanAttributes(value: unknown): Record<string, string | number | boolean> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string | number | boolean> = {};
    for (const [key, v] of Object.entries(value).slice(0, MAX_ATTRIBUTES)) {
        if (typeof v === 'string') out[key] = v.slice(0, 1000);
        else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
        else if (typeof v === 'boolean') out[key] = v;
    }
    return out;
}

/** What the host app gets back: enough to gate features without a second read. */
export interface AppUserState {
    userId: string;
    created: boolean;
    isPro: boolean;
    premiumType: string | null;
    premiumStatus: string | null;
    premiumExpiresAt: string | null;
    creditBalance: number;
}

function stateFrom(docId: string, data: Record<string, unknown>, created: boolean): AppUserState {
    const expires = data['premiumExpiresAt'] as { toDate?: () => Date } | undefined;
    return {
        userId: docId,
        created,
        isPro: data['isPro'] === true,
        premiumType: (data['premiumType'] as string) || null,
        premiumStatus: (data['premiumStatus'] as string) || null,
        premiumExpiresAt: expires?.toDate ? expires.toDate().toISOString() : null,
        creditBalance: typeof data['creditBalance'] === 'number' ? data['creditBalance'] : 0,
    };
}

/**
 * The host app registers its signed-in user with ArcCMS, and learns their
 * entitlement back. Safe to call on every sign-in.
 *
 * Identity comes from the verified token, never from the request: the caller
 * cannot register someone else's email. The role is always `user` on creation
 * and never changed here. Only name, email, verification, language and
 * `lastSeenAt` are refreshed on later calls.
 *
 * Request (all optional): `name`, `language`, `attributes` (contact fields,
 * written only for keys defined in Audience, Fields).
 */
export const ensureAppUser = onCall(async (request): Promise<AppUserState> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const { uid, token } = request.auth;
    const email = cleanString(token.email, 254).toLowerCase();
    if (!email) {
        throw new HttpsError('failed-precondition', 'This account has no email address, so it cannot be an ArcCMS user.');
    }

    const data = (request.data ?? {}) as Record<string, unknown>;
    const name = cleanString(data['name'], MAX_NAME) || cleanString(token['name'], MAX_NAME);
    const language = cleanLanguage(data['language']);
    const attributes = cleanAttributes(data['attributes']);
    const emailVerified = token.email_verified === true;
    const now = Timestamp.now();

    // In a transaction: a host app that calls this twice at sign-in must not
    // end up with two documents for one person.
    const result = await db.runTransaction(async (tx) => {
        const existing = await tx.get(db.collection('users').where('uid', '==', uid).limit(1));
        if (!existing.empty) {
            const snap = existing.docs[0];
            const current = snap.data();
            const patch: Record<string, unknown> = { lastSeenAt: now, emailVerified };
            if (current['email'] !== email) patch['email'] = email;
            if (name && !current['name']) patch['name'] = name;
            if (language) patch['preferredLanguage'] = language;
            tx.update(snap.ref, patch);
            return stateFrom(snap.id, { ...current, ...patch }, false);
        }

        const ref = db.collection('users').doc();
        const doc = {
            id: ref.id,
            uid,
            email,
            name,
            emailVerified,
            role: 'user',
            status: 'Active',
            isActive: true,
            authOwner: AUTH_OWNER.HOST,
            source: 'app',
            ...(language ? { preferredLanguage: language } : {}),
            createdAt: now,
            modifiedAt: now,
            createdBy: 'ensureAppUser',
            lastSeenAt: now,
        };
        tx.create(ref, doc);
        return stateFrom(ref.id, doc, true);
    });

    if (Object.keys(attributes).length) {
        try {
            // The contact normally arrives through the users trigger a moment
            // later; create it now so the attributes have somewhere to land.
            await upsertContact({ email, name, userId: uid, source: 'signup' });
            const written = await setContactFields(computeEmailHash(email), attributes);
            if (written.unknown.length) {
                logger.info(`ensureAppUser: ignored attributes with no contact field: ${written.unknown.join(', ')}`);
            }
        } catch (err) {
            logger.warn('ensureAppUser: could not write contact attributes', err);
        }
    }

    return result;
});

export interface ImportAppUsersResult {
    dryRun: boolean;
    /** Auth accounts looked at. */
    scanned: number;
    /** Accounts that got (or would get) a users document. */
    imported: number;
    /** Accounts that already have one. */
    alreadyPresent: number;
    /** Accounts skipped because they have no email address (anonymous, phone-only). */
    skippedNoEmail: number;
    /** Welcome emails this run sends (or would send). */
    welcomeEmails: number;
}

/**
 * Admin: give every Firebase Auth account in the project that has no `users`
 * document one, as an app user (`authOwner: 'host'`). For accounts made before
 * ArcCMS was installed, or that the host app never registered.
 *
 * Request: `sendWelcome` (default false: importing thousands of existing users
 * must not email them all by accident) and `dryRun` (count only). Each document
 * records `importedAt` and `sendWelcome`, which the user triggers read.
 */
export const importAppUsers = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request): Promise<ImportAppUsersResult> => {
    await requireAdmin(request);
    const sendWelcome = request.data?.sendWelcome === true;
    const dryRun = request.data?.dryRun === true;

    const known = new Set<string>();
    const usersSnap = await db.collection('users').select('uid').get();
    for (const doc of usersSnap.docs) {
        const uid = doc.get('uid');
        if (typeof uid === 'string' && uid) known.add(uid);
    }

    const result: ImportAppUsersResult = {
        dryRun, scanned: 0, imported: 0, alreadyPresent: 0, skippedNoEmail: 0, welcomeEmails: 0,
    };
    const now = Timestamp.now();
    let batch = db.batch();
    let pending = 0;

    let pageToken: string | undefined;
    do {
        const page = await owner.listUsers(1000, pageToken);
        for (const account of page.users) {
            result.scanned++;
            if (known.has(account.uid)) { result.alreadyPresent++; continue; }
            const email = (account.email || '').toLowerCase();
            if (!email) { result.skippedNoEmail++; continue; }

            result.imported++;
            if (sendWelcome) result.welcomeEmails++;
            if (dryRun) continue;

            const ref = db.collection('users').doc();
            batch.create(ref, {
                id: ref.id,
                uid: account.uid,
                email,
                name: account.displayName || '',
                emailVerified: account.emailVerified === true,
                role: 'user',
                status: 'Active',
                isActive: true,
                authOwner: AUTH_OWNER.HOST,
                source: 'import',
                importedAt: now,
                sendWelcome,
                createdAt: now,
                modifiedAt: now,
                createdBy: 'importAppUsers',
            });
            known.add(account.uid);
            if (++pending === 400) {
                await batch.commit();
                batch = db.batch();
                pending = 0;
            }
        }
        pageToken = page.pageToken;
    } while (pageToken);

    if (pending) await batch.commit();

    if (!dryRun && result.imported) {
        // One notice for the run, instead of one "New signup" per imported user.
        await notifyAdmins('admin_new_signup', {
            title: 'App users imported',
            body: `Imported ${result.imported} app user${result.imported === 1 ? '' : 's'}`
                + (sendWelcome ? ', with welcome emails.' : ', without welcome emails.'),
            link: '/admin/users',
        });
    }
    logger.info('importAppUsers', result);
    return result;
});

/** For the users triggers: whether a user document came from `importAppUsers`. */
export function isImportedUser(userDoc: Record<string, unknown> | undefined): boolean {
    return !!userDoc?.['importedAt'];
}
