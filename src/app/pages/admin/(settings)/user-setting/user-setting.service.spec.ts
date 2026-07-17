import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { UserSettingService } from './user-setting.service';
import { DEFAULT_USER_SETTINGS } from './user-setting.model';
import { Firestore, onSnapshot } from '@angular/fire/firestore';

// Mock Firestore functions
vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        doc: vi.fn(() => ({})),
        getDoc: vi.fn(() => Promise.resolve({
            exists: () => true,
            data: () => ({ isSignupEnabled: true, defaultRole: 'user' }),
            id: 'users',
        })),
        setDoc: vi.fn(() => Promise.resolve()),
        serverTimestamp: vi.fn(() => new Date()),
        onSnapshot: vi.fn((docRef, onNext, onError) => {
            // Immediately call onNext with default settings
            onNext({
                exists: () => true,
                data: () => ({ isSignupEnabled: true, defaultRole: 'user' }),
                id: 'users',
            });
            // Return unsubscribe function
            return vi.fn();
        }),
    };
});

describe('UserSettingService', () => {
    let service: UserSettingService;
    let mockFirestore: any;

    beforeEach(async () => {
        mockFirestore = {};

        await TestBed.configureTestingModule({
            providers: [
                UserSettingService,
                { provide: Firestore, useValue: mockFirestore },
            ],
        });

        service = TestBed.inject(UserSettingService);
    });

    describe('initialization', () => {
        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('should have settings$ observable', () => {
            expect(service.settings$).toBeTruthy();
        });
    });

    describe('getSettings', () => {
        it('should return observable with settings', async () => {
            const settings = await firstValueFrom(service.getSettings());
            expect(settings).toBeTruthy();
            expect(settings.isSignupEnabled).toBeDefined();
            expect(settings.defaultRole).toBeDefined();
        });
    });

    describe('isSignupEnabled', () => {
        it('should return boolean value', () => {
            const result = service.isSignupEnabled();
            expect(typeof result).toBe('boolean');
        });
    });

    describe('getDefaultRole', () => {
        it('should return string value', () => {
            const result = service.getDefaultRole();
            expect(typeof result).toBe('string');
        });

        it('should default to user if not set', () => {
            const result = service.getDefaultRole();
            expect(result).toBe('user');
        });
    });

    describe('SSR', () => {
        function makeService(platform: 'browser' | 'server'): UserSettingService {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    UserSettingService,
                    { provide: Firestore, useValue: {} },
                    { provide: PLATFORM_ID, useValue: platform },
                ],
            });
            return TestBed.inject(UserSettingService);
        }

        beforeEach(() => {
            vi.mocked(onSnapshot).mockClear();
        });

        it('does not register a Firestore listener during SSR', () => {
            // A listener registered on the server outlives the request injector
            // it captured; the next settings edit then fires @angular/fire's
            // callback against a destroyed injector (NG0205) and kills the
            // process. Both call sites (signup and the settings page) inject
            // this service in a field initializer, so the constructor runs as
            // soon as either route is server-rendered.
            makeService('server');

            expect(onSnapshot).not.toHaveBeenCalled();
        });

        it('falls back to the default role and signup flag during SSR', () => {
            const service = makeService('server');

            expect(service.getDefaultRole()).toBe(DEFAULT_USER_SETTINGS.defaultRole || 'user');
            expect(service.isSignupEnabled()).toBe(DEFAULT_USER_SETTINGS.isSignupEnabled);
        });

        it('registers a listener in the browser', () => {
            makeService('browser');

            expect(onSnapshot).toHaveBeenCalledTimes(1);
        });

        it('ngOnDestroy is safe on the server, where no listener was registered', () => {
            const service = makeService('server');

            expect(() => service.ngOnDestroy()).not.toThrow();
        });
    });
});
