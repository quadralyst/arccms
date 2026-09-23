import { describe, it, expect } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { planUpgrade, codebaseOf } from '../arc-upgrade.mjs';

describe('arc-upgrade plan (CO4)', () => {
    const arcNames = ['onUserCreated', 'search', 'dodoWebhook'];

    it('deletes only old-name ArcCMS functions, grouped by region', () => {
        const plan = planUpgrade([
            { id: 'onUserCreated', region: 'us-central1', labels: { 'firebase-functions-codebase': 'default' } },
            { id: 'search', region: 'us-central1' },
            { id: 'onWaitlistUserDeleted', region: 'asia-south1' },
        ], arcNames);
        expect(plan.byRegion).toEqual({ 'us-central1': ['onUserCreated', 'search'] });
        expect(plan.count).toBe(2);
    });

    it("never touches another app's functions, whatever codebase they are in", () => {
        const plan = planUpgrade([
            { id: 'onJobsCreate', region: 'us-central1', labels: { 'firebase-functions-codebase': 'functions' } },
            { id: 'onUserCreate', region: 'us-central1' },
        ], arcNames);
        expect(plan.count).toBe(0);
    });

    it('leaves functions already in the arccms and arccms-legacy codebases alone, so it can be rerun', () => {
        const plan = planUpgrade([
            { id: 'search', region: 'us-central1', labels: { 'firebase-functions-codebase': 'arccms-legacy' } },
            { id: 'dodoWebhook', region: 'us-central1', codebase: 'arccms' },
        ], arcNames);
        expect(plan.count).toBe(0);
        expect(codebaseOf({})).toBe('default');
    });
});
