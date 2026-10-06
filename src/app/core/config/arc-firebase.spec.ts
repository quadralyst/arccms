import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Injector } from '@angular/core';

vi.mock('@angular/fire/app', () => ({ FirebaseApp: class FirebaseApp {} }));
vi.mock('@angular/fire/firestore', () => ({
    getFirestore: vi.fn(() => ({ kind: 'firestore' })),
    initializeFirestore: vi.fn(() => ({ kind: 'firestore-with-cache' })),
    persistentLocalCache: vi.fn((settings: unknown) => ({ cache: settings })),
    persistentSingleTabManager: vi.fn(() => ({ tabs: 'single' })),
    persistentMultipleTabManager: vi.fn(() => ({ tabs: 'multiple' })),
    waitForPendingWrites: vi.fn(async () => undefined),
    terminate: vi.fn(async () => undefined),
    clearIndexedDbPersistence: vi.fn(async () => undefined),
}));
vi.mock('@angular/fire/storage', () => ({ getStorage: vi.fn(() => ({ kind: 'storage' })) }));
vi.mock('@angular/fire/functions', () => ({ getFunctions: vi.fn(() => ({ kind: 'functions' })) }));

import { FirebaseApp } from '@angular/fire/app';
import {
    clearIndexedDbPersistence, getFirestore, initializeFirestore, terminate, waitForPendingWrites, type Firestore,
} from '@angular/fire/firestore';
import { getStorage } from '@angular/fire/storage';
import { getFunctions } from '@angular/fire/functions';
import { arcFirestore, arcFunctions, arcStorage, clearOfflineCache, OfflineWritesPendingError } from './arc-firebase';
import { resolveArcConfig } from './arc-config';

const app = { name: '[DEFAULT]' };
const injector = { get: vi.fn(() => app) } as unknown as Injector;

describe('arc-firebase', () => {
    beforeEach(() => vi.clearAllMocks());

    it('default config makes the same calls as before CO2', () => {
        const defaults = resolveArcConfig(undefined);
        arcFirestore(injector, defaults, true);
        arcStorage(injector, defaults);
        arcFunctions(injector, defaults);
        expect(getFirestore).toHaveBeenCalledWith();
        expect(initializeFirestore).not.toHaveBeenCalled();
        expect(getStorage).toHaveBeenCalledWith();
        expect(getFunctions).toHaveBeenCalledWith();
        expect(injector.get).not.toHaveBeenCalled();
    });

    it('opens the named database on the injected app', () => {
        arcFirestore(injector, resolveArcConfig({ databaseId: 'arccms' }), true);
        expect(injector.get).toHaveBeenCalledWith(FirebaseApp);
        expect(getFirestore).toHaveBeenCalledWith(app, 'arccms');
        expect(initializeFirestore).not.toHaveBeenCalled();
    });

    it('opens the configured bucket on the injected app', () => {
        arcStorage(injector, resolveArcConfig({ storageBucket: 'acme-arccms' }));
        expect(getStorage).toHaveBeenCalledWith(app, 'gs://acme-arccms');
    });

    it('calls the functions in the install\'s region, next to its database', () => {
        arcFunctions(injector, resolveArcConfig({ functionsRegion: 'asia-south1' }));
        expect(getFunctions).toHaveBeenCalledWith(app, 'asia-south1');
    });
});

describe('arc-firebase offline cache (docs/app/offline.html)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps one tab\'s cache for the (default) database', () => {
        const firestore = arcFirestore(injector, resolveArcConfig({ offlineCache: 'single-tab' }), true);
        expect(initializeFirestore).toHaveBeenCalledWith(app, { localCache: { cache: { tabManager: { tabs: 'single' } } } });
        expect(getFirestore).not.toHaveBeenCalled();
        expect(firestore).toEqual({ kind: 'firestore-with-cache' });
    });

    it('shares the cache between tabs, on a named database', () => {
        arcFirestore(injector, resolveArcConfig({ offlineCache: 'multi-tab', databaseId: 'arccms' }), true);
        expect(initializeFirestore).toHaveBeenCalledWith(app, { localCache: { cache: { tabManager: { tabs: 'multiple' } } } }, 'arccms');
    });

    it('starts without the cache where the browser has no IndexedDB', () => {
        arcFirestore(injector, resolveArcConfig({ offlineCache: 'multi-tab' }), false);
        expect(initializeFirestore).not.toHaveBeenCalled();
        expect(getFirestore).toHaveBeenCalledWith();
    });

    it('never fails to start over the cache: a refusal (or a second start on hot reload) falls back to the instance there is', () => {
        vi.mocked(initializeFirestore).mockImplementationOnce(() => { throw new Error('already started'); });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const firestore = arcFirestore(injector, resolveArcConfig({ offlineCache: 'multi-tab', databaseId: 'arccms' }), true);
        expect(getFirestore).toHaveBeenCalledWith(app, 'arccms');
        expect(firestore).toEqual({ kind: 'firestore' });
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('clearOfflineCache', () => {
    const firestore = { kind: 'firestore' } as unknown as Firestore;
    beforeEach(() => vi.clearAllMocks());

    it('waits for writes made offline, then stops Firestore, clears the cache and reloads', async () => {
        const afterClear = vi.fn();
        await clearOfflineCache(firestore, { afterClear });
        expect(waitForPendingWrites).toHaveBeenCalledWith(firestore);
        expect(terminate).toHaveBeenCalledWith(firestore);
        expect(clearIndexedDbPersistence).toHaveBeenCalledWith(firestore);
        expect(vi.mocked(terminate).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(clearIndexedDbPersistence).mock.invocationCallOrder[0]);
        expect(afterClear).toHaveBeenCalledTimes(1);
    });

    it('refuses, and clears nothing, while writes made offline cannot be sent', async () => {
        vi.mocked(waitForPendingWrites).mockImplementationOnce(() => new Promise(() => undefined));
        const afterClear = vi.fn();
        await expect(clearOfflineCache(firestore, { timeoutMs: 10, afterClear })).rejects.toBeInstanceOf(OfflineWritesPendingError);
        expect(terminate).not.toHaveBeenCalled();
        expect(clearIndexedDbPersistence).not.toHaveBeenCalled();
        expect(afterClear).not.toHaveBeenCalled();
    });

    it('discards unsent writes only when asked to', async () => {
        const afterClear = vi.fn();
        await clearOfflineCache(firestore, { discardPendingWrites: true, afterClear });
        expect(waitForPendingWrites).not.toHaveBeenCalled();
        expect(clearIndexedDbPersistence).toHaveBeenCalledWith(firestore);
        expect(afterClear).toHaveBeenCalledTimes(1);
    });
});
