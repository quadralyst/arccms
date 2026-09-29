import { describe, expect, it } from 'vitest';
import {
    FEATURE_IDS,
    FEATURE_INFO,
    FeatureChoiceError,
    SWITCHABLE_FEATURE_IDS,
    resolveFeatures,
    type FeatureChoice,
    type FeatureId,
} from './feature-registry';

const sorted = (set: ReadonlySet<FeatureId>) => [...set].sort();
const problem = (choice: unknown, pwaEnabled = false) => {
    try {
        resolveFeatures(choice as FeatureChoice, pwaEnabled);
    } catch (error) {
        expect(error).toBeInstanceOf(FeatureChoiceError);
        return (error as Error).message;
    }
    throw new Error('expected a FeatureChoiceError');
};

describe('feature registry', () => {
    it('describes every feature, and every need is a known feature', () => {
        expect(Object.keys(FEATURE_INFO).sort()).toEqual([...FEATURE_IDS].sort());
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

    it('leaves the PWA out of the switchable list', () => {
        expect(SWITCHABLE_FEATURE_IDS).toEqual(FEATURE_IDS.filter((id) => id !== 'pwa'));
    });
});

describe('resolveFeatures', () => {
    it('turns every feature on for an empty choice', () => {
        expect(sorted(resolveFeatures({}, true))).toEqual([...FEATURE_IDS].sort());
        expect(sorted(resolveFeatures(undefined, true))).toEqual([...FEATURE_IDS].sort());
    });

    it('follows pwa.ts for the PWA', () => {
        expect(resolveFeatures({}, false).has('pwa')).toBe(false);
        expect(resolveFeatures({}, true).has('pwa')).toBe(true);
    });

    it('turns off what the app lists', () => {
        const on = resolveFeatures({ off: ['content', 'sms', 'payments'] }, false);
        expect(on.has('content')).toBe(false);
        expect(on.has('sms')).toBe(false);
        expect(on.has('payments')).toBe(false);
        expect(on.has('search')).toBe(true);
        expect(on.size).toBe(SWITCHABLE_FEATURE_IDS.length - 3);
    });

    it('accepts a feature turned off together with everything that needs it', () => {
        const on = resolveFeatures({ off: ['audience', 'forms', 'email-marketing'] }, false);
        expect(on.has('audience')).toBe(false);
    });

    it('stops on a feature whose need is off, naming both', () => {
        const message = problem({ off: ['audience'] });
        expect(message).toContain('Signup forms (forms) needs Audience (audience)');
        expect(message).toContain('Email marketing (email-marketing) needs Audience (audience)');
        expect(message).toContain('Turn off forms as well, or keep audience.');
    });

    it('stops on an unknown feature and lists the real ones', () => {
        const message = problem({ off: ['payment'] });
        expect(message).toContain('unknown feature "payment"');
        expect(message).toContain(SWITCHABLE_FEATURE_IDS.join(', '));
        expect(message).not.toContain('pwa');
    });

    it('sends the PWA to pwa.ts', () => {
        expect(problem({ off: ['pwa'] })).toContain('src/custom/pwa.ts');
    });

    it('stops when off is not a list', () => {
        expect(problem({ off: 'payments' })).toContain('"off" must be a list');
    });

    it('names the file in every message', () => {
        expect(problem({ off: ['nope'] })).toMatch(/^src\/custom\/features\.ts:\n {2}- /);
    });
});
