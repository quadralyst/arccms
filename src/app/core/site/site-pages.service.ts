/**
 * The published standard pages (About, Contact, the policies at /info), in their
 * arranged order and titled in the page's language (specs/site-sections-spec.md,
 * SS6): for the footer's `data-arc-site-loop="pages"`, the terms notice, the
 * contact form's privacy line and the cookie banner, in the app as publishing
 * does them (functions/src/shared/site-info-source.ts).
 *
 * Published content is public, so anyone can read it. A failed read leaves the
 * list empty: no links, never broken ones.
 */
import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs, limit, query, where } from '@angular/fire/firestore';
import { entryOrderOf, sortForDisplay } from '../utils/display-order';
import type { SitePageLink } from '../../../shared/utils/site-info';

@Injectable({ providedIn: 'root' })
export class SitePagesService {
    private injector = inject(Injector);
    private readonly pagesSignal = signal<SitePageLink[]>([]);
    private loadedFor: string | null = null;
    private loading: Promise<SitePageLink[]> | null = null;

    /** The pages for the language last loaded; empty until then. */
    readonly pages = this.pagesSignal.asReadonly();

    private get firestore(): Firestore {
        return this.injector.get(Firestore);
    }

    private run<T>(fn: () => T): T {
        return runInInjectionContext(this.injector, fn);
    }

    /**
     * Loads the pages for a language ('' for the default), once per language.
     * Without a language (the notice and banner links, which are the same in
     * every language) it reuses whatever is loaded, so it never swaps the
     * footer's titles to another language.
     */
    load(lang?: string): Promise<SitePageLink[]> {
        if (lang === undefined) {
            if (this.loading) return this.loading;
            lang = '';
        }
        if (this.loadedFor === lang && this.loading) return this.loading;
        this.loadedFor = lang;
        this.loading = this.fetch(lang).then((pages) => {
            if (this.loadedFor === lang) this.pagesSignal.set(pages);
            return pages;
        });
        return this.loading;
    }

    private async fetch(lang: string): Promise<SitePageLink[]> {
        try {
            const types = await this.run(() => getDocs(query(
                collection(this.firestore, 'ContentTypes'), where('standard', '==', 'pages'), limit(1))));
            const type = types.docs[0]?.data() as Record<string, unknown> | undefined;
            if (!type?.['slug'] || type['hasPublicUrl'] === false) return [];
            const slug = String(type['slug']);
            const published = await this.run(() => getDocs(collection(this.firestore, `arc_${slug}`)));
            const entries = sortForDisplay(published.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, any>)), entryOrderOf(type));
            return Promise.all(entries.map(async (entry) => {
                let title = String(entry['title'] || '');
                if (lang) {
                    const translation = await this.run(() => getDoc(doc(this.firestore, `arc_${slug}`, entry['id'], 'translations', lang)))
                        .catch(() => null);
                    const translated = translation?.data()?.['title'];
                    if (typeof translated === 'string' && translated.trim()) title = translated;
                }
                return { title, url: `/${slug}/${entry['urlSlug']}` };
            }));
        } catch (error) {
            console.error('Could not read the standard pages:', error);
            return [];
        }
    }
}
