/**
 * PageCardsSource in the Visual Editor's frame (page-cards.ts, VE-D53, VE-D54):
 * changes held while words are typed on a card, focus changes included, the
 * changed drafts' own translations, and the order read again after a Move.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';

const snapshots: ((snap: unknown) => void)[] = [];
const followed: string[] = [];
const stopped: string[] = [];
const getDocMock = vi.fn();
const getDocsMock = vi.fn();
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    query: (ref: unknown) => ref,
    where: () => null,
    onSnapshot: (q: { path?: string }, next: (snap: unknown) => void) => {
        snapshots.push(next);
        followed.push(q?.path ?? '');
        return () => stopped.push(q?.path ?? '');
    },
    getDoc: (ref: { path: string }) => getDocMock(ref.path),
    getDocs: (ref: { path: string }) => getDocsMock(ref.path),
}));

import { Firestore } from '@angular/fire/firestore';
import { HoldService } from '../../../core/editing/hold.service';
import { PageCardsSource } from './page-cards';

const docs = (rows: Record<string, any>[]) => ({ docs: rows.map(({ id, ...data }) => ({ id, data: () => data })) });

describe('PageCardsSource', () => {
    let source: PageCardsSource;
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data, source: window.parent, origin: window.location.origin }));
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        snapshots.length = 0;
        followed.length = 0;
        stopped.length = 0;
        getDocMock.mockReset();
        getDocsMock.mockReset();
        TestBed.configureTestingModule({ providers: [PageCardsSource, { provide: HoldService, useValue: { me: () => ({ uid: 'me', name: 'Me' }) } }, { provide: Firestore, useValue: {} }] });
        source = TestBed.inject(PageCardsSource);
        source.start('home');
        source.watch('quotes');
    });

    it('draws a type\'s changed drafts once read', () => {
        expect(source.cardsOf('quotes')).toBeNull();
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'A2' }]));
        expect(source.cardsOf('quotes')!.changed.map((c) => c['title'])).toEqual(['A2']);
    });

    it('holds new drafts and a change of the open card while words are typed, and applies them after', () => {
        snapshots[0](docs([]));
        send({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'a' } });
        send({ arcPageCards: 'hold', on: true });
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'A2' }]));
        send({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'b' } });
        expect(source.cardsOf('quotes')!.changed).toEqual([]);
        send({ arcPageCards: 'hold', on: false });
        expect(source.cardsOf('quotes')!.changed.map((c) => c['id'])).toEqual(['a']);
    });

    it('gives a changed card its draft\'s own translation in the page\'s language, followed as it is saved', () => {
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'English' }]));
        expect(source.cardsOf('quotes', 'hi')!.changed[0]['title']).toBe('English');
        const at = followed.indexOf('arc_quotes_drafts/a/translations/hi');
        expect(at).toBeGreaterThan(0);
        snapshots[at]({ exists: () => true, data: () => ({ title: 'हिन्दी' }) });
        expect(source.cardsOf('quotes', 'hi')!.changed[0]['title']).toBe('हिन्दी');
        expect(source.cardsOf('quotes')!.changed[0]['title']).toBe('English');
        // Saved again after the draft: the new words show, with no second read.
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'English', modifiedAt: 9 }]));
        snapshots[at]({ exists: () => true, data: () => ({ title: 'नया' }) });
        expect(source.cardsOf('quotes', 'hi')!.changed[0]['title']).toBe('नया');
        expect(followed.filter((path) => path.endsWith('/translations/hi'))).toHaveLength(1);
        source.ngOnDestroy();
        expect(stopped).toContain('arc_quotes_drafts/a/translations/hi');
    });

    describe('a card being published', () => {
        const draft = (over: Record<string, unknown> = {}) => ({ id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'A2', modifiedAt: { seconds: 20 }, lastPublishedAt: { seconds: 10 }, ...over });
        const going = draft({ status: 'publish', modifiedAt: { seconds: 21 } });
        const one = (data: Record<string, unknown> | null) => ({ exists: () => !!data, data: () => data });
        const titles = (lang = '') => source.cardsOf('quotes', lang)!.publishing!.map((c) => c['title']);

        it('keeps its new words, once the site has them too, and is no change any more', () => {
            snapshots[0](docs([draft()]));
            snapshots[0](docs([]));
            // At once, before the first answer: its words never go back in between.
            expect(titles()).toEqual(['A2']);
            expect(source.cardsOf('quotes')!.changed).toEqual([]);
            const at = followed.indexOf('arc_quotes_drafts/a');
            snapshots[at](one(going));
            expect(titles()).toEqual(['A2']);
            snapshots[at](one({ ...going, lastPublishedAt: { seconds: 30 } }));
            expect(titles()).toEqual(['A2']);
        });

        it('keeps its own translation after it landed: the block reads the published one only once', () => {
            snapshots[0](docs([draft()]));
            source.cardsOf('quotes', 'hi');
            snapshots[followed.indexOf('arc_quotes_drafts/a/translations/hi')]({ exists: () => true, data: () => ({ title: 'नया' }) });
            snapshots[0](docs([]));
            snapshots[followed.indexOf('arc_quotes_drafts/a')](one({ ...going, lastPublishedAt: { seconds: 30 } }));
            expect(titles('hi')).toEqual(['नया']);
        });

        it('one put back to what is live is drawn with those words', () => {
            snapshots[0](docs([draft()]));
            snapshots[0](docs([]));
            snapshots[followed.indexOf('arc_quotes_drafts/a')](one(draft({ status: 'publish', title: 'A', modifiedAt: { seconds: 9 } })));
            expect(titles()).toEqual(['A']);
        });

        it.each([
            ['deleted', null],
            ['taken off the site', draft({ status: 'draft', publishedStatus: false })],
        ])('one %s is let go', (_name, now) => {
            snapshots[0](docs([draft()]));
            snapshots[0](docs([]));
            snapshots[followed.indexOf('arc_quotes_drafts/a')](one(now));
            expect(titles()).toEqual([]);
        });

        it('one saved again is a change again, and one changed elsewhere is never followed', () => {
            snapshots[0](docs([draft(), draft({ id: 'b', changedOnPage: 'p-about' })]));
            snapshots[0](docs([]));
            expect(followed).not.toContain('arc_quotes_drafts/b');
            snapshots[0](docs([draft({ title: 'A3' })]));
            expect(titles()).toEqual([]);
            expect(source.cardsOf('quotes')!.changed.map((c) => c['title'])).toEqual(['A3']);
        });

        it('one whose publish never lands shows what is live after a while, and all stop with the source', () => {
            vi.useFakeTimers();
            try {
                snapshots[0](docs([draft()]));
                snapshots[0](docs([]));
                snapshots[followed.indexOf('arc_quotes_drafts/a')](one(going));
                vi.advanceTimersByTime(9 * 60_000);
                expect(titles()).toEqual(['A2']);
                vi.advanceTimersByTime(2 * 60_000);
                expect(titles()).toEqual([]);
                // One that landed stays, whatever the time.
                snapshots[0](docs([draft()]));
                snapshots[0](docs([]));
                snapshots[followed.lastIndexOf('arc_quotes_drafts/a')](one({ ...going, lastPublishedAt: { seconds: 30 } }));
                vi.advanceTimersByTime(20 * 60_000);
                expect(titles()).toEqual(['A2']);
                stopped.length = 0;
                source.ngOnDestroy();
                expect(stopped).toContain('arc_quotes_drafts/a');
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('waits while words are typed on a card', () => {
            snapshots[0](docs([draft()]));
            snapshots[0](docs([]));
            send({ arcPageCards: 'hold', on: true });
            snapshots[followed.indexOf('arc_quotes_drafts/a')](one(null));
            expect(titles()).toEqual(['A2']);
            send({ arcPageCards: 'hold', on: false });
            expect(titles()).toEqual([]);
        });
    });

    it('reads the type\'s whole order again after a Move', async () => {
        snapshots[0](docs([]));
        getDocsMock.mockResolvedValue(docs([{ id: 'a', sortOrder: 2 }, { id: 'b', sortOrder: 1 }]));
        send({ arcPageCards: 'reorder', type: 'quotes' });
        await flush();
        expect(source.cardsOf('quotes')!.sortOrder).toEqual({ a: 2, b: 1 });
    });

    it('shows the cards of the person whose page is looked at, and stops when they let go (VE-D72)', () => {
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', editing: { by: 'priya', name: 'Priya' } }]));
        expect(source.cardsOf('quotes')!.notes).toEqual({ a: { held: 'Priya' } });
        send({ arcPageCards: 'shows', uid: 'priya' });
        expect(source.cardsOf('quotes')!.changed.map((c) => c['id'])).toEqual(['a']);
        expect(source.cardsOf('quotes')!.notes).toEqual({ a: { theirs: true } });
        send({ arcPageCards: 'shows', uid: null });
        expect(source.cardsOf('quotes')!.changed).toEqual([]);
    });

    it('ignores messages from anything but the screen around it', () => {
        snapshots[0](docs([]));
        window.dispatchEvent(new MessageEvent('message', { data: { arcPageCards: 'hold', on: true }, source: null, origin: window.location.origin }));
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home' }]));
        expect(source.cardsOf('quotes')!.changed.length).toBe(1);
    });
});
