import { computed, inject, Injectable, Injector, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../config/arc-functions';
import { CUSTOM_PWA } from '../../../custom/pwa';
import { resolvePwaConfig } from './pwa-config';
import { detectPlatform, type PwaPlatform } from './pwa-platform';
import { isOn } from '../features/features';

/** This install's PWA settings (src/custom/pwa.ts over the core defaults, docs/pwa.md). */
export const PWA = { ...resolvePwaConfig(CUSTOM_PWA), enabled: isOn('pwa') };

export type PwaEvent = 'prompt_shown' | 'installed' | 'dismissed' | 'opened_installed';

/** How this browser installs the app, if it can. */
export type InstallMode = 'prompt' | 'ios-safari' | 'ios-other';

/** Chrome's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** After "Not now", the install card stays hidden this long. */
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
/** How often an open app checks for a new version. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

const KEY = {
    snoozedUntil: 'arc-pwa-snoozed-until',
    sent: (event: PwaEvent) => `arc-pwa-sent-${event}`,
};

/**
 * The installable app (docs/pwa.md): registers the service worker, offers the
 * update, knows how this browser installs, and counts installs.
 *
 * Does nothing unless the install turned the PWA on, and nothing on the server.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
    private injector = inject(Injector);
    private browser = isPlatformBrowser(inject(PLATFORM_ID));

    readonly enabled = PWA.enabled && this.browser;
    readonly platform: PwaPlatform;
    private readonly iosSafari: boolean;

    /** Running from the home screen (or as an installed desktop app). */
    readonly installed = signal(false);
    /** A new version is waiting: the update bar shows. */
    readonly updateReady = signal(false);
    readonly snoozed = signal(false);
    private deferredPrompt = signal<BeforeInstallPromptEvent | null>(null);
    private applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

    /** How to install here, or null when installing is not possible or already done. */
    readonly installMode = computed<InstallMode | null>(() => {
        if (!this.enabled || this.installed()) return null;
        if (this.deferredPrompt()) return 'prompt';
        if (this.platform === 'ios') return this.iosSafari ? 'ios-safari' : 'ios-other';
        return null;
    });

    /** Whether to offer the install card (not after "Not now", for a while). */
    readonly showInstall = computed(() => this.installMode() !== null && !this.snoozed());

    constructor() {
        const info = this.browser
            ? detectPlatform(navigator.userAgent, navigator.maxTouchPoints)
            : { platform: 'desktop' as const, iosSafari: false };
        this.platform = info.platform;
        this.iosSafari = info.iosSafari;
    }

    /** Called once when the app starts (app.config.ts). */
    start(): void {
        if (!this.enabled) {
            if (this.browser) void this.removeServiceWorker();
            return;
        }
        this.installed.set(
            window.matchMedia?.('(display-mode: standalone)').matches ||
            (navigator as Navigator & { standalone?: boolean }).standalone === true,
        );
        this.snoozed.set(Number(this.read(KEY.snoozedUntil)) > Date.now());

        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault(); // shown from our own button instead
            this.deferredPrompt.set(event as BeforeInstallPromptEvent);
        });
        window.addEventListener('appinstalled', () => {
            this.deferredPrompt.set(null);
            this.installed.set(true);
            this.trackOnce('installed');
        });

        if (this.installed()) {
            // iPhone has no install event: the first open from the home screen is the install.
            this.trackOnce('installed');
            this.trackDaily('opened_installed');
        }
        void this.registerServiceWorker();
    }

    /** The browser's own install dialog (Android and desktop). */
    async install(): Promise<void> {
        const prompt = this.deferredPrompt();
        if (!prompt) return;
        this.deferredPrompt.set(null); // a prompt can be used only once
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
            this.installed.set(true);
            this.trackOnce('installed');
        } else {
            this.track('dismissed');
        }
    }

    /** "Not now": hide the install card for a while. */
    dismiss(): void {
        this.write(KEY.snoozedUntil, String(Date.now() + SNOOZE_MS));
        this.snoozed.set(true);
        this.track('dismissed');
    }

    /** The install card or guide came into view (counted once per device). */
    shown(): void {
        this.trackOnce('prompt_shown');
    }

    /** Switch to the new version: reloads the page. */
    async update(): Promise<void> {
        this.updateReady.set(false);
        await this.applyUpdate?.(true);
    }

    private async registerServiceWorker(): Promise<void> {
        if (!('serviceWorker' in navigator)) return;
        try {
            const { registerSW } = await import('virtual:pwa-register');
            this.applyUpdate = registerSW({
                onNeedRefresh: () => this.updateReady.set(true),
                onRegisteredSW: (_url, registration) => {
                    if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS);
                },
            });
        } catch (err) {
            console.warn('PWA: the service worker could not be registered.', err);
        }
    }

    /**
     * With the PWA turned off after it was on, remove the service worker and its
     * stored files, so every visitor gets the plain website again.
     */
    private async removeServiceWorker(): Promise<void> {
        if (!('serviceWorker' in navigator)) return;
        try {
            const ours = (await navigator.serviceWorker.getRegistrations())
                .filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith('/sw.js'));
            if (!ours.length) return;
            await Promise.all(ours.map((r) => r.unregister()));
            const names = await caches.keys();
            await Promise.all(names.filter((n) => n.startsWith('arc-') || n.startsWith('workbox-')).map((n) => caches.delete(n)));
        } catch {
            // nothing to remove, or the browser would not say
        }
    }

    private trackOnce(event: PwaEvent): void {
        if (this.read(KEY.sent(event))) return;
        this.write(KEY.sent(event), '1');
        this.track(event);
    }

    private trackDaily(event: PwaEvent): void {
        const today = new Date().toISOString().slice(0, 10);
        if (this.read(KEY.sent(event)) === today) return;
        this.write(KEY.sent(event), today);
        this.track(event);
    }

    /** Counting never gets in anyone's way: failures are ignored. */
    private track(event: PwaEvent): void {
        void (async () => {
            try {
                // Wait for the saved sign-in, so the server can note the install on the person's record.
                await this.injector.get(Auth).authStateReady();
                await arcCallable(this.injector.get(Functions), 'trackPwaEvent')({ event, platform: this.platform });
            } catch {
                // offline, or the function is not deployed yet
            }
        })();
    }

    private read(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    private write(key: string, value: string): void {
        try {
            localStorage.setItem(key, value);
        } catch {
            // private mode: the card simply shows again next time
        }
    }
}
