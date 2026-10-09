/**
 * DbService.watchByCustomField: the first matching record, kept up to date, with the
 * device's copy marked `fromCache`. A live read rather than getDocs, so a signed-in page
 * can open on the offline cache without waiting for the server (AuthState.recordReady).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';

const snapshots = vi.hoisted(() => ({
    next: (_snapshot: unknown) => undefined as void,
    error: (_error: unknown) => undefined as void,
    options: undefined as unknown,
    stop: () => undefined as void,
}));
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    DocumentReference: class {},
    DocumentSnapshot: class {},
    collection: vi.fn(() => ({ path: 'users' })),
    where: vi.fn((...args: unknown[]) => ({ where: args })),
    query: vi.fn((_ref: unknown, condition: unknown) => ({ condition })),
    getDocs: vi.fn(),
    onSnapshot: vi.fn((_query: unknown, options: unknown, next: (s: unknown) => void, error: (e: unknown) => void) => {
        snapshots.options = options;
        snapshots.next = next;
        snapshots.error = error;
        snapshots.stop = vi.fn();
        return snapshots.stop;
    }),
}));

import { onSnapshot, getDocs, where } from '@angular/fire/firestore';
import { COLLECTION_NAME, DbService } from './db.service';

const snapshot = (docs: Record<string, unknown>[], fromCache: boolean) => ({
    docs: docs.map(({ id, ...data }) => ({ id, data: () => ({ id: 'ignored', ...data }) })),
    metadata: { fromCache },
});

describe('DbService.watchByCustomField', () => {
    let service: DbService<any>;

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                DbService,
                { provide: COLLECTION_NAME, useValue: 'users' },
                { provide: Firestore, useValue: {} },
                { provide: PLATFORM_ID, useValue: 'browser' },
            ],
        });
        service = TestBed.inject(DbService);
    });

    it('gives the cached copy, then the server copy, from one live read', async () => {
        const answers: unknown[] = [];
        const sub = service.watchByCustomField('uid', '==', 'uid-1').subscribe((a) => answers.push(a));
        expect(where).toHaveBeenCalledWith('uid', '==', 'uid-1');
        // Metadata changes too: a server answer that changes nothing still arrives.
        expect(snapshots.options).toEqual({ includeMetadataChanges: true });

        snapshots.next(snapshot([{ id: 'doc-1', name: 'Anna' }], true));
        snapshots.next(snapshot([{ id: 'doc-1', name: 'Anna' }], false));
        snapshots.next(snapshot([], false));
        await vi.waitFor(() => expect(answers).toHaveLength(3));
        expect(answers).toEqual([
            { data: { id: 'doc-1', name: 'Anna' }, fromCache: true },
            { data: { id: 'doc-1', name: 'Anna' }, fromCache: false },
            { data: null, fromCache: false },
        ]);
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        expect(getDocs).not.toHaveBeenCalled();

        sub.unsubscribe();
        expect(snapshots.stop).toHaveBeenCalled();
    });

    it('passes a read error on', async () => {
        const error = vi.fn();
        service.watchByCustomField('uid', '==', 'uid-1').subscribe({ error });
        snapshots.error(new Error('permission-denied'));
        await vi.waitFor(() => expect(error).toHaveBeenCalled());
    });
});
