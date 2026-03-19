import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_GLOBAL_MESSAGE_SETTINGS, GRADIENT_PRESETS, getGradientById, IGlobalMessageSettings } from './global-message.model';

/**
 * Tests for Global Message Model
 * Service tests are omitted as the service requires Firebase which is complex to mock
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
