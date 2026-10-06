/**
 * Empty values never match (specs/app-accounts-spec.md, C-D13): accounts without an
 * email or a phone store '', so every exact lookup by email or phone checks isBlank()
 * first. This fails on a lookup added without that check.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isBlank } from '../shared/blank.js';

const SRC = resolve(__dirname, '..');
const LOOKUP = /\.where\(\s*['"](email|phone)['"]\s*,\s*['"]==['"]/;
/** How far above a lookup its isBlank() check may be: the same function, in practice. */
const WINDOW = 40;

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
        return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
    });
}

describe('lookups by exact email or phone', () => {
    it('isBlank catches missing, empty and space-only values', () => {
        for (const value of [undefined, null, '', '   ', 7]) expect(isBlank(value)).toBe(true);
        expect(isBlank('a@b.co')).toBe(false);
    });

    it('each check isBlank() shortly before they query, in every file', () => {
        const files = sources(SRC).filter((f) => LOOKUP.test(readFileSync(f, 'utf8')));
        expect(files.length).toBeGreaterThan(5);
        const problems = files.flatMap((file) => {
            const lines = readFileSync(file, 'utf8').split('\n');
            return lines.flatMap((line, i) => {
                if (!LOOKUP.test(line) && !(LOOKUP.test(`${lines[i - 1] ?? ''}${line}`) && /^\s*\.where/.test(line))) return [];
                const before = lines.slice(Math.max(0, i - WINDOW), i + 1).join('\n');
                return /\bisBlank\(/.test(before) ? [] : [`${relative(SRC, file)}:${i + 1}: no isBlank() check before this lookup`];
            });
        });
        expect(problems).toEqual([]);
    });
});
