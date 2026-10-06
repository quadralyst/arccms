import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    ENGLISH, MemberLanguageError, chooseMemberLanguage, firstVisitLanguage, isAdminUrl, resolveMemberLanguages,
} from './member-languages';
import { flattenKeys, isMemberKey, MEMBER_SCREEN_FILES, missingMemberKeys } from './member-keys';
import en from '../../../assets/i18n/en.json';

const ROOT = resolve(__dirname, '../../../..');

describe('member languages (specs/app-member-language-spec.md)', () => {
    it('are English first, then the app\'s, in its order; declaring en changes only English', () => {
        expect(resolveMemberLanguages([])).toEqual([ENGLISH]);
        const list = resolveMemberLanguages([{ code: 'de', label: 'Deutsch', locale: 'de-CH' }, { code: 'en', label: 'English', locale: 'en-GB' }]);
        expect(list.map((l) => `${l.code}:${l.locale}`)).toEqual(['en:en-GB', 'de:de-CH']);
    });

    it('stop the app with a message naming each mistake', () => {
        const bad = () => resolveMemberLanguages([
            { code: 'German', label: '', locale: '' },
            { code: 'de', label: 'Deutsch', locale: 'de-CH' },
            { code: 'de', label: 'Deutsch', locale: 'de-DE' },
        ]);
        expect(bad).toThrow(MemberLanguageError);
        expect(bad).toThrow(/"German" is not a language code[\s\S]*German: give it a label[\s\S]*German: give it a locale[\s\S]*de is declared twice/);
    });

    it('take the first browser language the app has, exact then by its first part, else English', () => {
        expect(firstVisitLanguage(['fr-FR', 'de-AT'], ['en', 'de'])).toBe('de');
        expect(firstVisitLanguage(['pt-BR'], ['en', 'pt-BR', 'pt'])).toBe('pt-BR');
        expect(firstVisitLanguage(['ja'], ['en', 'de'])).toBe('en');
        expect(firstVisitLanguage(undefined, ['en'])).toBe('en');
    });

    it('keep a saved choice the app still has, and forget one it dropped', () => {
        expect(chooseMemberLanguage('de', ['en'], ['en', 'de'])).toBe('de');
        expect(chooseMemberLanguage('fr', ['de'], ['en', 'de'])).toBe('de');
    });

    it('know the admin area by its address', () => {
        for (const url of ['/admin', '/admin/', '/admin/users?x=1', '/admin#top']) expect(isAdminUrl(url), url).toBe(true);
        for (const url of ['/', '/administrator', '/user/admin', '/signup']) expect(isAdminUrl(url), url).toBe(false);
    });
});

describe('member keys (L-D8)', () => {
    /** Keys a file (and the template it names) asks for. */
    function keysIn(file: string): string[] {
        const source = readFileSync(resolve(ROOT, file), 'utf8');
        const template = /templateUrl:\s*'([^']+)'/.exec(source)?.[1];
        const text = source + (template ? readFileSync(resolve(ROOT, file, '..', template), 'utf8') : '');
        return [...text.matchAll(/['"]((?:common|user|admin|member)\.[a-z0-9_]+(?:\.[a-z0-9_]+)+)['"]/g)].map((m) => m[1]);
    }

    it('cover every key a member screen uses, and each of those keys exists', () => {
        const english = new Set(flattenKeys(en));
        const problems = MEMBER_SCREEN_FILES.flatMap((file) => keysIn(file)
            .filter((key) => !isMemberKey(key) || !english.has(key))
            .map((key) => `${file}: ${key}${english.has(key) ? ' is not in the member key list (member-keys.ts)' : ' is not in en.json'}`));
        expect([...new Set(problems)]).toEqual([]);
    });

    it('name what a language still lacks, member core keys and the app\'s own', () => {
        const missing = missingMemberKeys({
            coreEnglish: { user: { nav: { home: 'Home', events: 'Events' } }, admin: { x: 'Admin only' } },
            customEnglish: { desk: { open: 'Open the desk' } },
            translations: [{ user: { nav: { home: 'Start' } } }],
        });
        expect(missing).toEqual(['desk.open', 'user.nav.events']);
    });
});
