/**
 * No em or en dash in what a person reads: the translation files, templates and strings in
 * code, including the emails the functions write. Comments and server log lines are for
 * developers and may have them. The docs have the same check (scripts/docs-checks.mjs).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The characters, and how they are written in HTML and in code. */
const LONG_DASH = /[\u2013\u2014]|&mdash;|&ndash;|&#821[12];|&#x201[34];|\\u201[34]/i;
const ROOT = process.cwd();
const AREAS = ['src/app', 'src/shared', 'src/assets/i18n', 'functions/src', 'public/_site/templates'];
/** An app's own space and the build's working copies are not Arc CMS's text. */
const SKIPPED_FOLDER = /(^|\/)(custom|node_modules|lib)(\/|$)/;
/** Generated from an app's own files (site-defaults.gen.ts holds its default template). */
const GENERATED = /\.gen\.ts$/;

function filesIn(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) return SKIPPED_FOLDER.test(relative(ROOT, path)) ? [] : filesIn(path);
        return /\.(ts|html|json)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') && !GENERATED.test(entry.name) ? [path] : [];
    });
}

/** The lines of a file a person can read: comments and log lines go, keeping the line numbers. */
function readableLines(source: string): string[] {
    const blanked = (comment: string) => comment.replace(/[^\n]/g, ' ');
    return source
        .replace(/<!--[\s\S]*?-->/g, blanked)
        .replace(/\/\*[\s\S]*?\*\//g, blanked)
        .split('\n')
        .map((line) => (/\b(logger|console)\.\w+\(/.test(line) ? '' : line.replace(/(^|[^:'"`])\/\/.*$/, '$1')));
}

describe('long dashes', () => {
    it('are not in any text a person reads', () => {
        const found = AREAS.flatMap((area) => filesIn(join(ROOT, area))).flatMap((file) =>
            readableLines(readFileSync(file, 'utf8')).flatMap((line, index) =>
                LONG_DASH.test(line) ? [`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`] : [],
            ),
        );
        expect(found).toEqual([]);
    });

    it('are found in a string, and left alone in a comment or a log line', () => {
        const dash = '—';
        const lines = (source: string) => readableLines(source).filter((line) => LONG_DASH.test(line));

        expect(lines(`toast.success('Saved ${dash} done');`)).toHaveLength(1);
        expect(lines(`<p>Saved ${dash} done</p>`)).toHaveLength(1);
        expect(lines('<p>Version 3 &mdash; today</p>')).toHaveLength(1);
        expect(lines('<p>1 &#8211; 2</p>')).toHaveLength(1);
        expect(lines("const t = 'x \\u2014 y';")).toHaveLength(1);
        expect(lines(`const url = 'https://a.b/c'; const t = 'x ${dash} y';`)).toHaveLength(1);
        expect(lines(`// a note ${dash} here`)).toHaveLength(0);
        expect(lines(`const a = 1; // a note ${dash} here`)).toHaveLength(0);
        expect(lines(`/* a note\n ${dash} here */`)).toHaveLength(0);
        expect(lines(`<!-- a note\n ${dash} here -->`)).toHaveLength(0);
        expect(lines(`logger.warn('Skipping ${dash} stale');`)).toHaveLength(0);
    });
});
