/**
 * Phone sign-in's Google Cloud setup (functions/src/auth/signInSetup.ts): the Token Creator
 * role and the IAM Credentials API that signing a sign-in token needs.
 *
 * - a signing failure is named, and the person signing in is told phone sign-in is not
 *   ready instead of "Something went wrong"
 * - the admins are told how to fix it, once a day at most
 * - the admin check (checkPhoneSignIn) finds it before anyone signs in, with the fix
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({
    createCustomToken: vi.fn(async (uid: string) => `token-${uid}`),
    getUser: vi.fn(async (uid: string) => ({ uid, customClaims: {} })),
}));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string, public details?: unknown) {
            super(message);
        }
    },
}));

import { db } from '../init.js';
import { issueSignInToken } from '../auth/accounts.js';
import { checkPhoneSignIn, CHECK_UID } from '../auth/phoneSignInCheck.js';
import { ALERT_DOC, SIGN_IN_NOT_READY, fixFor, signingProblem } from '../auth/signInSetup.js';
import { resetRuntimeIdentityForTests } from '../utils/runtimeIdentity.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const SA = '449144539409-compute@developer.gserviceaccount.com';

/** What the Admin SDK throws when the role is missing, and when the API is off. */
const NO_ROLE = Object.assign(
    new Error("Permission 'iam.serviceAccounts.signBlob' denied on resource (or it may not exist).; Please refer to https://firebase.google.com/docs/auth/admin/create-custom-tokens for more details."),
    { code: 'auth/insufficient-permission' },
);
const API_OFF = Object.assign(
    new Error('IAM Service Account Credentials API has not been used in project 449144539409 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/iamcredentials.googleapis.com/overview?project=449144539409'),
    { code: 'auth/insufficient-permission' },
);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

type Handler = (request: unknown) => Promise<any>;
const asAdmin = () => (checkPhoneSignIn as unknown as Handler)({ data: {}, auth: { uid: 'admin-uid', token: { arccms_role: 'admin' } } });

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    resetRuntimeIdentityForTests();
    process.env.GCLOUD_PROJECT = 'sanskrit-app-live';
    owner.createCustomToken.mockImplementation(async (uid: string) => `token-${uid}`);
    mockFetch.mockImplementation(async (url: string) => ({
        ok: true, status: 200, text: async () => (url.endsWith('/email') ? SA : 'sanskrit-app-live'),
    }));
    mem.seed('users', 'a1', { uid: 'admin-uid', role: 'admin' });
    mem.seed('users', 'u1', { uid: 'parent-uid', role: 'user' });
});

describe('signingProblem', () => {
    it('names a missing role and a turned-off API, and nothing else', () => {
        expect(signingProblem(NO_ROLE)).toBe('token-creator-missing');
        expect(signingProblem(API_OFF)).toBe('api-disabled');
        expect(signingProblem({ errorInfo: { code: 'auth/insufficient-permission' }, message: 'denied' })).toBe('token-creator-missing');
        expect(signingProblem(new Error('network down'))).toBeNull();
        expect(signingProblem(undefined)).toBeNull();
    });
});

describe('fixFor', () => {
    it('grants the role on the service account itself, for this project', () => {
        const fix = fixFor('token-creator-missing', 'sanskrit-app-live', SA);
        expect(fix.command).toBe(
            `gcloud iam service-accounts add-iam-policy-binding ${SA} --member=serviceAccount:${SA} `
            + '--role=roles/iam.serviceAccountTokenCreator --project=sanskrit-app-live');
        expect(fix.consoleUrl).toBe('https://console.cloud.google.com/iam-admin/iam?project=sanskrit-app-live');
    });

    it('turns the API on', () => {
        const fix = fixFor('api-disabled', 'sanskrit-app-live', SA);
        expect(fix.command).toBe('gcloud services enable iamcredentials.googleapis.com --project=sanskrit-app-live');
        expect(fix.consoleUrl).toContain('apis/library/iamcredentials.googleapis.com?project=sanskrit-app-live');
    });

    it('leaves a placeholder rather than a broken command when the account is unknown', () => {
        expect(fixFor('token-creator-missing', '', '').command).toContain('PROJECT_NUMBER-compute@developer.gserviceaccount.com');
    });
});

describe('issueSignInToken', () => {
    it('signs a token as before when the setup is right', async () => {
        await expect(issueSignInToken('parent-uid')).resolves.toBe('token-parent-uid');
    });

    it('tells the person phone sign-in is not ready, not "Something went wrong"', async () => {
        owner.createCustomToken.mockRejectedValue(NO_ROLE);
        await expect(issueSignInToken('parent-uid')).rejects.toMatchObject({
            code: 'failed-precondition', message: SIGN_IN_NOT_READY, details: { reason: 'sign-in-not-ready' },
        });
    });

    it('tells every admin how to fix it, with the account and a link to User Settings', async () => {
        owner.createCustomToken.mockRejectedValue(NO_ROLE);
        await issueSignInToken('parent-uid').catch(() => undefined);
        const sent = mem.all('Notifications').map((n) => n.data);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ userId: 'admin-uid', type: 'admin_sign_in_setup', link: '/admin/settings/user' });
        expect(sent[0]['body']).toContain(SA);
        expect(sent[0]['body']).toContain('Token Creator');
    });

    it('alerts once a day, not on every failed sign-in', async () => {
        owner.createCustomToken.mockRejectedValue(NO_ROLE);
        await issueSignInToken('parent-uid').catch(() => undefined);
        await issueSignInToken('parent-uid').catch(() => undefined);
        expect(mem.all('Notifications')).toHaveLength(1);
        mem.seed(ALERT_DOC.collection, ALERT_DOC.doc, { alertedAt: { toMillis: () => Date.now() - 25 * 60 * 60 * 1000 } });
        await issueSignInToken('parent-uid').catch(() => undefined);
        expect(mem.all('Notifications')).toHaveLength(2);
    });

    it('passes any other error through unchanged', async () => {
        const other = new Error('network down');
        owner.createCustomToken.mockRejectedValue(other);
        await expect(issueSignInToken('parent-uid')).rejects.toBe(other);
        expect(mem.all('Notifications')).toHaveLength(0);
    });
});

describe('checkPhoneSignIn', () => {
    it('is for admins only', async () => {
        await expect((checkPhoneSignIn as unknown as Handler)({ data: {}, auth: { uid: 'parent-uid', token: {} } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('signs a throwaway token and reports ready, with the SMS provider', async () => {
        mem.seed('Settings', 'sms', { provider: 'msg91' });
        await expect(asAdmin()).resolves.toEqual({ ready: true, smsProvider: 'msg91' });
        expect(owner.createCustomToken).toHaveBeenCalledWith(CHECK_UID);
    });

    it('reports the missing role with the fix for this project', async () => {
        owner.createCustomToken.mockRejectedValue(NO_ROLE);
        const result = await asAdmin();
        expect(result).toMatchObject({
            ready: false, smsProvider: 'log', problem: 'token-creator-missing', serviceAccount: SA, project: 'sanskrit-app-live',
        });
        expect(result.command).toContain('roles/iam.serviceAccountTokenCreator');
        expect(mem.all('Notifications')).toHaveLength(0); // the admin is looking at it already
    });

    it('reports a turned-off API', async () => {
        owner.createCustomToken.mockRejectedValue(API_OFF);
        await expect(asAdmin()).resolves.toMatchObject({ ready: false, problem: 'api-disabled' });
    });

    it('says it could not check on any other error', async () => {
        owner.createCustomToken.mockRejectedValue(new Error('network down'));
        await expect(asAdmin()).rejects.toMatchObject({ code: 'internal' });
    });
});
