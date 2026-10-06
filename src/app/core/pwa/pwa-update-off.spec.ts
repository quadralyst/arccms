import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

// The PWA feature is off (the default): there is no service worker.
vi.mock('../../../custom/features', () => ({ CUSTOM_FEATURES: {} }));
vi.mock('../config/arc-functions', () => ({ arcCallable: vi.fn(() => vi.fn(async () => ({ data: {} }))) }));
const registerSW = vi.hoisted(() => vi.fn(() => vi.fn(async () => undefined)));
vi.mock('virtual:pwa-register', () => ({ registerSW }));

import { PwaService } from './pwa.service';

describe('PwaService update API with the PWA feature off', () => {
    beforeEach(() => TestBed.resetTestingModule());

    it('never finds an update, and the methods do nothing', async () => {
        TestBed.configureTestingModule({
            providers: [
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: Auth, useValue: { authStateReady: async () => undefined } },
                { provide: Functions, useValue: {} },
            ],
        });
        const service = TestBed.inject(PwaService);
        service.start();
        await new Promise((resolve) => setTimeout(resolve));
        expect(registerSW).not.toHaveBeenCalled();
        expect(service.updateReady()).toBe(false);
        await expect(service.checkForUpdate()).resolves.toBeUndefined();
        await expect(service.applyUpdate()).resolves.toBeUndefined();
    });
});
