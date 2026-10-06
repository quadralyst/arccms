/**
 * Applying an update in one tab never reloads a page that shows updates itself in another
 * tab (docs/app/pwa.html#show-the-update-yourself).
 *
 * Runs the real registration code that the build bundles (vite-plugin-pwa's
 * client/build/register.js) over stand-ins for workbox-window and the page, so a library upgrade that
 * changes its listeners fails here. When any tab applies an update, workbox-window fires
 * `controlling` in every open tab, and the library's own answer is `window.location.reload()`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, PLATFORM_ID } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

vi.mock('../../../custom/features', () => ({ CUSTOM_FEATURES: { on: ['pwa'] } }));
vi.mock('../config/arc-functions', () => ({ arcCallable: vi.fn(() => vi.fn(async () => ({ data: {} }))) }));

const wb = vi.hoisted(() => {
    type Listener = (event: Record<string, unknown>) => void;
    class FakeWorkbox {
        listeners = new Map<string, Listener[]>();
        messageSkipWaiting = vi.fn();
        register = vi.fn(async () => ({ update: vi.fn(async () => undefined) }));
        constructor() {
            state.current = this;
        }
        addEventListener(type: string, listener: Listener) {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }
        fire(type: string, event: Record<string, unknown> = {}) {
            for (const listener of this.listeners.get(type) ?? []) listener({ type, ...event });
        }
    }
    /** The library's own `window.location.reload()`: in a browser it would reload the page. */
    const libraryReload = vi.fn();
    const state = { current: null as FakeWorkbox | null, FakeWorkbox, libraryReload };
    return state;
});

/**
 * The library's registration as the build bundles it: the plugin reads this file and fills
 * in its placeholders (vite-plugin-pwa dist/index.js, generateRegisterSW), here with this
 * install's settings (prompt mode, /sw.js). `window` and workbox-window are stood in.
 */
vi.mock('virtual:pwa-register', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const file = resolve(__dirname, '../../../../node_modules/vite-plugin-pwa/dist/client/build/register.js');
    const source = readFileSync(file, 'utf8')
        .replace(/__SW__/g, '/sw.js')
        .replace('__SCOPE__', '/')
        .replace('__SW_AUTO_UPDATE__', 'false')
        .replace('__SW_SELF_DESTROYING__', 'false')
        .replace('__TYPE__', 'classic');
    const tail = /export\s*\{\s*registerSW\s*\};?\s*$/;
    if (!source.includes('import("workbox-window")') || !tail.test(source)) {
        throw new Error('vite-plugin-pwa changed its register.js: check again that another tab\'s update cannot reload a pwaUpdate page.');
    }
    const body = source.replace('import("workbox-window")', 'loadWorkbox()').replace(tail, 'return registerSW;');
    const make = new Function('window', 'navigator', 'loadWorkbox', body);
    const registerSW = make(
        { location: { reload: () => wb.libraryReload() } },
        navigator,
        async () => ({ Workbox: wb.FakeWorkbox }),
    );
    return { registerSW };
});

import { registerSW } from 'virtual:pwa-register';
import { PWA_RELOAD, PwaService } from './pwa.service';

@Component({ template: '' })
class Blank {}

const flush = () => new Promise((resolve) => setTimeout(resolve));

async function openTab(url: string) {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const pageReload = vi.fn();
    TestBed.configureTestingModule({
        providers: [
            { provide: PLATFORM_ID, useValue: 'browser' },
            { provide: Auth, useValue: { authStateReady: async () => undefined } },
            { provide: Functions, useValue: {} },
            { provide: PWA_RELOAD, useValue: pageReload },
            provideRouter([
                { path: 'lock', component: Blank, data: { fullScreen: true, pwaUpdate: 'app' } },
                { path: 'home', component: Blank },
            ]),
        ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const service = TestBed.inject(PwaService);
    service.start();
    await flush();
    const workbox = wb.current!;
    expect(workbox.register).toHaveBeenCalled();
    return { service, workbox, pageReload };
}

/** Another tab's new version finished installing: this tab hears it as external. */
function newVersionWaiting(workbox: InstanceType<typeof wb.FakeWorkbox>) {
    workbox.fire('waiting', { sw: {}, isExternal: true });
}

/** Some tab applied the update: the new service worker now controls every open tab. */
function newVersionInControl(workbox: InstanceType<typeof wb.FakeWorkbox>) {
    workbox.fire('controlling', { isUpdate: true, isExternal: true });
    return wb.libraryReload;
}

describe('PWA update across tabs', () => {
    beforeEach(() => {
        TestBed.resetTestingModule();
        localStorage.clear();
        wb.current = null;
        wb.libraryReload.mockClear();
        Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    });

    it('the library reloads every tab by itself when nothing handles it (why Arc CMS does)', async () => {
        registerSW({ onNeedRefresh: () => undefined });
        await flush();
        newVersionWaiting(wb.current!);
        const libraryReload = newVersionInControl(wb.current!);
        expect(libraryReload).toHaveBeenCalledTimes(1);
    });

    it('on a page that shows updates itself, another tab\'s update reloads nothing and turns updateReady on', async () => {
        const { service, workbox, pageReload } = await openTab('/lock');
        newVersionWaiting(workbox);
        service.dismissUpdate();

        const libraryReload = newVersionInControl(workbox);
        expect(libraryReload).not.toHaveBeenCalled();
        expect(pageReload).not.toHaveBeenCalled();
        expect(service.updateReady()).toBe(true);

        // The app reloads when it chooses. The new version already controls the page,
        // so there is nothing to ask the service worker: a reload is enough.
        await service.applyUpdate();
        expect(pageReload).toHaveBeenCalledTimes(1);
        expect(workbox.messageSkipWaiting).not.toHaveBeenCalled();
    });

    it('on a page that shows updates itself, the app\'s own applyUpdate() still reloads it', async () => {
        const { service, workbox, pageReload } = await openTab('/lock');
        newVersionWaiting(workbox);
        await service.applyUpdate();
        expect(workbox.messageSkipWaiting).toHaveBeenCalledTimes(1);

        const libraryReload = newVersionInControl(workbox);
        expect(libraryReload).not.toHaveBeenCalled();
        expect(pageReload).toHaveBeenCalledTimes(1);
    });

    it('on a normal page, nothing changes: the new version reloads the page', async () => {
        const { service, workbox, pageReload } = await openTab('/home');
        newVersionWaiting(workbox);
        expect(service.updateReady()).toBe(true);

        const libraryReload = newVersionInControl(workbox);
        expect(libraryReload).not.toHaveBeenCalled();
        expect(pageReload).toHaveBeenCalledTimes(1);
    });

    it('a newer version found after the switch is applied through the service worker again', async () => {
        const { service, workbox, pageReload } = await openTab('/lock');
        newVersionWaiting(workbox);
        newVersionInControl(workbox);
        newVersionWaiting(workbox);

        await service.applyUpdate();
        expect(workbox.messageSkipWaiting).toHaveBeenCalledTimes(1);
        expect(pageReload).not.toHaveBeenCalled();
        newVersionInControl(workbox);
        expect(pageReload).toHaveBeenCalled();
    });
});
