/**
 * The app's own notices (notice-text.ts, docs/app/sign-up-notice.html): links written
 * in the text, the placeholders, the language chain and the file check, the same in
 * the app and in its mirror for publishing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as app from './notice-text';
import * as published from '../../../functions/src/shared/notice-text';

const VALUES = {
    terms: { label: 'Terms of Service', url: '/info/terms' },
    privacy: { label: 'Privacy Policy', url: '' },
};

describe.each([['app', app], ['publishing', published]])('notice text (%s)', (_, n) => {
    it('draws links written in the text, any number of them', () => {
        expect(n.noticeParts('Read our [terms](https://acme.example/terms), [cookies](/p/cookies) or [write](mailto:legal@acme.example).', VALUES)).toEqual([
            { text: 'Read our ' },
            { text: 'terms', href: 'https://acme.example/terms' },
            { text: ', ' },
            { text: 'cookies', href: '/p/cookies' },
            { text: ' or ' },
            { text: 'write', href: 'mailto:legal@acme.example' },
            { text: '.' },
        ]);
    });

    it('shows a link to anywhere else as plain text', () => {
        for (const target of ['javascript:alert`1`', 'JavaScript:void0', 'http://acme.example', '//evil.example/x', 'data:text/html,hi', 'p/terms', '/a b', '/\\evil.example']) {
            expect(n.noticeParts(`Our [terms](${target}).`, VALUES), target).toEqual([{ text: 'Our terms.' }]);
        }
        // A target with brackets ends at the first one: still no link.
        expect(n.noticeParts('Our [terms](javascript:alert(1)).', VALUES).some((p) => p.href)).toBe(false);
    });

    it('keeps {terms} and {privacy}: the label, linked when the site has the page', () => {
        expect(n.noticeParts('Agree to {terms} and {privacy}.', VALUES)).toEqual([
            { text: 'Agree to ' },
            { text: 'Terms of Service', href: '/info/terms' },
            { text: ' and Privacy Policy.' },
        ]);
    });

    it('lets a link go to a placeholder\'s page with its own words', () => {
        expect(n.noticeParts('Es gelten die [AGB]({terms}) und der [Datenschutz]({privacy}).', VALUES)).toEqual([
            { text: 'Es gelten die ' },
            { text: 'AGB', href: '/info/terms' },
            { text: ' und der Datenschutz.' },
        ]);
    });

    it('never shows an unknown placeholder', () => {
        expect(n.noticeParts('Hello {name}, see [x]({cookies}).', VALUES).map((p) => p.text).join('')).toBe('Hello , see x.');
    });

    it('finds the page\'s language, then the site\'s default, then English', () => {
        const notices = { signup: { de: 'DE', en: 'EN', fr: 'FR' } };
        expect(n.noticeText(notices, 'signup', 'de-CH', 'en')).toBe('DE');
        expect(n.noticeText({ signup: { 'de-ch': 'CH', de: 'DE' } }, 'signup', 'de-CH')).toBe('CH');
        expect(n.noticeText(notices, 'signup', 'ta', 'fr')).toBe('FR');
        expect(n.noticeText(notices, 'signup', 'ta', 'ja')).toBe('EN');
        expect(n.noticeText({ signup: { de: 'DE' } }, 'signup', 'ta', 'ja')).toBeNull();
        expect(n.noticeText({ signup: { de: '  ' } }, 'signup', 'de')).toBeNull();
        expect(n.noticeText({ signup: {}, contact: {} }, 'contact', 'en')).toBeNull();
        expect(n.noticeText(undefined, 'signup', 'en')).toBeNull();
    });

    it('finds every mistake in the file, and none in a good one', () => {
        expect(n.noticeProblems({ signup: {}, contact: {} })).toEqual([]);
        expect(n.noticeProblems({
            signup: { de: 'Mit der Anmeldung stimmst du den [AGB]({terms}) und {privacy} zu. [Cookies](/p/cookies), [Mail](mailto:a@b.example).' },
        })).toEqual([]);
        const problems = n.noticeProblems({
            signup: {
                en: 'Our [terms](javascript:alert(1)) and {cookies}.',
                de: 'Die [AGB](/p/agb und mehr.',
                'not a code': 'x',
                fr: '',
            },
            contact: { en: 'See [it]({cookie}).' },
            footer: {},
        });
        expect(problems.join('\n')).toMatch(/signup\.en: \[terms\]\(javascript:alert\(1\) links to "javascript:alert\(1"/);
        expect(problems.join('\n')).toMatch(/signup\.en: \{cookies\} is not a placeholder/);
        expect(problems.join('\n')).toMatch(/signup\.de: has a link or placeholder that is not closed/);
        expect(problems.join('\n')).toMatch(/"not a code" is not a language code/);
        expect(problems.join('\n')).toMatch(/signup\.fr must be a text/);
        expect(problems.join('\n')).toMatch(/contact\.en: \[it\]\(\{cookie\}\) links to \{cookie\}/);
        expect(problems.join('\n')).toMatch(/"footer" is not a notice/);
        expect(n.noticeProblems([])).toHaveLength(1);
    });
});

describe('notice text mirror', () => {
    it('is the same code in the app and in publishing, apart from its opening comment', () => {
        const body = (file: string) => readFileSync(file, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
        expect(body(join(__dirname, '../../../functions/src/shared/notice-text.ts'))).toBe(body(join(__dirname, 'notice-text.ts')));
    });
});

describe('the notices check', () => {
    it('stops npm run dev and npm run build on a broken notices file', () => {
        const config = readFileSync(join(__dirname, '../../../vite.config.ts'), 'utf8');
        expect(config).toContain("import { CUSTOM_NOTICES } from './src/custom/notices';");
        expect(config).toMatch(/const noticeErrors = noticeProblems\(CUSTOM_NOTICES\);\s*if \(noticeErrors\.length\) throw new Error/);
        // ...and hands them to the site build, which serves them for publishing.
        expect(config).toContain('arcSite({ notices: CUSTOM_NOTICES })');
    });
});

