/**
 * Core screens show times with arcTime, never Angular's date pipe (specs/clock-and-zones-spec.md,
 * T-D19; docs/app/clock-and-zones.html). `| date` takes a zone only as a fixed offset, so
 * it is wrong on one side of every summer time change, and it ignores the person's zone.
 * Date-only DatePipe calls in code are left for later (spec section 6).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SCANNED = ['src/app', 'src/shared'];

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
    });
}

/** The templates of a file: the file itself for .html, the inline `template:` strings for .ts. */
function templates(path: string, source: string): string[] {
    if (path.endsWith('.html')) return [source];
    return [...source.matchAll(/template:\s*`([\s\S]*?)`/g)].map((m) => m[1]);
}

/** Angular's named formats with a time in them, and the pattern letters for hours, minutes, seconds and AM/PM. */
const NAMED_WITH_TIME = new Set(['short', 'medium', 'long', 'full', 'shortTime', 'mediumTime', 'longTime', 'fullTime']);
function patternHasTime(pattern: string): boolean {
    if (NAMED_WITH_TIME.has(pattern)) return true;
    if (/^(short|medium|long|full)Date$/.test(pattern)) return false;
    return /[hHmsaBb]/.test(pattern.replace(/'[^']*'/g, ''));
}

describe('times on core screens (T-D19)', () => {
    const sources = SCANNED.flatMap((dir) => files(resolve(ROOT, dir))).map((path) => ({
        file: relative(ROOT, path),
        source: readFileSync(path, 'utf8'),
    }));

    it("use arcTime, not Angular's date pipe, in every template", () => {
        const found = sources.flatMap(({ file, source }) =>
            templates(file, source).flatMap((t) => [...t.matchAll(/\|\s*date\b[^}]*/g)].map((m) => `${file}: ${m[0].trim()}`)));
        expect(found, 'Use {{ value | arcTime: format }} (src/app/core/time/arc-time.pipe.ts) instead').toEqual([]);
    });

    it('use ArcTime.format, not DatePipe, for a time of day in code', () => {
        const found = sources.flatMap(({ file, source }) =>
            [...source.matchAll(/datePipe\.transform\([^,]+,\s*'([^']*)'/gi)]
                .filter((m) => patternHasTime(m[1]))
                .map((m) => `${file}: ${m[0]}`));
        expect(found, 'Use ArcTime.format(value, format) (src/app/core/time/arc-time.service.ts) instead').toEqual([]);
    });

    it('tell a pattern with a time from one without', () => {
        expect(patternHasTime('MMM d, y, h:mm a')).toBe(true);
        expect(patternHasTime('HH:mm')).toBe(true);
        expect(patternHasTime('medium')).toBe(true);
        expect(patternHasTime('MMM d, y')).toBe(false);
        expect(patternHasTime('EEE, MMM d, y')).toBe(false);
        expect(patternHasTime("d 'at' MMM")).toBe(false);
        expect(patternHasTime('mediumDate')).toBe(false);
    });
});
