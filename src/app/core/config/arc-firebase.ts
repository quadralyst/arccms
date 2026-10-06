/**
 * Firestore, Storage and Functions handles for the install's database, bucket and functions region
 * (specs/coexistence-spec.md, CO2). Used by `app.config.ts`.
 *
 * With the default config these are exactly `getFirestore()` and `getStorage()`,
 * the calls every install made before CO2.
 */
import type { Injector } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import {
    clearIndexedDbPersistence,
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    persistentSingleTabManager,
    terminate,
    waitForPendingWrites,
    type Firestore,
} from '@angular/fire/firestore';
import { getStorage, type FirebaseStorage } from '@angular/fire/storage';
import { getFunctions, type Functions } from '@angular/fire/functions';
import { arcConfig, DEFAULT_DATABASE_ID, DEFAULT_FUNCTIONS_REGION, type ResolvedArcConfig } from './arc-config';

/** Whether this browser can keep Firestore's cache (no IndexedDB in some private windows, none on a server). */
const hasIndexedDb = () => typeof indexedDB !== 'undefined';

/**
 * The install's Firestore. With the offline cache on (docs/app/offline.html), data
 * loaded stays on the device and writes made offline are sent when the connection
 * returns. If the cache cannot start, Firestore starts without it: a page never fails
 * to load over the cache.
 */
export function arcFirestore(injector: Injector, config: ResolvedArcConfig = arcConfig, indexedDbAvailable = hasIndexedDb()): Firestore {
    if (config.offlineCache !== 'off' && indexedDbAvailable) {
        try {
            const tabManager = config.offlineCache === 'multi-tab' ? persistentMultipleTabManager() : persistentSingleTabManager({});
            const settings = { localCache: persistentLocalCache({ tabManager }) };
            const app = injector.get(FirebaseApp);
            return config.databaseId === DEFAULT_DATABASE_ID
                ? initializeFirestore(app, settings)
                : initializeFirestore(app, settings, config.databaseId);
        } catch (error) {
            // Started already (a hot reload in `npm run dev`), or the browser refused the
            // cache: the instance that exists is the right one.
            console.warn('Firestore offline cache not started here; using Firestore without it.', error);
        }
    }
    if (config.databaseId === DEFAULT_DATABASE_ID) return getFirestore();
    return getFirestore(injector.get(FirebaseApp), config.databaseId);
}

export function arcStorage(injector: Injector, config: ResolvedArcConfig = arcConfig): FirebaseStorage {
    if (!config.storageBucket) return getStorage();
    return getStorage(injector.get(FirebaseApp), `gs://${config.storageBucket}`);
}

/** The functions in the install's region: a callable in another region is not found. */
export function arcFunctions(injector: Injector, config: ResolvedArcConfig = arcConfig): Functions {
    if (config.functionsRegion === DEFAULT_FUNCTIONS_REGION) return getFunctions();
    return getFunctions(injector.get(FirebaseApp), config.functionsRegion);
}

/** Writes made offline are still waiting to be sent, so clearing now would lose them. */
export class OfflineWritesPendingError extends Error {
    constructor() {
        super('Some changes made offline have not been sent yet. Connect to the internet and try again.');
        this.name = 'OfflineWritesPendingError';
    }
}

export interface ClearOfflineCacheOptions {
    /** Clear even if writes made offline have not been sent; they are lost. Default false. */
    discardPendingWrites?: boolean;
    /** How long to wait for those writes to be sent. Default 5 seconds. */
    timeoutMs?: number;
    /** Runs once the cache is gone. Default: reload the page, since Firestore is stopped. */
    afterClear?: () => void;
}

/**
 * Wipes Firestore's offline cache on this device (docs/app/offline.html), for example
 * when a shared device changes hands or is retired. Waits for writes made offline to be
 * sent first, and refuses with `OfflineWritesPendingError` if they cannot be, unless told
 * to discard them. Firestore is stopped to do this, so the page reloads afterwards.
 */
export async function clearOfflineCache(firestore: Firestore, options: ClearOfflineCacheOptions = {}): Promise<void> {
    const { discardPendingWrites = false, timeoutMs = 5000, afterClear = () => location.reload() } = options;
    if (!discardPendingWrites) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
        const outcome = await Promise.race([waitForPendingWrites(firestore).then(() => 'sent' as const), timedOut]);
        clearTimeout(timer);
        if (outcome === 'timeout') throw new OfflineWritesPendingError();
    }
    await terminate(firestore);
    await clearIndexedDbPersistence(firestore);
    afterClear();
}
