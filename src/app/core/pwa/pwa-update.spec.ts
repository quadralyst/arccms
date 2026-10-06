import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

vi.mock('../../../custom/features', () => ({ CUSTOM_FEATURES: { on: ['pwa'] } }));
vi.mock('../config/arc-functions', () => ({ arcCallable: vi.fn(() => vi.fn(async () => ({ data: {} }))) }));

const sw = vi.hoisted(() => ({
    options: {} as { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, registration?: unknown) => void },
    apply: vi.fn(async (_reload?: boolean) => undefined),
}));
vi.mock('virtual:pwa-register', () => ({
    registerSW: (options: typeof sw.options) => {
        sw.options = options;
        return sw.apply;
    },
}));

import { PwaService } from './pwa.service';

const flush = () => new Promise((resolve) => setTimeout(resolve));

async function setup() {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    TestBed.configureTestingModule({
        providers: [
            { provide: PLATFORM_ID, useValue: 'browser' },
            { provide: Auth, useValue: { authStateReady: async () => undefined } },
            { provide: Functions, useValue: {} },
        ],
    });
    const service = TestBed.inject(PwaService);
    service.start();
    await flush();
    return service;
}

describe('PwaService update API (docs/app/pwa.html)', () => {
    beforeEach(() => {
        TestBed.resetTestingModule();
        localStorage.clear();
        sw.apply.mockClear();
    });

    it('says an update is waiting once the service worker finds one, and not before', async () => {
        const service = await setup();
        expect(service.updateReady()).toBe(false);
        sw.options.onNeedRefresh!();
        expect(service.updateReady()).toBe(true);
    });

    it('exposes the signal read-only, so an app cannot put the service in a wrong state', async () => {
        const service = await setup();
        expect((service.updateReady as unknown as { set?: unknown }).set).toBeUndefined();
        expect((service.updateBarClosed as unknown as { set?: unknown }).set).toBeUndefined();
    });

    it('applies the waiting update on request, which reloads, and then is no longer waiting', async () => {
        const service = await setup();
        sw.options.onNeedRefresh!();
        await service.applyUpdate();
        expect(sw.apply).toHaveBeenCalledWith(true);
        expect(service.updateReady()).toBe(false);
    });

    it('does nothing when no update is waiting', async () => {
        const service = await setup();
        await service.applyUpdate();
        expect(sw.apply).not.toHaveBeenCalled();
    });

    it('keeps update() as the same thing as applyUpdate()', async () => {
        const service = await setup();
        sw.options.onNeedRefresh!();
        await service.update();
        expect(sw.apply).toHaveBeenCalledTimes(1);
    });

    it('closing the bar leaves the update waiting, so the app can still apply it', async () => {
        const service = await setup();
        sw.options.onNeedRefresh!();
        service.dismissUpdate();
        expect(service.updateBarClosed()).toBe(true);
        expect(service.updateReady()).toBe(true);
        await service.applyUpdate();
        expect(sw.apply).toHaveBeenCalledWith(true);
    });

    it('opens the bar again when a newer version is found after it was closed', async () => {
        const service = await setup();
        sw.options.onNeedRefresh!();
        service.dismissUpdate();
        sw.options.onNeedRefresh!();
        expect(service.updateBarClosed()).toBe(false);
    });

    it('checks for a new version on request, through the service worker registration', async () => {
        const service = await setup();
        const registration = { update: vi.fn(async () => undefined) };
        sw.options.onRegisteredSW!('/sw.js', registration);
        await service.checkForUpdate();
        expect(registration.update).toHaveBeenCalledTimes(1);
    });

    it('does not fail the app when the check cannot reach the network, or there is no registration yet', async () => {
        const service = await setup();
        await expect(service.checkForUpdate()).resolves.toBeUndefined();
        sw.options.onRegisteredSW!('/sw.js', { update: vi.fn(async () => { throw new Error('offline'); }) });
        await expect(service.checkForUpdate()).resolves.toBeUndefined();
    });
});
