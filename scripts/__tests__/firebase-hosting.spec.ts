import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const firebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const rewrites: Array<{ source: string; destination?: string; function?: { functionId: string } }> = firebase.hosting.rewrites;
const group: string = firebase.functions[0].codebase;

const functionSource = (path: string) => readFileSync(join(ROOT, 'functions/src', path), 'utf8');

describe('firebase.json hosting rewrites for public email links', () => {
    const cases = [
        { path: '/unsubscribe', functionName: 'handleUnsubscribe', file: 'email-core/handleUnsubscribe.ts' },
        { path: '/email-preferences', functionName: 'handleEmailPreferences', file: 'email-core/handleEmailPreferences.ts' },
    ];

    for (const { path, functionName, file } of cases) {
        it(`sends ${path} to the ${group}-${functionName} function, before the catch-all`, () => {
            const index = rewrites.findIndex((r) => r.source === path);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(rewrites[index].function?.functionId).toBe(`${group}-${functionName}`);
            expect(index).toBeLessThan(rewrites.findIndex((r) => r.source === '**'));
            expect(functionSource(file)).toContain(`export const ${functionName} = onRequest(`);
        });
    }

    it('matches the exact paths only, so the old /unsubscribe/:waitlistId/:userId pages still reach the app', () => {
        for (const { path } of cases) expect(path).not.toMatch(/[*:]/);
    });

    it('builds the emailed links on the same paths', () => {
        const source = functionSource('email-core/unsubscribeToken.ts');
        expect(source).toContain('}unsubscribe?e=');
        expect(source).toContain('}email-preferences?e=');
    });
});
