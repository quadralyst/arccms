/**
 * A message on screen that follows the page's language (F52), with languages that load
 * when they are first shown, as they do in the app.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TRANSLOCO_LOADER, TranslocoService, provideTransloco } from '@jsverse/transloco';
import { Subject } from 'rxjs';
import { injectLiveText, type LiveText } from './live-text';

const WORDS: Record<string, Record<string, string>> = {
    en: { left: 'Wrong PIN. {{ n }} left.' },
    de: { left: 'Falsche PIN. Noch {{ n }}.' },
};
let files: Record<string, Subject<Record<string, string>>>;
let transloco: TranslocoService;

function arrive(lang: string): void {
    files[lang].next(WORDS[lang]);
    files[lang].complete();
}

function text(): LiveText {
    return TestBed.runInInjectionContext(() => injectLiveText());
}

beforeEach(() => {
    files = { en: new Subject(), de: new Subject(), fr: new Subject() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            provideTransloco({ config: { availableLangs: ['en', 'de', 'fr'], defaultLang: 'en', failedRetries: 0, missingHandler: { logMissingKey: false } } }),
            { provide: TRANSLOCO_LOADER, useValue: { getTranslation: (lang: string) => files[lang] } },
        ],
    });
    transloco = TestBed.inject(TranslocoService);
});

describe('injectLiveText', () => {
    it('says the message again in the language the page changed to, its values kept', () => {
        const error = text();
        arrive('en');
        error.set(() => transloco.translate('left', { n: 2 }));
        expect(error()).toBe('Wrong PIN. 2 left.');
        transloco.setActiveLang('de');
        arrive('de');
        expect(error()).toBe('Falsche PIN. Noch 2.');
        transloco.setActiveLang('en');
        expect(error()).toBe('Wrong PIN. 2 left.');
    });

    it('keeps what is on screen until the new language\'s file is in, never a key', () => {
        const error = text();
        arrive('en');
        error.set(() => transloco.translate('left', { n: 2 }));
        expect(error()).toBe('Wrong PIN. 2 left.');
        transloco.setActiveLang('de');
        expect(error()).toBe('Wrong PIN. 2 left.');
        arrive('de');
        expect(error()).toBe('Falsche PIN. Noch 2.');
    });

    it('keeps what is on screen when the file cannot be loaded, and still follows the next change', () => {
        const error = text();
        arrive('en');
        error.set(() => transloco.translate('left', { n: 2 }));
        expect(error()).toBe('Wrong PIN. 2 left.');
        transloco.setActiveLang('fr');
        files['fr'].error(new Error('offline'));
        expect(error()).toBe('Wrong PIN. 2 left.');
        transloco.setActiveLang('de');
        arrive('de');
        expect(error()).toBe('Falsche PIN. Noch 2.');
    });

    it('is said again for a language change only, not for a value that changed since', () => {
        const error = text();
        arrive('en');
        const n = signal(2);
        error.set(() => transloco.translate('left', { n: n() }));
        expect(error()).toBe('Wrong PIN. 2 left.');
        n.set(1);
        expect(error()).toBe('Wrong PIN. 2 left.');
    });

    it('shows plain text as it is, and nothing once it is taken off', () => {
        const error = text();
        arrive('en');
        error.set('From the provider.');
        transloco.setActiveLang('de');
        arrive('de');
        expect(error()).toBe('From the provider.');
        error.set('');
        expect(error()).toBe('');
    });

    it('shows the same message in another place with source()', () => {
        const [first, second] = [text(), text()];
        arrive('en');
        first.set(() => transloco.translate('left', { n: 2 }));
        second.set(first.source());
        first.set('');
        transloco.setActiveLang('de');
        arrive('de');
        expect([first(), second()]).toEqual(['', 'Falsche PIN. Noch 2.']);
    });
});

describe('the sign-in screens keep no finished sentence (F52)', () => {
    // A sentence set as text stays in the old language when the page's changes: set how to say it.
    const pages = resolve(__dirname, '../../pages/(auth)');
    it.each([
        resolve(pages, '(signup)/signup.page.ts'),
        resolve(pages, '(profile)/sign-in-methods.component.ts'),
        resolve(pages, '(profile)/profile.page.ts'),
        resolve(__dirname, '../sign-in/fresh-code-dialog.component.ts'),
    ])('%s', (file) => {
        const source = readFileSync(file, 'utf8');
        const kept = source.match(/this\.\w+\.set\((?:[^()]|\([^()]*\))*?(?<!\(\) => )(?:this\.t\(|readSignInError\(\w+\)\.message|(?:failed|e|error)\.message\))/g) ?? [];
        // An upload's own error has no words of the page's: shown as it came.
        expect(kept.filter((line) => !line.includes('err instanceof Error'))).toEqual([]);
    });
});
