import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../../custom/languages', () => ({ MEMBER_LANGUAGES: [{ code: 'zz', label: 'Zed', locale: 'en-GB' }] }));

import { memberLanguageNow, memberLocaleNow } from './member-language-now';
import { MEMBER_LANGUAGE_CACHE_KEY } from './member-languages';

describe('the member language right now (L-D13, L-D7)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    });

    it('is the choice saved on this device, else the browser rule', () => {
        expect(memberLanguageNow()).toBe('en');
        localStorage.setItem(MEMBER_LANGUAGE_CACHE_KEY, 'zz');
        expect(memberLanguageNow()).toBe('zz');
        expect(memberLocaleNow()).toBe('en-GB');
    });

    it('sets Firebase\'s language before the password reset email is sent', () => {
        const source = readFileSync(resolve(__dirname, '../../../shared/services/global-auth.service.ts'), 'utf8');
        const body = source.slice(source.indexOf('async forgotPassword'));
        expect(body.indexOf('this.firebaseAuth.languageCode = language')).toBeGreaterThan(-1);
        expect(body.indexOf('this.firebaseAuth.languageCode = language')).toBeLessThan(body.indexOf('sendPasswordResetEmail('));
    });
});

describe('with no member languages declared', () => {
    it('changes nothing: no language, the browser\'s own locale', async () => {
        vi.resetModules();
        vi.doMock('../../../custom/languages', () => ({ MEMBER_LANGUAGES: [] }));
        const now = await import('./member-language-now');
        expect(now.memberLanguageNow()).toBeNull();
        expect(now.memberLocaleNow()).toBeUndefined();
    });
});
