import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Injector } from '@angular/core';

vi.mock('@angular/fire/app', () => ({ FirebaseApp: class FirebaseApp {} }));
vi.mock('@angular/fire/firestore', () => ({ getFirestore: vi.fn(() => ({ kind: 'firestore' })) }));
vi.mock('@angular/fire/storage', () => ({ getStorage: vi.fn(() => ({ kind: 'storage' })) }));
vi.mock('@angular/fire/functions', () => ({ getFunctions: vi.fn(() => ({ kind: 'functions' })) }));

import { FirebaseApp } from '@angular/fire/app';
import { getFirestore } from '@angular/fire/firestore';
import { getStorage } from '@angular/fire/storage';
import { getFunctions } from '@angular/fire/functions';
import { arcFirestore, arcFunctions, arcStorage } from './arc-firebase';
import { resolveArcConfig } from './arc-config';

const app = { name: '[DEFAULT]' };
const injector = { get: vi.fn(() => app) } as unknown as Injector;

describe('arc-firebase', () => {
    beforeEach(() => vi.clearAllMocks());

    it('default config makes the same calls as before CO2', () => {
        const defaults = resolveArcConfig(undefined);
        arcFirestore(injector, defaults);
        arcStorage(injector, defaults);
        arcFunctions(injector, defaults);
        expect(getFirestore).toHaveBeenCalledWith();
        expect(getStorage).toHaveBeenCalledWith();
        expect(getFunctions).toHaveBeenCalledWith();
        expect(injector.get).not.toHaveBeenCalled();
    });

    it('opens the named database on the injected app', () => {
        arcFirestore(injector, resolveArcConfig({ databaseId: 'arccms' }));
        expect(injector.get).toHaveBeenCalledWith(FirebaseApp);
        expect(getFirestore).toHaveBeenCalledWith(app, 'arccms');
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
