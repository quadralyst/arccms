/**
 * Firestore, Storage and Functions handles for the install's database, bucket and functions region
 * (specs/coexistence-spec.md, CO2). Used by `app.config.ts`.
 *
 * With the default config these are exactly `getFirestore()` and `getStorage()`,
 * the calls every install made before CO2.
 */
import type { Injector } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { getFirestore, type Firestore } from '@angular/fire/firestore';
import { getStorage, type FirebaseStorage } from '@angular/fire/storage';
import { getFunctions, type Functions } from '@angular/fire/functions';
import { arcConfig, DEFAULT_DATABASE_ID, DEFAULT_FUNCTIONS_REGION, type ResolvedArcConfig } from './arc-config';

export function arcFirestore(injector: Injector, config: ResolvedArcConfig = arcConfig): Firestore {
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
