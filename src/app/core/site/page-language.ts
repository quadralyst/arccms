/**
 * `<html lang>` and `dir` for a page of the site the app draws (the home page, a content
 * item or list, a static page): the content's language, as on the published page, not
 * the member's or the admin's (RF6 6.6 and 6.8 review).
 *
 * The app's language service (LanguageAreaService) sets both to the language the app
 * shows, on every page and whenever it changes. While a site page holds them, any such
 * write is put straight back, so the two never take turns; when the page goes, they are
 * handed back to the app's language, as that service would set them.
 *
 * arc-site.js and the live parts read `<html lang>` for the forms' language.
 */
import { DOCUMENT, DestroyRef, effect, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { ILanguage } from '../../../shared/models/localization.model';
import { LocalizationService } from '../services/localization.service';
import { languageDir } from '../i18n/member-languages';
import { MEMBER_LANGUAGE_LIST } from '../i18n/member-language.service';

export type TextDirection = 'ltr' | 'rtl';

/** A site language's direction: right to left when the site says so, or when it is a member language declared so. */
export function siteLanguageDir(code: string, enabled: readonly ILanguage[] = []): TextDirection {
    return enabled.find((l) => l.code === code)?.rtl ? 'rtl' : languageDir(code, MEMBER_LANGUAGE_LIST);
}

/** Holds `<html lang>` and `dir` for one page; see the top of this file. */
export class PageLanguageHold {
    private guard: MutationObserver | null = null;
    private held = false;

    constructor(private readonly document: Document, private readonly appLanguage: () => string) {}

    hold(lang: string, dir: TextDirection): void {
        if (!lang) return;
        const root = this.document.documentElement;
        const apply = () => {
            if (root.lang !== lang) root.lang = lang;
            if (root.dir !== dir) root.dir = dir;
        };
        apply();
        this.held = true;
        this.guard?.disconnect();
        if (typeof MutationObserver === 'undefined') return;
        this.guard = new MutationObserver(apply);
        this.guard.observe(root, { attributes: true, attributeFilter: ['lang', 'dir'] });
    }

    release(): void {
        this.guard?.disconnect();
        this.guard = null;
        if (!this.held) return;
        this.held = false;
        const lang = this.appLanguage();
        if (!lang) return;
        const root = this.document.documentElement;
        root.lang = lang;
        root.dir = languageDir(lang, MEMBER_LANGUAGE_LIST);
    }
}

/** A hold for this component, released when it goes. Call in an injection context. */
export function pageLanguageHold(): PageLanguageHold {
    const transloco = inject(TranslocoService, { optional: true });
    const hold = new PageLanguageHold(inject(DOCUMENT), () => transloco?.getActiveLang() ?? '');
    inject(DestroyRef).onDestroy(() => hold.release());
    return hold;
}

/**
 * Keeps `<html lang>` and `dir` on the language `code()` names ('' for none yet), or
 * the site's default language, following the site's language settings as they load.
 * Call in an injection context, once, from a site page component.
 */
export function usePageLanguage(code: () => string): PageLanguageHold {
    const hold = pageLanguageHold();
    const localization = inject(LocalizationService, { optional: true });
    void localization?.load?.().catch(() => undefined);
    effect(() => {
        const lang = code() || localization?.defaultLanguage?.() || '';
        if (lang) hold.hold(lang, siteLanguageDir(lang, localization?.enabledLanguages?.() ?? []));
    });
    return hold;
}
