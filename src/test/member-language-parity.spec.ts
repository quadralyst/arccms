/**
 * Every language an app adds for its members has every member-facing core key and every
 * key of the app's own English file (specs/app-member-language-spec.md, L-D10).
 * Names each missing key. A language marked `partial` is reported, not failed, while
 * it is being translated. With no languages declared this passes trivially.
 */
import { describe, expect, it } from 'vitest';
import { MEMBER_LANGUAGES } from '../custom/languages';
import { languageParity } from '../app/core/i18n/member-keys';

const byCode = (files: Record<string, { default: unknown }>) =>
    Object.fromEntries(Object.entries(files).map(([path, mod]) => [/([^/]+)\.json$/.exec(path)![1], mod.default]));
const core = byCode(import.meta.glob<{ default: unknown }>('../assets/i18n/*.json', { eager: true }));
const custom = byCode(import.meta.glob<{ default: unknown }>('../custom/i18n/*.json', { eager: true }));

describe('member languages the app declares', () => {
    const results = languageParity(MEMBER_LANGUAGES, core, custom);

    it('each have every member key (a partial one is listed as a warning)', () => {
        for (const r of results.filter((r) => r.partial && r.missing.length)) {
            console.warn(`${r.code} (partial) still lacks ${r.missing.length} key(s):\n  ${r.missing.join('\n  ')}`);
        }
        const failing = results.filter((r) => !r.partial && r.missing.length)
            .map((r) => `${r.code} lacks: ${r.missing.join(', ')} (add them to src/custom/i18n/${r.code}.json, or mark the language partial)`);
        expect(failing).toEqual([]);
    });
});

describe('the parity check itself, with a fake language', () => {
    const fakeCore = { en: { user: { nav: { home: 'Home', events: 'Events' } }, member: { auth: { title: 'Sign in' } }, admin: { x: 'Admin' } } };
    const fakeCustom = { en: { desk: { open: 'Open the desk' } }, zz: { user: { nav: { home: 'Zome' } }, member: { auth: { title: 'Zign in' } } } };

    it('names each missing key: core member keys and the app\'s own, never admin keys', () => {
        const [zz] = languageParity([{ code: 'zz' }], fakeCore, fakeCustom);
        expect(zz).toEqual({ code: 'zz', partial: false, missing: ['desk.open', 'user.nav.events'] });
    });

    it('marks a partial language, and skips English', () => {
        expect(languageParity([{ code: 'en' }, { code: 'zz', partial: true }], fakeCore, fakeCustom).map((r) => [r.code, r.partial])).toEqual([['zz', true]]);
    });
});

describe('the worked example in docs/app/member-languages.html', () => {
    it('uses member keys that exist in English', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const { flattenKeys, isMemberKey } = await import('../app/core/i18n/member-keys');
        const page = readFileSync(resolve(__dirname, '../../docs/app/member-languages.html'), 'utf8');
        const example = /<pre><code>(\{\s*\n\s*"member"[\s\S]*?)<\/code><\/pre>/.exec(page)?.[1];
        expect(example, 'the German example is on the page').toBeTruthy();
        const coreKeys = flattenKeys(JSON.parse(example!)).filter((key) => !key.startsWith('custom.'));
        const english = new Set(flattenKeys(core['en']));
        expect(coreKeys.length).toBeGreaterThan(0);
        expect(coreKeys.filter((key) => !english.has(key) || !isMemberKey(key))).toEqual([]);
    });
});
