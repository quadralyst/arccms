/**
 * The install's bucket (specs/coexistence-spec.md, CO2), in its own file so Firebase
 * Storage loads only when ArcStorage first needs it (arc-storage.ts). With the default
 * config this is exactly `getStorage()`.
 */
import type { Injector } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { getStorage, type FirebaseStorage } from '@angular/fire/storage';
import { arcConfig, type ResolvedArcConfig } from './arc-config';

export function arcStorage(injector: Injector, config: ResolvedArcConfig = arcConfig): FirebaseStorage {
    if (!config.storageBucket) return getStorage();
    return getStorage(injector.get(FirebaseApp), `gs://${config.storageBucket}`);
}
