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
        TestBed.configureTestingModule({ providers: [PageCardsSource, { provide: Firestore, useValue: {} }] });
        source = TestBed.inject(PageCardsSource);
        source.start('home');
        source.watch('quotes');
    });

    it('draws a type\'s changed drafts once read', () => {
        expect(source.cardsOf('quotes')).toBeNull();
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, title: 'A2' }]));
        expect(source.cardsOf('quotes')!.changed.map((c) => c['title'])).toEqual(['A2']);
    });

    it('holds new drafts and a change of the open card while words are typed, and applies them after', () => {
        snapshots[0](docs([]));
        send({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'a' } });
        send({ arcPageCards: 'hold', on: true });
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, title: 'A2' }]));
        send({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'b' } });
        expect(source.cardsOf('quotes')!.changed).toEqual([]);
        send({ arcPageCards: 'hold', on: false });
        expect(source.cardsOf('quotes')!.changed.map((c) => c['id'])).toEqual(['a']);
    });

    it('gives a changed card its draft\'s own translation in the page\'s language, followed as it is saved', () => {
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, title: 'English' }]));
        expect(source.cardsOf('quotes', 'hi')!.changed[0]['title']).toBe('English');
        const at = followed.indexOf('arc_quotes_drafts/a/translations/hi');
        expect(at).toBeGreaterThan(0);
        snapshots[at]({ exists: () => true, data: () => ({ title: 'हिन्दी' }) });
        expect(source.cardsOf('quotes', 'hi')!.changed[0]['title']).toBe('हिन्दी');
        expect(source.cardsOf('quotes')!.changed[0]['title']).toBe('English');
        // Saved again after the draft: the new words show, with no second read.
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true, title: 'English', modifiedAt: 9 }]));
        snapshots[at]({ exists: () => true, data: () => ({ title: 'नया' }) });
        expect(source.cardsOf('quotes', 'hi')!.changed[0]['title']).toBe('नया');
        expect(followed.filter((path) => path.endsWith('/translations/hi'))).toHaveLength(1);
        source.ngOnDestroy();
        expect(stopped).toContain('arc_quotes_drafts/a/translations/hi');
    });

    it('reads the type\'s whole order again after a Move', async () => {
        snapshots[0](docs([]));
        getDocsMock.mockResolvedValue(docs([{ id: 'a', sortOrder: 2 }, { id: 'b', sortOrder: 1 }]));
        send({ arcPageCards: 'reorder', type: 'quotes' });
        await flush();
        expect(source.cardsOf('quotes')!.sortOrder).toEqual({ a: 2, b: 1 });
    });

    it('ignores messages from anything but the screen around it', () => {
        snapshots[0](docs([]));
        window.dispatchEvent(new MessageEvent('message', { data: { arcPageCards: 'hold', on: true }, source: null, origin: window.location.origin }));
        snapshots[0](docs([{ id: 'a', status: 'draft', publishedStatus: true }]));
        expect(source.cardsOf('quotes')!.changed.length).toBe(1);
    });
});
