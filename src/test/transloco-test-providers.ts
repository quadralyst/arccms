import { TranslocoTestingModule, TranslocoTestingOptions } from '@jsverse/transloco';
import en from '../assets/i18n/en.json';
import hi from '../assets/i18n/hi.json';
import { DEFAULT_ADMIN_LANGUAGE } from '../app/core/i18n/admin-languages';

/**
 * Transloco for component specs.
 *
 * The real translations are used rather than stubs, so a spec asserting on
 * visible text keeps asserting on the text a person actually sees. Loading is
 * synchronous here — `TranslocoTestingModule` hands over the objects directly
 * instead of going through the app's `import()` loader — so a rendered
 * template has its strings on the first `detectChanges()` with nothing to
 * await.
 *
 * Import it, don't provide it:
 *
 *   imports: [MyComponent, translocoTestingModule()]
 *
 * Pass `lang` to render a spec in another language, e.g. to prove a page has
 * no English left in it:
 *
 *   imports: [MyComponent, translocoTestingModule({ lang: 'hi' })]
 */
export function translocoTestingModule(options: { lang?: string } = {}) {
    const config: TranslocoTestingOptions = {
        langs: { en, hi },
        translocoConfig: {
            availableLangs: ['en', 'hi'],
            defaultLang: options.lang ?? DEFAULT_ADMIN_LANGUAGE,
            fallbackLang: DEFAULT_ADMIN_LANGUAGE,
            missingHandler: { useFallbackTranslation: true, logMissingKey: false },
            reRenderOnLangChange: true,
        },
        // A key a spec's component asks for and no file has is a bug worth
        // seeing, but it must not abort the render.
        preloadLangs: true,
    };
    return TranslocoTestingModule.forRoot(config);
}
