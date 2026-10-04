/**
 * The default templates built into the functions (scripts/arc-site-defaults.mjs):
 * the site's default folder as it serves it, the app's files over Arc CMS's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main, renderSiteDefaults } from '../arc-site-defaults.mjs';

let root: string;
const put = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
};

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arc-site-defaults-'));
    for (const file of ['partials', 'list', 'detail']) put(`public/_site/templates/default/${file}.html`, `<div>core ${file}</div>`);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('arc-site-defaults', () => {
    it('writes the three default templates, the app\'s where it has one', () => {
        put('src/custom/site/templates/default/detail.html', '<div>app detail</div>');
        const code = renderSiteDefaults(root);
        expect(code).toContain('"detail": "<div>app detail</div>"');
        expect(code).toContain('"list": "<div>core list</div>"');
        expect(code).toContain('"partials": "<div>core partials</div>"');
    });

    it('stops when the default folder lacks a file', () => {
        rmSync(join(root, 'public/_site/templates/default/partials.html'));
        expect(() => renderSiteDefaults(root)).toThrow('no partials.html');
    });

    it('writes only when the content changes, and keeps the file when built from the functions folder alone', () => {
        const out = join(root, 'site-defaults.gen.ts');
        expect(main(root, out)).toBe(true);
        expect(main(root, out)).toBe(false);
        const written = readFileSync(out, 'utf8');

        rmSync(join(root, 'public'), { recursive: true });
        expect(main(root, out)).toBe(false);
        expect(readFileSync(out, 'utf8')).toBe(written);

        rmSync(out);
        expect(() => main(root, out)).toThrow('no generated file to keep');
        expect(existsSync(out)).toBe(false);
    });
});
