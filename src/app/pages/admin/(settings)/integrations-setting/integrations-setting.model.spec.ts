import { describe, it, expect } from 'vitest';
import { DEFAULT_INTEGRATIONS_SETTINGS } from './integrations-setting.model';

describe('IntegrationsSettingModel', () => {
    describe('DEFAULT_INTEGRATIONS_SETTINGS', () => {
        it('should have an unsplash object', () => {
            expect(DEFAULT_INTEGRATIONS_SETTINGS.unsplash).toBeDefined();
        });

        it('should have empty accessKey by default', () => {
            expect(DEFAULT_INTEGRATIONS_SETTINGS.unsplash.accessKey).toBe('');
        });

        it('should have empty secretKey by default', () => {
            expect(DEFAULT_INTEGRATIONS_SETTINGS.unsplash.secretKey).toBe('');
        });

        it('should not have an id by default', () => {
            expect(DEFAULT_INTEGRATIONS_SETTINGS.id).toBeUndefined();
        });
    });
});
