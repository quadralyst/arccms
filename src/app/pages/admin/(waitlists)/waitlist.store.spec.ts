import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOnSnapshot, mockUnsubscribe } = vi.hoisted(() => ({
    mockOnSnapshot: vi.fn(),
    mockUnsubscribe: vi.fn(),
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class Firestore { },
    collection: vi.fn(() => ({})),
    doc: vi.fn(() => ({})),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
}));

import { WaitlistAdminStore } from './waitlist.store';

function makeStore(platform: 'browser' | 'server'): WaitlistAdminStore {
    TestBed.configureTestingModule({
        providers: [
            { provide: Firestore, useValue: {} },
            { provide: PLATFORM_ID, useValue: platform },
        ],
    });
    return TestBed.inject(WaitlistAdminStore);
}

describe('WaitlistAdminStore', () => {
    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        mockOnSnapshot.mockReturnValue(mockUnsubscribe);
    });

    it('does not register a Firestore listener during SSR', () => {
        // A listener registered on the server outlives the request injector it
        // captured; the next waitlist add/edit then fires @angular/fire's
        // callback against a destroyed injector (NG0205) and kills the process.
        const store = makeStore('server');

        store.subscribe();

        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    it('registers a listener in the browser', () => {
        const store = makeStore('browser');

        store.subscribe();

        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    });

    it('shares one listener across repeated subscribers', () => {
        // side-navbar, dashboard and the subscribers page each call subscribe().
        const store = makeStore('browser');

        store.subscribe();
        store.subscribe();
        store.subscribe();

        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    });

    it('re-subscribes after destroy', () => {
        const store = makeStore('browser');

        store.subscribe();
        store.destroy();
        store.subscribe();

        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
        expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
    });

    it('drops the listener when the injector is destroyed', () => {
        const store = makeStore('browser');
        store.subscribe();

        store.ngOnDestroy();

        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('destroy is safe when never subscribed', () => {
        const store = makeStore('browser');

        expect(() => store.destroy()).not.toThrow();
        expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
});
