/**
 * Page text in the app (page-text.service.ts, specs/visual-editing-spec.md
 * VE-D39, VE-D52, VE-D57): the published copy for the pages the app draws, and
 * the editors' draft saved a field at a time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';

const fire = vi.hoisted(() => ({
    getDoc: vi.fn(),
    updateDoc: vi.fn(),
    setDoc: vi.fn(),
    onSnapshot: vi.fn(),
}));
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    doc: (_fs: unknown, collection: string, id: string) => `${collection}/${id}`,
    getDoc: (...args: unknown[]) => fire.getDoc(...args),
    updateDoc: (...args: unknown[]) => fire.updateDoc(...args),
    setDoc: (...args: unknown[]) => fire.setDoc(...args),
    onSnapshot: (...args: unknown[]) => fire.onSnapshot(...args),
    serverTimestamp: () => 'NOW',
    deleteField: () => 'DELETE',
}));
vi.mock('@angular/fire/auth', () => ({ Auth: class {} }));

import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { PublishQueueService } from '../../pages/admin/contents/publish-queue/publish-queue.service';
import { PageTextService, hasUnpublishedChanges, type PageTextSession } from './page-text.service';

const auth = { currentUser: { uid: 'editor-uid' } as { uid: string } | null };
const queue = { publishPageText: vi.fn(async (_id: string) => undefined) };
const stamp = { updatedAt: 'NOW', updatedBy: 'editor-uid' };
const notFound = Object.assign(new Error('No document to update'), { code: 'not-found' });

describe('PageTextService', () => {
    let service: PageTextService;

    beforeEach(() => {
        vi.clearAllMocks();
        auth.currentUser = { uid: 'editor-uid' };
        fire.updateDoc.mockResolvedValue(undefined);
        fire.setDoc.mockResolvedValue(undefined);
        TestBed.configureTestingModule({
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: Auth, useValue: auth },
                { provide: PublishQueueService, useValue: queue },
            ],
        });
        service = TestBed.inject(PageTextService);
    });

    describe('the published copy', () => {
        it('reads it for a page', async () => {
            fire.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ text: { en: {} } }) });
            expect(await service.published('home')).toEqual({ text: { en: {} } });
            expect(fire.getDoc).toHaveBeenCalledWith('SitePageText/home');
        });

        it('is null when there is none, the id names no page, or it cannot be read', async () => {
            fire.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
            expect(await service.published('p-about-us')).toBeNull();
            expect(await service.published('about')).toBeNull();
            expect(fire.getDoc).toHaveBeenCalledTimes(1);
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            fire.getDoc.mockRejectedValueOnce(new Error('offline'));
            expect(await service.published('home')).toBeNull();
        });
    });

    describe('a session on the draft', () => {
        let session: PageTextSession;
        beforeEach(() => {
            session = service.session('home');
        });

        it('saves one area\'s words as a field of its own, with the file\'s and the source\'s text', async () => {
            await session.saveText('hi', 'hero', 'नमस्ते', { fileText: 'Hello', sourceText: 'Hi all' });
            expect(fire.updateDoc).toHaveBeenCalledWith('SitePageTextDrafts/home', {
                'text.hi.hero': { value: 'नमस्ते', by: 'editor-uid', at: 'NOW', fileText: 'Hello', sourceText: 'Hi all' },
                ...stamp,
            });
        });

        it('saves addresses, SEO words and the share image as fields of their own', async () => {
            await session.saveUrl('photo', '/media/a.jpg', { fileText: '/a.jpg' });
            await session.saveSeo('en', 'title', 'Bakery');
            await session.saveShareImage('/media/share.jpg');
            const fields = fire.updateDoc.mock.calls.map(([, data]) => Object.keys(data)[0]);
            expect(fields).toEqual(['urls.photo', 'seo.en.title', 'shareImage']);
        });

        it('creates the draft with the page\'s first save', async () => {
            fire.updateDoc.mockRejectedValueOnce(notFound);
            await session.saveText('en', 'hero', 'Hi');
            expect(fire.setDoc).toHaveBeenCalledWith('SitePageTextDrafts/home', {
                text: { en: { hero: { value: 'Hi', by: 'editor-uid', at: 'NOW' } } }, ...stamp,
            }, { merge: true });
        });

        it('uses the file\'s text again by removing the saved value, and does nothing on a page with no draft', async () => {
            await session.useFileText('en', 'hero');
            await session.useFileUrl('photo');
            await session.useFileSeo('en', 'description');
            expect(fire.updateDoc.mock.calls.map(([, data]) => data)).toEqual([
                { 'text.en.hero': 'DELETE', ...stamp }, { 'urls.photo': 'DELETE', ...stamp }, { 'seo.en.description': 'DELETE', ...stamp },
            ]);
            fire.updateDoc.mockRejectedValueOnce(notFound);
            await session.useFileText('en', 'hero');
            expect(fire.setDoc).not.toHaveBeenCalled();
        });

        it('passes on any other failure', async () => {
            fire.updateDoc.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
            await expect(session.saveText('en', 'hero', 'Hi')).rejects.toThrow('denied');
            expect(fire.setDoc).not.toHaveBeenCalled();
        });

        it('refuses a key or language that is not a safe field name, and a save signed out', async () => {
            await expect(session.saveText('en', 'a.b', 'x')).rejects.toThrow();
            await expect(session.saveText('e.n', 'hero', 'x')).rejects.toThrow();
            auth.currentUser = null;
            await expect(session.saveText('en', 'hero', 'x')).rejects.toThrow('Sign in');
            expect(fire.updateDoc).not.toHaveBeenCalled();
        });

        it('follows the draft live, and says when it cannot be read', () => {
            let next!: (snap: unknown) => void;
            let fail!: (error: Error) => void;
            const stop = vi.fn();
            fire.onSnapshot.mockImplementation((_ref: unknown, onNext: typeof next, onError: typeof fail) => {
                next = onNext;
                fail = onError;
                return stop;
            });
            session.open();
            session.open();
            expect(fire.onSnapshot).toHaveBeenCalledTimes(1);
            expect(session.loaded()).toBe(false);
            next({ exists: () => true, data: () => ({ text: { en: { hero: { value: 'Hi' } } } }) });
            expect(session.draft()?.text?.['en']?.['hero']?.value).toBe('Hi');
            next({ exists: () => true, data: () => ({ text: { en: { hero: { value: 'Saved by someone else' } } } }) });
            expect(session.draft()?.text?.['en']?.['hero']?.value).toBe('Saved by someone else');
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            fail(new Error('denied'));
            expect(session.error()).toBe('denied');
            session.close();
            expect(stop).toHaveBeenCalled();
        });

        it('removes a key the file no longer has, in every language and its address (VE-D47)', async () => {
            fire.onSnapshot.mockImplementation((_ref: unknown, onNext: (snap: unknown) => void) => {
                onNext({ exists: () => true, data: () => ({ text: { en: { old: { value: 'a' }, hero: { value: 'b' } }, hi: { old: { value: 'c' } } }, urls: { old: { value: '/x' } } }) });
                return () => undefined;
            });
            session.open();
            await session.removeKey('old');
            expect(fire.updateDoc).toHaveBeenCalledWith('SitePageTextDrafts/home', {
                'text.en.old': 'DELETE', 'text.hi.old': 'DELETE', 'urls.old': 'DELETE', ...stamp,
            });
        });

        it('restores a published version into the draft, which then needs Publish (VE-D51)', async () => {
            await session.restore({ text: { en: { hero: { value: 'Old' } } }, publishedAt: 'T' } as never);
            expect(fire.setDoc).toHaveBeenCalledWith('SitePageTextDrafts/home', { text: { en: { hero: { value: 'Old' } } }, ...stamp });
            expect(queue.publishPageText).not.toHaveBeenCalled();
        });

        it('publishes through the publish queue (VE-D57)', async () => {
            await session.publish();
            expect(queue.publishPageText).toHaveBeenCalledWith('home');
        });
    });

    it('opens a session only on a page', () => {
        expect(() => service.session('about')).toThrow();
        expect(service.session('p-about-us').pageId).toBe('p-about-us');
    });

    it('tells a draft with changes not published (VE-D48)', () => {
        const at = (ms: number) => ({ toMillis: () => ms });
        expect(hasUnpublishedChanges(null, null)).toBe(false);
        expect(hasUnpublishedChanges({ updatedAt: at(1) }, null)).toBe(true);
        expect(hasUnpublishedChanges({ updatedAt: at(2) }, { draftUpdatedAt: at(1) })).toBe(true);
        expect(hasUnpublishedChanges({ updatedAt: at(2) }, { draftUpdatedAt: at(2) })).toBe(false);
    });
});
