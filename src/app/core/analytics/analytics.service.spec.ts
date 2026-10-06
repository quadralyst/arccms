import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { ActivationEnd, Router, provideRouter } from '@angular/router';

vi.mock('@angular/fire/app', () => ({ FirebaseApp: class FirebaseApp {} }));
const auth = vi.hoisted(() => ({ listener: null as null | ((user: { uid: string } | null) => void) }));
vi.mock('@angular/fire/auth', () => ({
    Auth: class Auth {},
    onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string } | null) => void) => { auth.listener = cb; },
}));

import { FirebaseApp } from '@angular/fire/app';
import { Auth } from '@angular/fire/auth';
import { ANALYTICS_OPTIONS, AnalyticsService, type AnalyticsOptions } from './analytics.service';
import { SiteUsageService } from '../../pages/admin/(settings)/site-usage/site-usage.service';
import type { SiteUsageState } from '../../pages/admin/(settings)/site-usage/site-usage.model';

@Component({ template: '' })
class Page {}

const ID = 'G-TEST123';
const app = { name: '[DEFAULT]' };
const instance = { kind: 'analytics' };
const flush = () => new Promise((resolve) => setTimeout(resolve));
const disabledFlag = () => (window as unknown as Record<string, boolean>)[`ga-disable-${ID}`];

function fakeModule() {
    return {
        isSupported: vi.fn(async () => true),
        initializeAnalytics: vi.fn(() => instance),
        logEvent: vi.fn(),
        setUserId: vi.fn(),
        setUserProperties: vi.fn(),
        setAnalyticsCollectionEnabled: vi.fn(),
    };
}

describe('AnalyticsService (docs/features/analytics.html)', () => {
    let fns: ReturnType<typeof fakeModule>;
    let load: ReturnType<typeof vi.fn>;
    const consent = signal<SiteUsageState>('pending');
    const bannerEnabled = signal(true);

    async function setup(options: Partial<AnalyticsOptions> = {}, extra: unknown[] = []) {
        TestBed.configureTestingModule({
            providers: [
                provideRouter([
                    { path: '', component: Page },
                    { path: 'lessons', component: Page },
                    { path: 'kids', component: Page, data: { analytics: false } },
                    { path: 'family', data: { analytics: false }, children: [{ path: 'child', component: Page }] },
                ]),
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: FirebaseApp, useValue: app },
                { provide: Auth, useValue: {} },
                { provide: SiteUsageService, useValue: { consent, bannerEnabled } },
                { provide: ANALYTICS_OPTIONS, useValue: { mode: 'required', featureOn: true, measurementId: ID, load, ...options } },
                ...(extra as never[]),
            ],
        });
        const service = TestBed.inject(AnalyticsService);
        await TestBed.inject(Router).navigateByUrl('/');
        TestBed.tick();
        await flush();
        return service;
    }

    async function settle() {
        TestBed.tick();
        await flush();
        await flush();
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        fns = fakeModule();
        load = vi.fn(async () => fns);
        consent.set('pending');
        bannerEnabled.set(true);
        delete (window as unknown as Record<string, boolean>)[`ga-disable-${ID}`];
        auth.listener = null;
    });

    describe('required: nothing until the visitor accepts', () => {
        it('loads nothing and sends nothing while the visitor has not answered', async () => {
            const service = await setup();
            service.log('content_list_view');
            await settle();
            expect(load).not.toHaveBeenCalled();
            expect(fns.logEvent).not.toHaveBeenCalled();
            expect(disabledFlag()).toBe(true);
        });

        it('loads Analytics once accepted, sends the screen view, then events', async () => {
            const service = await setup();
            consent.set('accepted');
            await settle();
            expect(load).toHaveBeenCalledTimes(1);
            expect(fns.initializeAnalytics).toHaveBeenCalledWith(app);
            expect(fns.logEvent).toHaveBeenCalledWith(instance, 'screen_view', expect.objectContaining({ page_path: '/', firebase_screen: '/' }));
            expect(disabledFlag()).toBe(false);

            service.log('share_click', { platform: 'x' });
            expect(fns.logEvent).toHaveBeenCalledWith(instance, 'share_click', { platform: 'x' });
        });

        it('tracks nobody when the banner is off, even after an earlier accept on this device', async () => {
            bannerEnabled.set(false);
            consent.set('accepted');
            const service = await setup();
            service.log('share_click');
            await settle();
            expect(load).not.toHaveBeenCalled();
            expect(service.allowed()).toBe(false);
        });

        it('drops events from before consent instead of sending them later', async () => {
            const service = await setup();
            service.log('before_consent');
            consent.set('accepted');
            await settle();
            expect(fns.logEvent.mock.calls.map((c) => c[1])).not.toContain('before_consent');
        });

        it('stops at once when the visitor withdraws, and deletes Google\'s cookies', async () => {
            const service = await setup();
            consent.set('accepted');
            await settle();
            document.cookie = '_ga=GA1.1.1; path=/';
            document.cookie = '_ga_TEST123=GS1.1.1; path=/';
            document.cookie = 'other=keep; path=/';

            consent.set('rejected');
            await settle();
            expect(fns.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(instance, false);
            expect(disabledFlag()).toBe(true);
            expect(document.cookie).not.toMatch(/_ga/);
            expect(document.cookie).toContain('other=keep');
            service.log('after_withdrawal');
            expect(fns.logEvent.mock.calls.map((c) => c[1])).not.toContain('after_withdrawal');
            document.cookie = 'other=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        });

        it('sets the user id while signed in, as AngularFire does', async () => {
            await setup();
            consent.set('accepted');
            await settle();
            auth.listener!({ uid: 'u-1' });
            expect(fns.setUserId).toHaveBeenCalledWith(instance, 'u-1');
            auth.listener!(null);
            expect(fns.setUserId).toHaveBeenLastCalledWith(instance, null);
        });

        it('sends a screen view per page, not two for the same page', async () => {
            await setup();
            consent.set('accepted');
            await settle();
            const views = () => fns.logEvent.mock.calls.filter((c) => c[1] === 'screen_view').length;
            expect(views()).toBe(1);
            await TestBed.inject(Router).navigateByUrl('/');
            await settle();
            expect(views()).toBe(1);
        });
    });

    describe('route opt-out: data: { analytics: false }', () => {
        it('turns collection off on the page and below it, and on again after', async () => {
            const service = await setup({ mode: 'always' });
            const router = TestBed.inject(Router);
            await router.navigateByUrl('/kids');
            await settle();
            expect(service.allowed()).toBe(false);
            expect(disabledFlag()).toBe(true);
            service.log('kids_event');
            expect(fns.logEvent.mock.calls.map((c) => c[1])).not.toContain('kids_event');

            await router.navigateByUrl('/family/child');
            await settle();
            expect(service.allowed()).toBe(false);

            await router.navigateByUrl('/');
            await settle();
            expect(service.allowed()).toBe(true);
            expect(disabledFlag()).toBe(false);
        });

        it('is off before the page activates, so no screen view is sent for it', async () => {
            await setup({ mode: 'always' });
            const router = TestBed.inject(Router);
            const atActivation: boolean[] = [];
            router.events.subscribe((e) => { if (e instanceof ActivationEnd) atActivation.push(disabledFlag()); });
            await router.navigateByUrl('/kids');
            expect(atActivation.length).toBeGreaterThan(0);
            expect(atActivation.every(Boolean)).toBe(true);
        });
    });

    describe('always (the default)', () => {
        it('loads Analytics itself as the app starts, without asking, and sends one screen view, then events', async () => {
            const service = await setup({ mode: 'always' });
            service.log('share_click');
            await settle();
            expect(load).toHaveBeenCalledTimes(1);
            expect(fns.initializeAnalytics).toHaveBeenCalledWith(app);
            expect(fns.logEvent).toHaveBeenCalledWith(instance, 'share_click', undefined);
            const views = fns.logEvent.mock.calls.filter((c) => c[1] === 'screen_view');
            expect(views).toHaveLength(1);
            expect(views[0][2]).toMatchObject({ screen_name: '/', page_path: '/' });
        });

        it('sends a screen view for each new page', async () => {
            await setup({ mode: 'always' });
            const router = TestBed.inject(Router);
            await router.navigateByUrl('/lessons');
            await settle();
            await router.navigateByUrl('/family/child');
            await settle();
            const views = fns.logEvent.mock.calls.filter((c) => c[1] === 'screen_view').map((c) => c[2]['screen_name']);
            // The first page and lessons; the opted-out page sends none.
            expect(views).toEqual(['/', 'lessons']);
        });

        it('sets the user id when the person signs in', async () => {
            await setup({ mode: 'always' });
            await settle();
            auth.listener?.({ uid: 'u-1' });
            expect(fns.setUserId).toHaveBeenCalledWith(instance, 'u-1');
        });
    });

    describe('never tracks', () => {
        it('with the analytics feature off', async () => {
            consent.set('accepted');
            const service = await setup({ featureOn: false });
            service.log('share_click');
            await settle();
            expect(load).not.toHaveBeenCalled();
            expect(service.allowed()).toBe(false);
        });

        it('without a measurement id', async () => {
            consent.set('accepted');
            const service = await setup({ measurementId: '' });
            service.log('share_click');
            await settle();
            expect(load).not.toHaveBeenCalled();
        });

        it('where the browser does not support Analytics', async () => {
            fns.isSupported.mockResolvedValue(false);
            consent.set('accepted');
            const service = await setup();
            service.log('share_click');
            await settle();
            expect(fns.initializeAnalytics).not.toHaveBeenCalled();
            expect(fns.logEvent).not.toHaveBeenCalled();
        });
    });
});
