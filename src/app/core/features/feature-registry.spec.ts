import { describe, expect, it } from 'vitest';
import { FEATURE_IDS, FEATURE_INFO, FeatureChoiceError, resolveFeatures, type FeatureChoice, type FeatureId } from './feature-registry';
import { resolvePwaConfig } from '../pwa/pwa-config';

const DEFAULT_ON = FEATURE_IDS.filter((id) => id !== 'pwa');
const sorted = (ids: Iterable<FeatureId>) => [...ids].sort();
const problem = (choice: unknown) => {
    try {
        resolveFeatures(choice as FeatureChoice);
    } catch (error) {
        expect(error).toBeInstanceOf(FeatureChoiceError);
        return (error as Error).message;
    }
    throw new Error('expected a FeatureChoiceError');
};

describe('feature registry', () => {
    it('describes every feature, and every need is a known feature', () => {
        expect(Object.keys(FEATURE_INFO).sort()).toEqual(sorted(FEATURE_IDS));
        for (const info of Object.values(FEATURE_INFO)) {
            for (const need of info.needs) expect(FEATURE_IDS).toContain(need);
        }
    });

    it('has no cycle of needs', () => {
        const visit = (id: FeatureId, path: FeatureId[]): void => {
            expect(path).not.toContain(id);
            for (const need of FEATURE_INFO[id].needs) visit(need, [...path, id]);
        };
        for (const id of FEATURE_IDS) visit(id, []);
    });

    it('has only the PWA off by default', () => {
        expect(FEATURE_IDS.filter((id) => !FEATURE_INFO[id].defaultOn)).toEqual(['pwa']);
    });
});

describe('resolveFeatures', () => {
    it('turns every feature on except the PWA for an empty choice', () => {
        expect(sorted(resolveFeatures({}))).toEqual(sorted(DEFAULT_ON));
        expect(sorted(resolveFeatures(undefined))).toEqual(sorted(DEFAULT_ON));
    });

    it('turns the PWA on when the app asks', () => {
        expect(resolveFeatures({ on: ['pwa'] }).has('pwa')).toBe(true);
    });

    it('accepts a default-on feature in "on" as a no-op', () => {
        expect(sorted(resolveFeatures({ on: ['content'] }))).toEqual(sorted(DEFAULT_ON));
    });

    it('turns off what the app lists', () => {
        const on = resolveFeatures({ off: ['content', 'sms', 'payments'] });
        expect(on.has('content')).toBe(false);
        expect(on.has('sms')).toBe(false);
        expect(on.has('payments')).toBe(false);
        expect(on.has('search')).toBe(true);
        expect(on.size).toBe(DEFAULT_ON.length - 3);
    });

    it('accepts a feature turned off together with everything that needs it', () => {
        expect(resolveFeatures({ off: ['audience', 'forms', 'email-marketing'] }).has('audience')).toBe(false);
    });

    it('stops on a feature whose need is off, naming both', () => {
        const message = problem({ off: ['audience'] });
        expect(message).toContain('Signup forms (forms) needs Audience (audience)');
        expect(message).toContain('Email marketing (email-marketing) needs Audience (audience)');
        expect(message).toContain('Turn off forms as well, or keep audience.');
    });

    it('stops on an unknown feature in either list and lists the real ones', () => {
        expect(problem({ off: ['payment'] })).toContain(`unknown feature "payment" in "off". Features: ${FEATURE_IDS.join(', ')}`);
        expect(problem({ on: ['pwaa'] })).toContain('unknown feature "pwaa" in "on"');
    });

    it('stops on a feature in both lists', () => {
        expect(problem({ on: ['pwa'], off: ['pwa'] })).toContain('Installable app (pwa) is in both "on" and "off"');
    });

    it('stops when a list is not a list', () => {
        expect(problem({ off: 'payments' })).toContain('"off" must be a list');
        expect(problem({ on: 'pwa' })).toContain('"on" must be a list');
    });

    it('names the file in every message', () => {
        expect(problem({ off: ['nope'] })).toMatch(/^src\/custom\/features\.ts:\n {2}- /);
    });
});

describe('resolvePwaConfig', () => {
    it('takes the switch from the features', () => {
        expect(resolvePwaConfig({}, true).enabled).toBe(true);
        expect(resolvePwaConfig(undefined, false).enabled).toBe(false);
    });

    it('stops an app that still switches the PWA in pwa.ts, saying where the switch went', () => {
        expect(() => resolvePwaConfig({ enabled: true }, false)).toThrow("add on: ['pwa'] to CUSTOM_FEATURES");
    });
});
