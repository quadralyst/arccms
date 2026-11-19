import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { siteManifest, sitePageUrl, layoutLabel } from '../../../core/site/site';
import { PageTextService, hasUnpublishedChanges, type PageTextDraft, type PublishedPageText } from '../../../core/site/page-text.service';
import { hasPageTextMarks, pageTextId } from '../../../core/utils/page-text-model';
import { readPageFile } from '../../../core/utils/page-text-areas';

/**
 * Content, More Pages (specs/visual-editing-spec.md, VE-D48): the home page and
 * the static pages editors can change.
 */

/** Where a page stands: nothing changed from its file, published, or with changes not published. */
export type MorePageStatus = 'file' | 'published' | 'changes';

export interface MorePageRow {
    pageId: string;
    kind: 'home' | 'static';
    /** The static page's name (`/p/{name}`), '' for the home page. */
    name: string;
    /** The page's title from its file, else a name made from its file name; '' for the home page. */
    title: string;
    /** Its address on the site. */
    address: string;
    status: MorePageStatus;
    /** When it was last published, in ms, or null. */
    lastPublished: number | null;
}

/** Where a page stands, from its draft and its published copy. */
export function morePageStatus(draft: PageTextDraft | null, published: PublishedPageText | null): MorePageStatus {
    if (hasUnpublishedChanges(draft, published)) return 'changes';
    return published ? 'published' : 'file';
}

/** What a card block's box says about its content type (VE-D50). */
export interface CardTypeInfo {
    name: string;
    /** Shown in the type's own order, else newest first. */
    ownOrder: boolean;
}

@Injectable({ providedIn: 'root' })
export class MorePagesService {
    private http = inject(HttpClient);
    private pageText = inject(PageTextService);
    private injector = inject(Injector);

    /** The content types by slug, for the card block boxes; empty when they cannot be read. */
    async cardTypes(): Promise<Map<string, CardTypeInfo>> {
        try {
            const firestore = this.injector.get(Firestore);
            const snap = await runInInjectionContext(this.injector, () => getDocs(collection(firestore, 'ContentTypes')));
            return new Map(snap.docs.map((doc) => {
                const data = doc.data() as { slug?: string; name?: string; entryOrder?: string };
                return [data.slug || '', { name: data.name || data.slug || '', ownOrder: data.entryOrder === 'manual' }];
            }));
        } catch (error) {
            console.error('[MorePages] Could not read the content types:', error);
            return new Map();
        }
    }

    /** A page's file as the live site serves it, or '' when it cannot be read. */
    async file(path: string): Promise<string> {
        try {
            return await firstValueFrom(this.http.get(path, { responseType: 'text' }));
        } catch {
            return '';
        }
    }

    /**
     * The home page first (its SEO and card blocks are worth editing before anything
     * is marked), then every static page with at least one marked area, so an editor
     * never opens a page with nothing to change.
     */
    async list(): Promise<MorePageRow[]> {
        const names = Object.keys(siteManifest().pages).sort();
        const files = await Promise.all(names.map(async (name) => ({ name, html: await this.file(sitePageUrl(name)) })));
        const pages: Omit<MorePageRow, 'status' | 'lastPublished'>[] = [
            { pageId: pageTextId.home(), kind: 'home', name: '', title: '', address: '/' },
            ...files
                .filter((file) => hasPageTextMarks(file.html) && readPageFile(file.html).areas.length > 0)
                .map((file) => ({
                    pageId: pageTextId.staticPage(file.name), kind: 'static' as const, name: file.name,
                    title: readPageFile(file.html).title || layoutLabel(file.name), address: `/p/${file.name}`,
                })),
        ];
        return Promise.all(pages.map(async (page) => {
            const [draft, published] = await Promise.all([this.pageText.draft(page.pageId).catch(() => null), this.pageText.published(page.pageId)]);
            return { ...page, status: morePageStatus(draft, published), lastPublished: published?.publishedAt?.toMillis?.() ?? null };
        }));
    }
}
