/**
 * Public language switcher.
 *
 * Lives in the header partial as `<arc-language-switcher>`. That partial is
 * used two ways, so this element is handled twice:
 *  - in the SPA it is this component;
 *  - in statically published pages the publish pipeline replaces the element
 *    with equivalent markup (`buildLanguageSwitcher` in
 *    functions/src/shared/html-document.ts), because a static partial cannot
 *    know the site's languages.
 *
 * Renders nothing on a single-language site.
 *
 * Spec: docs/multilingual-spec.md — Phase M4.
 */

import { isPlatformBrowser } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    PLATFORM_ID,
    computed,
    inject,
    signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { LocalizationService } from '../../core/services/localization.service';
import { ILanguage } from '../../../shared/models/localization.model';

/** Remembers the visitor's choice for their next visit. */
const LANG_STORAGE_KEY = 'arc-lang';

@Component({
    selector: 'arc-language-switcher',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @if (links().length > 1) {
      <div class="arc-lang-switcher" role="navigation" aria-label="Language">
        @for (link of links(); track link.code) {
          <a [href]="link.url" [attr.hreflang]="link.code" class="arc-lang-link"
             [class.is-current]="link.isCurrent"
             [attr.aria-current]="link.isCurrent ? 'true' : null"
             (click)="remember(link.code)">{{ link.label }}</a>
        }
      </div>
    }
  `,
    styles: [`
    .arc-lang-switcher { display: inline-flex; align-items: center; gap: .25rem; margin-left: 1rem; }
    .arc-lang-link {
        display: inline-block; padding: .15rem .5rem; border-radius: 1rem;
        font-size: .8125rem; line-height: 1.4; text-decoration: none;
        color: #6e6e73; white-space: nowrap;
    }
    .arc-lang-link:hover { background: #f0f0f2; color: #1d1d1f; }
    .arc-lang-link.is-current { background: #e7f3ff; color: #0066cc; font-weight: 600; }
  `],
})
export class LanguageSwitcherComponent {
    private localization = inject(LocalizationService);
    private router = inject(Router);
    private platformId = inject(PLATFORM_ID);

    private currentUrl = signal<string>('');

    constructor() {
        this.localization.load();
        this.currentUrl.set(this.router.url);
        this.router.events
            .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
            .subscribe(event => this.currentUrl.set(event.urlAfterRedirects));
    }

    /**
     * One link per enabled language, pointing at this same page in that
     * language. The default language sits at the root; every other language is
     * served from a `/{code}` prefix.
     */
    links = computed(() => {
        const languages = this.localization.enabledLanguages();
        if (languages.length < 2) return [];

        const defaultLang = this.localization.defaultLanguage();
        const { path, activeLang } = this.splitLanguage(this.currentUrl(), languages, defaultLang);

        return languages.map((language: ILanguage) => ({
            code: language.code,
            label: language.nativeLabel || language.label,
            url: language.code === defaultLang ? path || '/' : `/${language.code}${path}`,
            isCurrent: language.code === activeLang,
        }));
    });

    /** Splits a URL into its language prefix (if any) and the rest. */
    private splitLanguage(
        url: string,
        languages: ILanguage[],
        defaultLang: string,
    ): { path: string; activeLang: string } {
        const clean = (url || '/').split('?')[0].split('#')[0];
        const [, first = '', ...rest] = clean.split('/');

        const prefixed = languages.find(l => l.code === first && l.code !== defaultLang);
        if (prefixed) {
            return { path: rest.length ? `/${rest.join('/')}` : '', activeLang: prefixed.code };
        }
        return { path: clean === '/' ? '' : clean, activeLang: defaultLang };
    }

    remember(code: string): void {
        if (!isPlatformBrowser(this.platformId)) return;
        try {
            localStorage.setItem(LANG_STORAGE_KEY, code);
        } catch {
            // Private browsing or a full quota — the choice simply is not
            // remembered, which must never block the navigation itself.
        }
    }
}

export default LanguageSwitcherComponent;
