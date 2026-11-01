/**
 * APP_VERSION and the version under Logout (specs/app-version-spec.md, AV-D8 and AV-D9).
 */
import { describe, expect, it } from 'vitest';
import { APP_VERSION, NO_APP_VERSION, panelVersion, type AppVersion } from './app-version';

const built: AppVersion = { text: 'v1.2.0.25 android', version: '1.2.0', build: 25, label: 'android', commit: '533b6d02' };

describe('APP_VERSION', () => {
    it('is no version where Vite did not build the code, as in the tests', () => {
        expect(APP_VERSION).toEqual(NO_APP_VERSION);
        expect(NO_APP_VERSION).toEqual({ text: '', version: '', build: null, label: '', commit: '' });
    });
});

describe('panelVersion', () => {
    it('is the version text by default', () => {
        expect(panelVersion(built, {})).toBe('v1.2.0.25 android');
        expect(panelVersion(built, { showVersion: true })).toBe('v1.2.0.25 android');
    });

    it('is empty when the app turns it off, or there is no version', () => {
        expect(panelVersion(built, { showVersion: false })).toBe('');
        expect(panelVersion(NO_APP_VERSION, {})).toBe('');
    });
});
