import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

vi.mock('../../../custom/pwa', () => ({ CUSTOM_PWA: { enabled: true } }));
const callable = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true } })));
vi.mock('../config/arc-functions', () => ({ arcCallable: vi.fn(() => callable) }));

import { PwaService, SNOOZE_MS } from './pwa.service';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function setup(options: { userAgent?: string; standalone?: boolean; platformId?: string } = {}) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(options.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0');
    window.matchMedia = vi.fn().mockReturnValue({ matches: options.standalone ?? false }) as any;
    TestBed.configureTestingModule({
        providers: [
            { provide: PLATFORM_ID, useValue: options.platformId ?? 'browser' },
            { provide: Auth, useValue: { authStateReady: async () => undefined } },
            { provide: Functions, useValue: {} },
        ],
    });
    const service = TestBed.inject(PwaService);
    service.start();
    return service;
}

/** Chrome's install event, which the service keeps for its own button. */
function firePrompt(outcome: 'accepted' | 'dismissed') {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: vi.fn(async () => undefined),
        userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
    return event;
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('PwaService', () => {
    beforeEach(() => {
        TestBed.resetTestingModule();
        localStorage.clear();
        callable.mockClear();
    });

    it('offers nothing until the browser can install', () => {
        expect(setup().installMode()).toBeNull();
    });

    it('offers the browser\'s own install dialog, and counts the install once', async () => {
        const service = setup();
        const event = firePrompt('accepted');
        expect(event.defaultPrevented).toBe(true);
        expect(service.installMode()).toBe('prompt');

        await service.install();
        await flush();
        expect(event.prompt).toHaveBeenCalled();
        expect(service.installed()).toBe(true);
        expect(service.installMode()).toBeNull();
        expect(callable).toHaveBeenCalledWith({ event: 'installed', platform: 'desktop' });

        window.dispatchEvent(new Event('appinstalled'));
        await flush();
        expect(callable).toHaveBeenCalledTimes(1);
    });

    it('shows the two-step guide in Safari on iPhone', () => {
        expect(setup({ userAgent: IPHONE_SAFARI }).installMode()).toBe('ios-safari');
    });

    it('hides the card for a while after "Not now", and counts it', async () => {
        const service = setup({ userAgent: IPHONE_SAFARI });
        service.dismiss();
        await flush();
        expect(service.showInstall()).toBe(false);
        expect(Number(localStorage.getItem('arc-pwa-snoozed-until'))).toBeGreaterThan(Date.now() + SNOOZE_MS - 60_000);
        expect(callable).toHaveBeenCalledWith({ event: 'dismissed', platform: 'ios' });
    });

    it('counts the first open from the home screen as the install, and each day\'s open once', async () => {
        const service = setup({ userAgent: IPHONE_SAFARI, standalone: true });
        await flush();
        expect(service.installMode()).toBeNull();
        expect(callable.mock.calls.map(([data]: any) => data.event)).toEqual(['installed', 'opened_installed']);

        TestBed.resetTestingModule();
        callable.mockClear();
        setup({ userAgent: IPHONE_SAFARI, standalone: true });
        await flush();
        expect(callable).not.toHaveBeenCalled();
    });

    it('counts "shown" once per device', async () => {
        const service = setup({ userAgent: IPHONE_SAFARI });
        service.shown();
        service.shown();
        await flush();
        expect(callable).toHaveBeenCalledTimes(1);
    });

    it('with the PWA off, removes a service worker left from when it was on', async () => {
        const unregister = vi.fn(async () => true);
        const cacheDelete = vi.fn(async () => true);
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: { getRegistrations: async () => [{ active: { scriptURL: 'https://x.test/sw.js' }, unregister }] },
        });
        (globalThis as any).caches = { keys: async () => ['arc-pages', 'workbox-precache-v2-x', 'other'], delete: cacheDelete };
        try {
            const service = setup();
            (service as any).enabled = false;
            service.start();
            await flush();
            expect(unregister).toHaveBeenCalled();
            expect(cacheDelete.mock.calls.map(([name]: any) => name)).toEqual(['arc-pages', 'workbox-precache-v2-x']);
        } finally {
            delete (navigator as any).serviceWorker;
            delete (globalThis as any).caches;
        }
    });

    it('does nothing on the server', () => {
        const service = setup({ platformId: 'server' });
        expect(service.enabled).toBe(false);
        expect(service.installMode()).toBeNull();
    });
});
