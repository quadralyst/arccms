/**
 * RF6 6.8: the shipped site files a published page is built from. Each content
 * template has one <main> around its content, links that open a new tab carry
 * rel="noopener", "Back to" is translated through the site strings, and the menu
 * button and the language switcher have a name in the page's language.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '../../public/_site');
const read = (path: string) => readFileSync(join(SITE, path), 'utf8');
const templates = readdirSync(join(SITE, 'templates')).flatMap((folder) =>
    readdirSync(join(SITE, 'templates', folder))
        .filter((file) => file.endsWith('.html') && file !== 'partials.html')
        .map((file) => `templates/${folder}/${file}`));
const pages = [...templates, 'header.html', 'footer.html', 'home.html',
    ...readdirSync(join(SITE, 'pages')).map((file) => `pages/${file}`)];

describe('the shipped site files', () => {
    it('has one <main> between the header and the footer of every content template', () => {
        expect(templates.length).toBeGreaterThan(8);
        for (const file of templates) {
            const html = read(file);
            expect(html.match(/<main\b/g), file).toHaveLength(1);
            const [header, open, close, footer] = ['<arc-header', '<main', '</main>', '<arc-footer'].map((tag) => html.indexOf(tag));
            expect(header < open && open < close && close < footer, file).toBe(true);
        }
    });

    it('gives every link that opens a new tab rel="noopener"', () => {
        for (const file of pages) {
            for (const link of read(file).match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) {
                expect(link, file).toMatch(/\srel="[^"]*noopener/);
            }
        }
    });

    it('translates every "Back to" through the site strings', () => {
        for (const file of templates) {
            for (const line of read(file).split('\n').filter((l) => /Back to \{\{/.test(l))) {
                expect(line, file).toContain('data-arc-t="back_to"');
            }
        }
        expect(JSON.parse(read('strings/hi.json'))['back_to']).toBeTruthy();
    });

    it('names the menu button in the page\'s language', () => {
        const button = read('header.html').match(/<button\b[^>]*navbar-toggler[^>]*>/)![0];
        expect(button).toContain('aria-label="Menu"');
        expect(button).toContain('data-arc-t-attr="aria-label:menu_label"');
    });

    it('has the Hindi for the new strings, and not the removed error panel\'s', () => {
        const hi = JSON.parse(read('strings/hi.json'));
        for (const key of ['menu_label', 'language_label', 'signup_offline']) expect(hi[key], key).toBeTruthy();
        for (const key of ['signup_error_title', 'signup_try_again']) expect(hi, key).not.toHaveProperty(key);
    });
});

// The plain pages Hosting serves on its own: out of search, plain words, nothing from a CDN.
describe('the plain 403 and 404 pages', () => {
    const plain = (file: string) => readFileSync(join(__dirname, '../../public', file), 'utf8');

    it('say what happened in plain words, out of search, with nothing loaded from elsewhere', () => {
        for (const [file, heading] of [['404.html', 'Page not found'], ['403.html', 'No access']]) {
            const html = plain(file);
            expect(html, file).toContain('<meta name="robots" content="noindex">');
            expect(html, file).toMatch(new RegExp(`<h1[^>]*>${heading}</h1>`));
            expect(html, file).not.toMatch(/>40[34]<|Oops|Access Denied/);
            if (file === '404.html') expect(html).not.toMatch(/https?:\/\/(cdn|fonts)\./);
        }
    });
});
