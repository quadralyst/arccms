/**
 * adminDeleteForm: the form, its sign-ups and its tags go together, admins only.
 *
 * Order matters: tags, then the form document, then everything under the form.
 * With the form gone first, onWaitlistUserDeleted (email-core/contactSync.ts)
 * skips its per-sign-up list write and the form's list goes once, in
 * onWaitlistsDelete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAdmin, recursiveDelete, docDelete, counts, form, steps } = vi.hoisted(() => ({
    requireAdmin: vi.fn(),
    recursiveDelete: vi.fn(),
    docDelete: vi.fn(),
    counts: {} as Record<string, number>,
    form: { exists: true, existedWhenSignupsWent: null as boolean | null },
    steps: [] as string[],
}));

/** A tiny Firestore stand-in that knows paths, counts and both kinds of delete. */
function collection(path: string): any {
    return {
        path,
        doc: (id: string) => document(`${path}/${id}`),
        count: () => ({ get: async () => ({ data: () => ({ count: counts[path] ?? 0 }) }) }),
    };
}
function document(path: string): any {
    return {
        path,
        collection: (name: string) => collection(`${path}/${name}`),
        get: async () => ({ exists: form.exists }),
        delete: async () => {
            steps.push(`delete ${path}`);
            await docDelete(path);
            form.exists = false;
        },
    };
}

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => collection(name),
        recursiveDelete: async (ref: { path: string }) => {
            steps.push(`everything under ${ref.path}`);
            if (ref.path === 'Waitlists/spring') form.existedWhenSignupsWent = form.exists;
            await recursiveDelete(ref.path);
        },
    },
}));
vi.mock('../search/auth', () => ({ requireAdmin }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (options: unknown, handler?: Function) => handler ?? options,
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    },
}));

import { adminDeleteForm, formTagsCollection } from './adminDeleteForm.js';

const call = (data: unknown) => (adminDeleteForm as unknown as Function)({ auth: { uid: 'a1', token: {} }, data });

describe('adminDeleteForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        steps.length = 0;
        for (const key of Object.keys(counts)) delete counts[key];
        form.exists = true;
        form.existedWhenSignupsWent = null;
        requireAdmin.mockResolvedValue(undefined);
        recursiveDelete.mockResolvedValue(undefined);
        docDelete.mockResolvedValue(undefined);
    });

    it('deletes the tags, then the form, then the sign-ups under it, and says how many', async () => {
        counts['Waitlists/spring/users'] = 1203;
        counts['WaitlistUserTags_spring'] = 4;
        const result = await call({ formId: 'spring' });
        expect(steps).toEqual([
            'everything under WaitlistUserTags_spring',
            'delete Waitlists/spring',
            'everything under Waitlists/spring',
        ]);
        expect(result).toEqual({ deleted: true, signups: 1203, tags: 4 });
    });

    it('the form is gone before any sign-up goes, so the sign-up trigger stands down', async () => {
        counts['Waitlists/spring/users'] = 3;
        await call({ formId: 'spring' });
        expect(form.existedWhenSignupsWent).toBe(false);
    });

    it('skips tags when there are none', async () => {
        const result = await call({ formId: 'spring' });
        expect(steps).toEqual(['delete Waitlists/spring', 'everything under Waitlists/spring']);
        expect(result).toEqual({ deleted: true, signups: 0, tags: 0 });
    });

    it('a failure deleting the tags leaves the form listed, so Delete can be pressed again', async () => {
        counts['WaitlistUserTags_spring'] = 2;
        recursiveDelete.mockRejectedValueOnce(new Error('deadline'));
        await expect(call({ formId: 'spring' })).rejects.toThrow('deadline');
        expect(steps).toEqual(['everything under WaitlistUserTags_spring']);
        expect(form.exists).toBe(true);
    });

    it('calling again after the form is gone finishes the sign-ups', async () => {
        form.exists = false;
        counts['Waitlists/spring/users'] = 40;
        const result = await call({ formId: 'spring' });
        expect(steps).toEqual(['everything under Waitlists/spring']);
        expect(result).toEqual({ deleted: false, signups: 40, tags: 0 });
    });

    it('is for admins only', async () => {
        requireAdmin.mockRejectedValue(Object.assign(new Error('Admin access required.'), { code: 'permission-denied' }));
        await expect(call({ formId: 'spring' })).rejects.toThrow('Admin access required.');
        expect(steps).toEqual([]);
    });

    it('refuses a missing id or a path', async () => {
        await expect(call({})).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ formId: 'a/b' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ formId: '  ' })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(steps).toEqual([]);
    });

    it('names the tags collection the admin uses', () => {
        expect(formTagsCollection('spring')).toBe('WaitlistUserTags_spring');
    });
});
