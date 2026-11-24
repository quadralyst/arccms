/**
 * Work that changes hands in the editors (specs/visual-editing-spec.md, VE-D82,
 * VE-D84): the person taken over from is told once, and ten kept drafts stay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    kept: {} as Record<string, string[]>,
    deleted: [] as string[],
    notified: vi.fn(async (_n: any) => 'id'),
    types: {} as Record<string, string>,
    path: '',
}));

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => ({
            where: (_f: string, _o: string, slug: string) => ({ limit: () => ({ get: async () => ({
                empty: !m.types[slug], docs: m.types[slug] ? [{ data: () => ({ name: m.types[slug] }) }] : [],
            }) }) }),
            doc: (id: string) => ({ collection: (sub: string) => ({ orderBy: (field: string, dir: string) => ({ offset: (n: number) => ({ get: async () => {
                expect([sub, field, dir]).toEqual(['Kept', 'keptAt', 'desc']);
                const docs = (m.kept[`${name}/${id}`] ?? []).slice(n).map((k) => ({ ref: { path: `${name}/${id}/Kept/${k}` } }));
                return { empty: !docs.length, docs };
            } }) }) }) }),
        }),
        // Each with the languages kept under it.
        recursiveDelete: async (ref: { path: string }) => { m.deleted.push(ref.path); },
    },
}));
vi.mock('../arc-config.js', () => ({ arcDocument: (path: string) => { m.path = path; return path; } }));
vi.mock('../email-core/notifications.js', () => ({ createNotification: m.notified }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_o: unknown, handler: unknown) => handler }));

import { KEPT_DRAFTS, onDraftKept } from '../draftContent/onDraftKept.js';

const handler = onDraftKept as unknown as (e: unknown) => Promise<void>;
const event = (collection: string, docId: string, kept: Record<string, unknown>, keptId = 'k0') => ({
    params: { collection, docId, keptId }, data: { data: () => kept },
});
const TAKEN = { why: 'takeover', by: 'priya-uid', name: 'Priya', keptBy: 'asha-uid', keptByName: 'Asha', data: { title: 'Our story' } };

describe('onDraftKept', () => {
    beforeEach(() => {
        m.kept = {};
        m.deleted = [];
        m.types = {};
        m.notified.mockReset().mockResolvedValue('id');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('watches the kept drafts alone, never every write', () => {
        expect(m.path).toBe('{collection}/{docId}/Kept/{keptId}');
    });

    it('tells the person an entry was taken over from, with who, what and where', async () => {
        await handler(event('arc_articles_drafts', 'd1', TAKEN));
        expect(m.notified).toHaveBeenCalledTimes(1);
        expect(m.notified).toHaveBeenCalledWith({
            id: 'kept-d1-k0', userId: 'priya-uid', type: 'draft_taken_over', title: 'Asha took over "Our story"',
            body: 'Your changes are kept in History.', link: '/admin/edit/articles/d1', createdBy: 'system',
        });
    });

    it('names each kind of page, and opens it', async () => {
        m.types = { articles: 'Articles' };
        const said = async (pageId: string) => {
            m.notified.mockClear();
            await handler(event('SitePageTextDrafts', pageId, { ...TAKEN, data: { text: {} } }));
            return m.notified.mock.calls.map(([n]) => [n.title, n.link])[0];
        };
        expect(await said('home')).toEqual(['Asha took over the home page', '/admin/edit-page/home']);
        expect(await said('p-about')).toEqual(['Asha took over the page about', '/admin/edit-page/p/about']);
        expect(await said('list-articles')).toEqual(['Asha took over the Articles list page', '/admin/edit-page/list/articles']);
        expect(await said('list-gone')).toEqual(['Asha took over the gone list page', '/admin/edit-page/list/gone']);
    });

    it('tells nobody of a discard, of a take over of one\'s own work, or of a document that is not a draft', async () => {
        await handler(event('arc_articles_drafts', 'd1', { ...TAKEN, why: 'discard' }));
        await handler(event('arc_articles_drafts', 'd1', { ...TAKEN, by: 'asha-uid' }));
        await handler(event('arc_articles_drafts', 'd1', { ...TAKEN, by: '' }));
        await handler(event('arc_articles', 'd1', TAKEN));
        await handler(event('Invoices', 'd1', TAKEN));
        await handler(event('SitePageTextDrafts', 'nonsense', TAKEN));
        expect(m.notified).not.toHaveBeenCalled();
    });

    it('says something when a name or a title is missing, and cuts long ones', async () => {
        await handler(event('arc_articles_drafts', 'd1', { ...TAKEN, keptByName: '', data: {} }));
        expect(m.notified.mock.calls[0][0].title).toBe('Someone took over an entry with no title');
        await handler(event('arc_articles_drafts', 'd1', { ...TAKEN, data: { title: 'x'.repeat(500) } }));
        expect(m.notified.mock.calls[1][0].title.length).toBeLessThan(200);
    });

    it.each(['takeover', 'discard'])('keeps the newest ten drafts after a %s, and again when the event comes twice', async (why) => {
        const ids = Array.from({ length: 13 }, (_, i) => `k${i}`);
        m.kept['arc_articles_drafts/d1'] = ids;
        const e = event('arc_articles_drafts', 'd1', { ...TAKEN, why });
        await handler(e);
        expect(m.deleted).toEqual(ids.slice(KEPT_DRAFTS).map((k) => `arc_articles_drafts/d1/Kept/${k}`));
        m.kept['arc_articles_drafts/d1'] = ids.slice(0, KEPT_DRAFTS);
        m.deleted = [];
        await handler(e);
        expect(m.deleted).toEqual([]);
    });

    it('prunes a page\'s kept drafts too, and still does when the notice fails', async () => {
        m.notified.mockRejectedValue(new Error('offline'));
        m.kept['SitePageTextDrafts/home'] = Array.from({ length: 11 }, (_, i) => `k${i}`);
        await handler(event('SitePageTextDrafts', 'home', TAKEN));
        expect(m.deleted).toEqual(['SitePageTextDrafts/home/Kept/k10']);
    });

    it('its notification type is in the registry, in the app and not by email', async () => {
        const { DEFAULT_NOTIFICATION_TYPES } = await vi.importActual<typeof import('../email-core/notifications.js')>('../email-core/notifications.js');
        expect(DEFAULT_NOTIFICATION_TYPES['draft_taken_over']).toMatchObject({ enabled: true, defaultChannels: { inApp: true, email: false } });
    });
});

describe('createNotification with an id', () => {
    it('writes it once, however often it is asked', async () => {
        const create = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 6 }))
            .mockRejectedValueOnce(Object.assign(new Error('down'), { code: 14 }));
        const { db } = await import('../init.js');
        vi.spyOn(db, 'collection').mockReturnValue({ doc: (id: string) => ({ id, create }) } as any);
        const { createNotification } = await vi.importActual<typeof import('../email-core/notifications.js')>('../email-core/notifications.js');
        const ask = () => createNotification({ id: 'kept-1', userId: 'u', type: 'draft_taken_over', title: 'T', body: 'B' });
        expect(await ask()).toBe('kept-1');
        expect(await ask()).toBe('kept-1');
        await expect(ask()).rejects.toThrow('down');
        vi.restoreAllMocks();
    });
});
