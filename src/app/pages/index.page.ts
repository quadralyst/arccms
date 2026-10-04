import { RouteMeta } from '@analogjs/router';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
    ApplicationRef, ChangeDetectionStrategy, Component, ComponentRef, ElementRef, EnvironmentInjector, Injector,
    OnDestroy, OnInit, PLATFORM_ID, Type, ViewEncapsulation, createComponent, inject,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, take } from 'rxjs';
import { HeaderComponent } from './page.parts/header.component';
import { FooterComponent } from './page.parts/footer.component';
import { ContentPartialsComponent } from './page.parts/content-partials.component';
import { PublicSearchComponent } from './page.parts/public-search.component';
import { LanguageSwitcherComponent } from './page.parts/language-switcher.component';
import { OnboardingSetupService } from './(onboarding)/onboarding-setup.service';
import { LocalizationService } from '../core/services/localization.service';
import { UiStringsService } from '../core/services/ui-strings.service';
import { applyStringsToElement } from '../core/i18n/apply-strings-dom';
import { withLangPrefix } from '../core/utils/language-links';
import { PublicContentTypesService } from '../core/site/public-content-types';
import { siteManifest } from '../core/site/site';
import { useSiteStyles } from '../core/site/site-styles';
import { arcConfig } from '../core/config/arc-config';
import { ARC_FUNCTION_GROUP } from '../core/config/arc-functions';
import { buildLegalNoticeElement, legalNoticeLang } from '../../shared/constants/legal-notice';
import { environment } from '../../environments/environment';

export const routeMeta: RouteMeta = {
    title: 'Home',
};

/** Arc CMS elements a home page may hold, and the component each becomes. */
const ELEMENTS: Record<string, Type<unknown>> = {
    'arc-header': HeaderComponent,
    'arc-footer': FooterComponent,
    'arc-content-partials': ContentPartialsComponent,
    'arc-search': PublicSearchComponent,
    'arc-language-switcher': LanguageSwitcherComponent,
};

/** `<arc-content-partials>` attributes and the component inputs they set. */
const PARTIALS_INPUTS: Record<string, string> = {
    'content-type': 'contentType',
    count: 'count',
    'section-title': 'sectionTitle',
    'template-folder': 'templateFolder',
};

/**
 * The home page, / and /{lang} (specs/own-website-spec.md, W4).
 *
 * The site's home page is a whole HTML document, src/custom/site/home.html (or
 * Arc CMS's placeholder), served at /_site/home.html. Publishing turns it into the
 * static /index.html and /{lang}/index.html, which Hosting serves first; this
 * page shows the same document in the app: with `npm run dev`, as the preview,
 * and on the live site until the pages are published. It does what publishing
 * does, in the browser: the page's words in its language, its own stylesheets and
 * scripts, the Arc CMS elements as components, the terms notice on signup forms,
 * and arc-site.js, the same script that runs the live parts of the published page.
 */
@Component({
    selector: 'arc-home',
    standalone: true,
    template: '',
    // The page's HTML is placed by code, so its styles cannot be scoped to it.
    encapsulation: ViewEncapsulation.None,
    host: { ngSkipHydration: 'true' },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class HomeComponent implements OnInit, OnDestroy {
    private host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    private document = inject(DOCUMENT);
    private platformId = inject(PLATFORM_ID);
    private http = inject(HttpClient);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private title = inject(Title);
    private meta = inject(Meta);
    private appRef = inject(ApplicationRef);
    private environmentInjector = inject(EnvironmentInjector);
    private elementInjector = inject(Injector);
    private localization = inject(LocalizationService);
    private uiStrings = inject(UiStringsService);
    private onboarding = inject(OnboardingSetupService);
    private contentTypes = inject(PublicContentTypesService);

    /** Nodes this page added to <head> and <body>, removed when it goes. */
    private added: Element[] = [];
    private mounted: ComponentRef<unknown>[] = [];
    private shellLang: string | null = null;

    constructor() {
        // Arc CMS's site stylesheets, as on the published page (before the page's own).
        useSiteStyles(['main', 'site']);
    }

    ngOnInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        const lang = this.route.snapshot.paramMap.get('lang') || '';

        // First run, or a setup started and never finished: the wizard first.
        if (!new URLSearchParams(window.location.search).has('debug')) {
            this.onboarding.shouldShowOnboarding().pipe(take(1)).subscribe((show) => {
                if (show) this.router.navigate(['/onboarding']);
            });
        }
        this.load(lang).catch((error) => console.error('[HomeComponent] Could not show the home page:', error));
    }

    private async load(lang: string): Promise<void> {
        const [settings, strings, types] = await Promise.all([
            this.localization.load(), this.uiStrings.use(lang), lang ? this.contentTypes.load() : Promise.resolve(new Set<string>()),
        ]);
        // The home page exists in every enabled language (home.{lang}.html, or
        // home.html translated), so the switcher offers them all.
        this.localization.languageVariants.set(settings.enabledLanguages.map((l) => l.code));

        const ownFile = !!lang && !!siteManifest().home[lang];
        const html = await firstValueFrom(this.http.get(ownFile ? `/_site/home.${lang}.html` : '/_site/home.html', { responseType: 'text' }));
        this.render(new DOMParser().parseFromString(html, 'text/html'), lang, ownFile ? {} : strings, types);
    }

    private render(page: Document, lang: string, strings: Record<string, string>, types: ReadonlySet<string>): void {
        applyStringsToElement(page.documentElement, strings);

        // Head: title, description, language, the page's own stylesheets.
        if (page.title.trim()) this.title.setTitle(page.title.trim());
        const description = page.querySelector('meta[name="description"]')?.getAttribute('content');
        if (description) this.meta.updateTag({ name: 'description', content: description });
        if (lang) {
            this.shellLang = this.document.documentElement.lang;
            this.document.documentElement.lang = lang;
        }
        for (const node of Array.from(page.head.querySelectorAll('link[rel="stylesheet"], style'))) {
            this.add(this.document.head, this.document.importNode(node, true) as Element);
        }

        // Body: the HTML, links in this language, the Arc CMS elements, the forms.
        const scripts = Array.from(page.querySelectorAll('script'));
        scripts.forEach((script) => script.remove());
        this.host.innerHTML = page.body.innerHTML;
        if (lang) {
            this.host.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', withLangPrefix(a.getAttribute('href') || '', `/${lang}`, types)));
        }
        this.mountElements();
        this.addLegalNotices();

        // The page's scripts, in order, as the published page runs them.
        for (const old of scripts) {
            const script = this.document.createElement('script');
            for (const attr of Array.from(old.attributes)) script.setAttribute(attr.name, attr.value);
            script.textContent = old.textContent;
            this.add(this.document.body, script);
        }
        // The live parts (forms, counts, install, signed-in hint) by the same script
        // the published page runs, so what you try here is what visitors get.
        this.add(this.document.body, this.arcSiteScript());
    }

    /** The terms notice above each signup form's button, as publishing adds it. */
    private addLegalNotices(): void {
        for (const form of Array.from(this.host.querySelectorAll<HTMLFormElement>('form[data-waitlist-form]'))) {
            if (form.querySelector('[data-legal-notice]')) continue;
            const notice = buildLegalNoticeElement(this.document, legalNoticeLang(this.document.documentElement.lang));
            const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
            if (submit?.parentNode) submit.parentNode.insertBefore(notice, submit);
            else form.appendChild(notice);
        }
    }

    /** arc-site.js with what the published page gives it (arcSiteScript in functions/src/pages/deployHomePage.ts). */
    private arcSiteScript(): HTMLScriptElement {
        const projectId = environment.firebaseConfig?.projectId ?? '';
        const version = siteManifest().files['assets/js/arc-site.js'];
        const script = this.document.createElement('script');
        script.src = `/assets/js/arc-site.js${version ? `?v=${version}` : ''}`;
        script.setAttribute('data-functions', `https://${arcConfig.functionsRegion}-${projectId}.cloudfunctions.net`);
        script.setAttribute('data-group', ARC_FUNCTION_GROUP);
        script.setAttribute('data-project', projectId);
        script.setAttribute('data-database', arcConfig.databaseId);
        return script;
    }

    private mountElements(): void {
        for (const [tag, component] of Object.entries(ELEMENTS)) {
            // Outer elements only: a header's own search box is the header's to mount.
            for (const hostElement of Array.from(this.host.querySelectorAll(tag))) {
                if (hostElement.parentElement?.closest('arc-header, arc-footer')) continue;
                const ref = createComponent(component, {
                    environmentInjector: this.environmentInjector,
                    elementInjector: this.elementInjector,
                    hostElement,
                });
                if (component === ContentPartialsComponent) {
                    for (const [attr, input] of Object.entries(PARTIALS_INPUTS)) {
                        const value = hostElement.getAttribute(attr);
                        if (value !== null) ref.setInput(input, input === 'count' ? Number(value) || 4 : value);
                    }
                }
                this.appRef.attachView(ref.hostView);
                this.mounted.push(ref);
            }
        }
    }

    private add(parent: Element, node: Element): void {
        node.setAttribute('data-arc-home', '');
        parent.appendChild(node);
        this.added.push(node);
    }

    ngOnDestroy(): void {
        for (const ref of this.mounted) {
            this.appRef.detachView(ref.hostView);
            ref.destroy();
        }
        this.added.forEach((node) => node.remove());
        this.localization.languageVariants.set(null);
        if (this.shellLang !== null) this.document.documentElement.lang = this.shellLang;
    }
}
