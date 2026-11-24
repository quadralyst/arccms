/** Holds in Firestore (hold.service.ts, specs/visual-editing-spec.md VE-D76 to VE-D84). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

const fire = vi.hoisted(() => ({
    docs: {} as Record<string, any>,
    writes: [] as { op: string; path: string; data?: any }[],
    auto: 0,
}));
vi.mock('@angular/fire/firestore', () => {
    const at = (parts: unknown[]) => parts.map((p: any) => (typeof p === 'string' ? p : p?.path ?? '')).filter(Boolean).join('/');
    const snap = (path: string) => ({ exists: () => path in fire.docs, data: () => fire.docs[path], id: path.split('/').pop() });
    return {
        Firestore: class {},
        doc: (...parts: unknown[]) => {
            const path = at(parts);
            // doc(collection) makes an id; doc(firestore, 'a/b') names one.
            return parts.length === 1 ? { path: `${path}/auto${++fire.auto}`, id: `auto${fire.auto}` } : { path, id: path.split('/').pop() };
        },
        collection: (...parts: unknown[]) => ({ path: at(parts) }),
        query: (ref: object, ...parts: any[]) => ({ ...ref, only: parts.find((part) => part?.field) }),
        where: (field: string, _op: string, value: unknown) => ({ field, value }),
        orderBy: () => null,
        limit: () => null,
        // Both may answer from an open listener's copy, from before the write just made: never read with them.
        getDoc: async () => ({ exists: () => true, data: () => ({ title: 'Stale' }) }),
        getDocFromServer: async () => ({ exists: () => true, data: () => ({ title: 'Stale' }) }),
        getDocsFromServer: async (ref: { path: string; only?: { field: string; value: unknown } }) => ({
            docs: Object.keys(fire.docs).filter((p) => p.startsWith(`${ref.path}/`) && !p.slice(ref.path.length + 1).includes('/'))
                .filter((p) => !ref.only || fire.docs[p][ref.only.field] === ref.only.value)
                .map((p) => ({ id: p.split('/').pop(), data: () => fire.docs[p] })),
        }),
        getDocs: async () => ({ docs: [] }),
        onSnapshot: vi.fn(),
        serverTimestamp: () => 'NOW',
        deleteField: () => 'DELETE',
        runTransaction: async (_f: unknown, run: (tx: unknown) => unknown) => run({
            get: async (ref: { path: string }) => snap(ref.path),
            set: (ref: { path: string }, data: unknown) => fire.writes.push({ op: 'set', path: ref.path, data }),
            update: (ref: { path: string }, data: unknown) => fire.writes.push({ op: 'update', path: ref.path, data }),
            delete: (ref: { path: string }) => fire.writes.push({ op: 'delete', path: ref.path }),
        }),
    };
});
vi.mock('@angular/fire/auth', () => ({ Auth: class {} }));
vi.mock('../../pages/(auth)/auth.store', () => ({ AuthState: class { currentUser = () => ({ name: 'Asha' }); } }));

import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { AuthState } from '../../pages/(auth)/auth.store';
import { HoldService } from './hold.service';

const DRAFT = 'arc_blog_drafts/d1';
const LIVE = 'arc_blog/d1';
const PRIYA = { by: 'priya', name: 'Priya', at: 'T' };

describe('HoldService', () => {
    let holds: HoldService;
    const last = (op: string, path: string) => fire.writes.filter((w) => w.op === op && w.path === path).pop();

    beforeEach(() => {
        fire.docs = {};
        fire.writes = [];
        fire.auto = 0;
        TestBed.configureTestingModule({
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: Auth, useValue: { currentUser: { uid: 'me' } } },
                { provide: AuthState, useValue: { currentUser: () => ({ name: 'Asha' }) } },
            ],
        });
        holds = TestBed.inject(HoldService);
    });

    it('takes over: their draft is kept, whole, and only the hold changes, in one write', async () => {
        fire.docs[DRAFT] = { title: 'Half', editing: PRIYA };
        fire.docs[`${DRAFT}/translations/hi`] = { title: 'आधा' };
        expect(await holds.takeOver(DRAFT, 'priya')).toBe(true);
        const kept = fire.writes.find((w) => w.path.startsWith(`${DRAFT}/Kept/`))!;
        expect(kept.data).toMatchObject({ by: 'priya', name: 'Priya', why: 'takeover', keptBy: 'me', keptByName: 'Asha', data: { title: 'Half' } });
        // Each language on its own, so a long entry in many fits.
        expect('translations' in kept.data).toBe(false);
        expect(last('set', `${kept.path}/translations/hi`)!.data).toEqual({ title: 'आधा', lang: 'hi' });
        expect(last('update', DRAFT)!.data).toEqual({ editing: { by: 'me', name: 'Asha', since: 'NOW', at: 'NOW', kept: kept.path.split('/').pop() } });
    });

    it('reads what a write just left, never an open listener\'s copy (live check 2026-11-24)', async () => {
        fire.docs[DRAFT] = { title: 'Now' };
        expect(await holds.read(DRAFT)).toEqual({ title: 'Now' });
        fire.docs[`${DRAFT}/translations/hi`] = { title: 'अब' };
        expect(await holds.translations(DRAFT)).toEqual({ hi: { title: 'अब' } });
    });

    it('takes over nothing that nobody else holds', async () => {
        fire.docs[DRAFT] = { title: 'A', editing: { by: 'me', name: 'Asha' } };
        expect(await holds.takeOver(DRAFT, 'priya')).toBe(false);
        expect(await holds.takeOver('arc_blog_drafts/none', 'priya')).toBe(false);
        // Someone other than the person shown holds it by now.
        fire.docs[DRAFT].editing = { by: 'ravi', name: 'Ravi' };
        expect(await holds.takeOver(DRAFT, 'priya')).toBe(false);
        expect(fire.writes).toEqual([]);
    });

    it('keeps when the hold began across saves, and starts afresh after someone else', () => {
        const me = { uid: 'me', name: 'Asha' };
        expect(holds.stamp(me, { editing: { by: 'me', since: 'EARLIER' } }, false)).toMatchObject({ editing: { since: 'EARLIER', at: 'NOW' } });
        expect(holds.stamp(me, { editing: PRIYA }, false)).toMatchObject({ editing: { by: 'me', since: 'NOW' } });
        expect(holds.stamp(me, {}, true)).toEqual({ editing: 'DELETE' });
    });

    describe('back to what is live (VE-D83)', () => {
        beforeEach(() => {
            fire.docs[LIVE] = { title: 'Live', summary: 'S', modifiedAt: 'M1', customFields: { price: 5 }, tags: ['x'], tagsWithColors: ['tx'] };
            fire.docs[DRAFT] = { title: 'New', summary: 'S2', status: 'draft', modifiedAt: 'M2', customFields: { price: 6, extra: 'y' }, editing: { by: 'me', name: 'Asha' } };
        });

        it('one change, and the entry stays held while others wait', async () => {
            const [title] = await holds.entryChanges('blog', 'd1', []);
            expect(title.field).toBe('title');
            await holds.restorePublished('blog', 'd1', [], title);
            const data = last('update', DRAFT)!.data;
            expect(data.title).toBe('Live');
            expect(data.summary).toBeUndefined();
            expect(data.editing).toMatchObject({ by: 'me' });
            expect(data.status).toBeUndefined();
        });

        it('everything, and lets go, as published', async () => {
            await holds.restorePublished('blog', 'd1', []);
            const data = last('update', DRAFT)!.data;
            expect(data).toMatchObject({ title: 'Live', summary: 'S', customFields: { price: 5 }, tags: ['x'], tagsWithColors: ['tx'], status: 'publish', editing: 'DELETE', modifiedAt: 'M1', changedOnPage: 'DELETE' });
        });

        it('a translation too: one never published goes, one changed returns', async () => {
            fire.docs[`${DRAFT}/translations/hi`] = { lang: 'hi', title: 'नया' };
            fire.docs[`${LIVE}/translations/hi`] = { lang: 'hi', title: 'पुराना' };
            // As stored: who translated it and when are not words.
            fire.docs[`${DRAFT}/translations/ta`] = { lang: 'ta', title: 'புது', translatedBy: 'me', translatedAt: 'T', customFields: { note: 'x' } };
            await holds.restorePublished('blog', 'd1', []);
            expect(last('set', `${DRAFT}/translations/hi`)!.data.title).toBe('पुराना');
            expect(last('delete', `${DRAFT}/translations/ta`)).toBeTruthy();
        });

        it('never over someone else\'s work, and nothing when nothing is live', async () => {
            fire.docs[DRAFT].editing = PRIYA;
            await expect(holds.restorePublished('blog', 'd1', [])).rejects.toThrow('Priya');
            delete fire.docs[LIVE];
            await expect(holds.restorePublished('blog', 'd1', [])).rejects.toThrow();
            expect(fire.writes).toEqual([]);
        });
    });

    it('restores a kept draft, keeping where the entry stands on the site and what was there', async () => {
        fire.docs[DRAFT] = { title: 'Now', publishedStatus: true, publishedOn: 'P', lastPublishedAt: 'L', sortOrder: 3, editing: { by: 'me', name: 'Asha' } };
        fire.docs[`${DRAFT}/translations/hi`] = { title: 'अब' };
        fire.docs[`${DRAFT}/Kept/k1/translations/ta`] = { title: 'அன்று', lang: 'ta' };
        await holds.restoreKept('blog', 'd1', { id: 'k1', by: 'priya', name: 'Priya', why: 'takeover', data: { title: 'Then', publishedStatus: false, sortOrder: 9, editing: PRIYA, changedOnPage: 'home' } });
        expect(fire.writes.some((w) => w.path.startsWith(`${DRAFT}/Kept/`) && w.data.data.title === 'Now')).toBe(true);
        const data = last('set', DRAFT)!.data;
        expect(data).toMatchObject({ title: 'Then', publishedStatus: true, publishedOn: 'P', lastPublishedAt: 'L', sortOrder: 3, status: 'draft', editing: { by: 'me' } });
        expect('changedOnPage' in data).toBe(false);
        expect(last('delete', `${DRAFT}/translations/hi`)).toBeTruthy();
        expect(last('set', `${DRAFT}/translations/ta`)!.data.title).toBe('அன்று');
    });

    it('a kept draft takes its address back only when no other entry of the type uses it', async () => {
        const kept = { id: 'k1', by: 'me', name: 'Asha', why: 'discard' as const, data: { title: 'Then', urlSlug: 'our-story' } };
        fire.docs[DRAFT] = { title: 'Now', urlSlug: 'our-new-story' };
        fire.docs['arc_blog_drafts/d2'] = { title: 'Other', urlSlug: 'our-story' };
        expect(await holds.restoreKept('blog', 'd1', kept)).toEqual({ addressTaken: true });
        expect(last('set', DRAFT)!.data).toMatchObject({ title: 'Then', urlSlug: 'our-new-story' });
        delete fire.docs['arc_blog_drafts/d2'];
        expect(await holds.restoreKept('blog', 'd1', kept)).toEqual({ addressTaken: false });
        expect(last('set', DRAFT)!.data).toMatchObject({ title: 'Then', urlSlug: 'our-story' });
    });

    describe('letting go (VE-D76)', () => {
        const live = { title: 'Live', modifiedAt: 'M1' };
        const mine = { title: 'Live', publishedStatus: true, modifiedAt: 'M2', editing: { by: 'me', name: 'Asha' } };

        it('only by the holder, only when nothing differs, as it was published', async () => {
            fire.docs[LIVE] = live;
            fire.docs[DRAFT] = mine;
            expect(await holds.letGo('blog', 'd1', [])).toBe('M1');
            expect(last('update', DRAFT)!.data).toEqual({ editing: 'DELETE', changedOnPage: 'DELETE', status: 'publish', modifiedAt: 'M1' });
        });

        it('not when something differs, someone else holds it, or it was unpublished', async () => {
            fire.docs[LIVE] = live;
            for (const draft of [{ ...mine, title: 'New' }, { ...mine, nextContent: { id: 'x' } }, { ...mine, editing: PRIYA }, { ...mine, publishedStatus: false }]) {
                fire.docs[DRAFT] = draft;
                expect(await holds.letGo('blog', 'd1', [])).toBeNull();
            }
            delete fire.docs[LIVE];
            fire.docs[DRAFT] = mine;
            expect(await holds.letGo('blog', 'd1', [])).toBeNull();
            expect(fire.writes).toEqual([]);
        });
    });

    it('Publish these changes nothing of theirs but where it stands', async () => {
        fire.docs[DRAFT] = { title: 'Theirs', modifiedAt: 'M2', publishedOn: 'P', editing: PRIYA };
        await holds.markPublished(DRAFT);
        expect(last('update', DRAFT)!.data).toEqual({ status: 'publish', publishedStatus: true, publishedOn: 'P' });
    });
});
