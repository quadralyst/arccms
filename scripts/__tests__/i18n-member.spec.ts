import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { memberGaps } from '../i18n-member.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { pseudo, pseudoFile } from '../i18n-pseudo.mjs';

const ROOT = resolve(__dirname, '../..');
// Through vitest's own loader: it cannot transform a TypeScript file given as a file:// URL.
const keys = () => import('../../src/app/core/i18n/member-keys');

describe('npm run i18n:member', () => {
    it('lists the member keys a language lacks, and the app\'s own', async () => {
        const root = mkdtempSync(join(tmpdir(), 'i18n-member-'));
        try {
            mkdirSync(join(root, 'src/assets/i18n'), { recursive: true });
            mkdirSync(join(root, 'src/custom/i18n'), { recursive: true });
            writeFileSync(join(root, 'src/assets/i18n/en.json'), JSON.stringify({ user: { nav: { home: 'Home', shop: 'Shop' } }, admin: { a: 'A' } }));
            writeFileSync(join(root, 'src/custom/i18n/en.json'), JSON.stringify({ till: { open: 'Open' } }));
            writeFileSync(join(root, 'src/custom/i18n/de.json'), JSON.stringify({ user: { nav: { home: 'Start' } } }));
            expect(await memberGaps('de', root, keys)).toEqual(['till.open', 'user.nav.shop']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('npm run i18n:pseudo', () => {
    it('accents words but keeps {{ params }} and tags', () => {
        expect(pseudo('Hello {{ name }}, <b>sign in</b>')).toBe('[Héllö {{ name }}, <b>šígñ íñ</b>]');
    });

    it('covers only member keys', async () => {
        const file = await pseudoFile(ROOT, keys) as Record<string, unknown>;
        expect(Object.keys(file)).not.toContain('admin');
        expect(file['user']).toBeDefined();
    });
});
