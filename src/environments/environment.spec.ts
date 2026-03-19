/**
 * Tests for Environment Configuration
 */

import { describe, it, expect } from 'vitest';
import { environment } from './environment';

describe('Environment Configuration', () => {
    describe('Development Environment', () => {
        it('should have production set to false', () => {
            expect(environment.production).toBe(false);
        });
    });

    describe('Firebase Configuration', () => {
        it('should have firebaseConfig object', () => {
            expect(environment.firebaseConfig).toBeDefined();
            expect(typeof environment.firebaseConfig).toBe('object');
        });

        it('should have all required Firebase config properties', () => {
            const config = environment.firebaseConfig;
            expect(config).toHaveProperty('apiKey');
            expect(config).toHaveProperty('authDomain');
            expect(config).toHaveProperty('projectId');
            expect(config).toHaveProperty('storageBucket');
            expect(config).toHaveProperty('messagingSenderId');
            expect(config).toHaveProperty('appId');
        });

        it('should have string values for Firebase config properties', () => {
            const config = environment.firebaseConfig;
            expect(typeof config.apiKey).toBe('string');
            expect(typeof config.authDomain).toBe('string');
            expect(typeof config.projectId).toBe('string');
            expect(typeof config.storageBucket).toBe('string');
            expect(typeof config.messagingSenderId).toBe('string');
            expect(typeof config.appId).toBe('string');
        });
    });
});
