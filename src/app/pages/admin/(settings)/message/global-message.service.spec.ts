import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_GLOBAL_MESSAGE_SETTINGS, GRADIENT_PRESETS, getGradientById, IGlobalMessageSettings } from './global-message.model';

const { mockOnSnapshot, mockUnsubscribe } = vi.hoisted(() => ({
    mockOnSnapshot: vi.fn(),
    mockUnsubscribe: vi.fn(),
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class Firestore { },
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(() => ({})),
    onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
}));

import { Firestore } from '@angular/fire/firestore';
import { GlobalMessageService } from './global-message.service';

/**
 * Tests for Global Message Model
 */
describe('Global Message Model', () => {
    describe('DEFAULT_GLOBAL_MESSAGE_SETTINGS', () => {
        it('should have message disabled by default', () => {
            expect(DEFAULT_GLOBAL_MESSAGE_SETTINGS.isEnabled).toBe(false);
        });

        it('should have info-blue as default gradient', () => {
            expect(DEFAULT_GLOBAL_MESSAGE_SETTINGS.gradientId).toBe('info-blue');
        });

        it('should have empty strings for all text fields', () => {
            expect(DEFAULT_GLOBAL_MESSAGE_SETTINGS.heading).toBe('');
            expect(DEFAULT_GLOBAL_MESSAGE_SETTINGS.message).toBe('');
            expect(DEFAULT_GLOBAL_MESSAGE_SETTINGS.buttonLabel).toBe('');
            expect(DEFAULT_GLOBAL_MESSAGE_SETTINGS.buttonLink).toBe('');
        });
    });

    describe('GRADIENT_PRESETS', () => {
        it('should have six gradient presets', () => {
            expect(GRADIENT_PRESETS.length).toBe(6);
        });

        it('should have correct preset IDs', () => {
            const ids = GRADIENT_PRESETS.map(g => g.id);
            expect(ids).toContain('info-blue');
            expect(ids).toContain('warning-amber');
            expect(ids).toContain('success-green');
            expect(ids).toContain('urgent-red');
            expect(ids).toContain('ocean-blue');
            expect(ids).toContain('ocean-teal');
        });

        it('should have gradient and textColor for each preset', () => {
            GRADIENT_PRESETS.forEach(preset => {
                expect(preset.gradient).toBeDefined();
                expect(preset.gradient).toContain('linear-gradient');
                expect(preset.textColor).toBeDefined();
                expect(preset.textColor).toMatch(/^#[0-9a-fA-F]{6}$/);
            });
        });

        it('should have a name for each preset', () => {
            GRADIENT_PRESETS.forEach(preset => {
                expect(preset.name).toBeDefined();
                expect(preset.name.length).toBeGreaterThan(0);
            });
        });
    });

    describe('getGradientById', () => {
        it('should return correct gradient for valid ID', () => {
            const gradient = getGradientById('ocean-teal');
            expect(gradient.id).toBe('ocean-teal');
            expect(gradient.name).toBe('Ocean Teal');
        });

        it('should return first gradient for invalid ID', () => {
            const gradient = getGradientById('invalid-id');
            expect(gradient.id).toBe('info-blue');
        });

        it('should return first gradient for empty string', () => {
            const gradient = getGradientById('');
            expect(gradient.id).toBe('info-blue');
        });

        it('should return gradient with proper structure', () => {
            const gradient = getGradientById('ocean-blue');
            expect(gradient).toHaveProperty('id');
            expect(gradient).toHaveProperty('name');
            expect(gradient).toHaveProperty('gradient');
            expect(gradient).toHaveProperty('textColor');
        });
    });

    describe('IGlobalMessageSettings interface usage', () => {
        it('should accept valid settings object', () => {
            const settings: IGlobalMessageSettings = {
                isEnabled: true,
                heading: 'Test Heading',
                message: 'Test Message',
                buttonLabel: 'Click Me',
                buttonLink: 'https://example.com',
                gradientId: 'ocean-teal',
            };

            expect(settings.isEnabled).toBe(true);
            expect(settings.heading).toBe('Test Heading');
            expect(settings.gradientId).toBe('ocean-teal');
        });

        it('should work with optional id field', () => {
            const settings: IGlobalMessageSettings = {
                ...DEFAULT_GLOBAL_MESSAGE_SETTINGS,
                id: 'test-id',
            };

            expect(settings.id).toBe('test-id');
        });
    });
});

describe('GlobalMessageService', () => {
    function makeService(platform: 'browser' | 'server'): GlobalMessageService {
        TestBed.configureTestingModule({
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: PLATFORM_ID, useValue: platform },
            ],
        });
        return TestBed.inject(GlobalMessageService);
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        mockOnSnapshot.mockReturnValue(mockUnsubscribe);
    });

    it('does not register a Firestore listener during SSR', () => {
        // The banner is rendered from the root App component, so this service is
        // constructed on every server render. A listener registered there
        // outlives the request injector it captured; the next settings edit then
        // fires @angular/fire's callback against a destroyed injector (NG0205)
        // and kills the process.
        makeService('server');

        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    it('still emits the default settings synchronously during SSR', async () => {
        // The banner reads settings$ via toSignal({ requireSync: true }), so the
        // subject must still emit on subscribe with no listener attached.
        const service = makeService('server');

        const emitted = await new Promise((resolve) => {
            service.settings$.subscribe(resolve);
        });

        expect(emitted).toEqual(DEFAULT_GLOBAL_MESSAGE_SETTINGS);
    });

    it('registers a listener in the browser', () => {
        makeService('browser');

        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    });

    it('drops the listener when the injector is destroyed', () => {
        const service = makeService('browser');

        service.ngOnDestroy();

        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('ngOnDestroy is safe on the server, where no listener was registered', () => {
        const service = makeService('server');

        expect(() => service.ngOnDestroy()).not.toThrow();
        expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
});
