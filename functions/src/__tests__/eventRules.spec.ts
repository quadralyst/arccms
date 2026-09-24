/** Rules within an event mapping (docs/coexistence-spec.md 5b, CO6.4). */
import { describe, it, expect } from 'vitest';
import { applicableRules, conditionText, matchesCondition } from '../email-core/eventRules.js';

describe('matchesCondition', () => {
    it('treats empty, null and missing as the same value', () => {
        expect(conditionText(undefined)).toBe('');
        expect(matchesCondition({ equals: '' }, null)).toBe(true);
        expect(matchesCondition({ anyOf: ['', 'free'] }, undefined)).toBe(true);
    });

    it('compares as text, so booleans and numbers match however they were written', () => {
        expect(matchesCondition({ equals: true }, 'true')).toBe(true);
        expect(matchesCondition({ equals: 'true' }, true)).toBe(true);
        expect(matchesCondition({ equals: 3 }, '3')).toBe(true);
        expect(matchesCondition({ equals: true }, 'false')).toBe(false);
    });

    it('supports any of and none of', () => {
        expect(matchesCondition({ anyOf: ['pro', 'business'] }, 'pro')).toBe(true);
        expect(matchesCondition({ anyOf: ['pro', 'business'] }, 'free')).toBe(false);
        expect(matchesCondition({ noneOf: ['', 'free'] }, 'pro')).toBe(true);
        expect(matchesCondition({ noneOf: ['', 'free'] }, '')).toBe(false);
    });

    it('matches anything without a condition', () => {
        expect(matchesCondition(undefined, 'x')).toBe(true);
        expect(matchesCondition({}, 'x')).toBe(true);
    });
});

describe('applicableRules', () => {
    const upgrade = { name: 'Upgraded', when: { from: { anyOf: ['', 'free'] }, to: { noneOf: ['', 'free'] } } };
    const downgrade = { name: 'Downgraded', when: { from: { noneOf: ['', 'free'] }, to: { anyOf: ['', 'free'] } } };

    it('picks upgrade and downgrade from the old and new value', () => {
        const mapping = { enabled: true, rules: [upgrade, downgrade] };
        expect(applicableRules(mapping, { from: 'free', to: 'pro' }).map((r) => r.name)).toEqual(['Upgraded']);
        expect(applicableRules(mapping, { from: 'pro', to: '' }).map((r) => r.name)).toEqual(['Downgraded']);
        expect(applicableRules(mapping, { from: 'pro', to: 'business' })).toEqual([]);
    });

    it('keeps the mapping\'s own actions as an unconditional first rule', () => {
        const mapping = { enabled: true, addToLists: ['a'], rules: [upgrade] };
        expect(applicableRules(mapping, { from: 'free', to: 'pro' })).toEqual([{ name: 'default', addToLists: ['a'] }, upgrade]);
    });

    it('returns nothing for a mapping with no actions and no rules', () => {
        expect(applicableRules({ enabled: true }, {})).toEqual([]);
    });
});
