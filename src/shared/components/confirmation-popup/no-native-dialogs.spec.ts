/**
 * No screen asks with the browser's own confirm() or alert() (RF4, 4.10).
 *
 * The browser's box is in the browser's language, cannot be styled, puts focus
 * on OK, and a test cannot answer it. Ask with ConfirmService.ask() (the
 * confirmation dialog) and show failures with NotifyService instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const SCANNED = ['src/app', 'src/shared'];
/** A bare or window. confirm( / alert( call; method calls such as `this.confirm(` are fine. */
const NATIVE = /(?:^|[^.\w$])(?:window\.)?(?:confirm|alert)\s*\(/;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
    });
}

/** Lines that call the browser's dialog, without comments (a comment may name it). */
function nativeCalls(path: string): string[] {
    return readFileSync(path, 'utf8').split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
        // A method of the component's own: its declaration, or a template event binding calling it.
        .filter((line) => NATIVE.test(line)
            && !/\b(?:async\s+)?(?:confirm|alert)\s*\([^)]*\)\s*[:{]/.test(line)
            && !/\)="[^"]*\b(?:confirm|alert)\s*\(/.test(line));
}

describe('native dialogs', () => {
    it('no admin or shared screen calls confirm() or alert()', () => {
        const found = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
            .flatMap((path) => nativeCalls(path).map((line) => `${relative(ROOT, path)}: ${line.trim()}`));
        expect(found).toEqual([]);
    });

    it('the check finds one', () => {
        expect(NATIVE.test("if (!confirm('Delete?')) return;")).toBe(true);
        expect(NATIVE.test("window.alert('Failed');")).toBe(true);
        expect(NATIVE.test('this.confirm();')).toBe(false);
        expect(NATIVE.test('await this.freshCode.confirm({ purpose })')).toBe(false);
    });
});
