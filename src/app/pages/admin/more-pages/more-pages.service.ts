import { HoldService } from '../../../core/editing/hold.service';
import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_TEMPLATE_FOLDER, siteManifest, sitePageUrl, siteTemplateUrl, templateFolderFor, layoutLabel } from '../../../core/site/site';
import { PageTextService, hasUnpublishedChanges, pageHeldByOther, type PageTextDraft, type PublishedPageText } from '../../../core/site/page-text.service';
import { hasPageTextMarks, pageTextId } from '../../../core/utils/page-text-model';
import { readPageFile } from '../../../core/utils/page-text-areas';
import { isTemplateFragment } from '../../../../shared/utils/template-fragment';
import type { ContentType } from '../contents/content-types/content-types.model';
import type { PageRef } from './page-ref';

/**
 * Content, More Pages (specs/visual-editing-spec.md, VE-D48, VE-D65): the home page,
 * the list pages and the static pages editors can change.
 */

/** Where a page stands: nothing changed from its file, published, or with changes not published. */
export type MorePageStatus = 'file' | 'published' | 'changes';

export interface MorePageRow extends PageRef {
    pageId: string;
    /** The page's title from its file, else a name made from its file name; a list page's type; '' for the home page. */
    title: string;
    /** Its address on the site. */
    address: string;
    status: MorePageStatus;
    /** When it was last published, in ms, or null. */
    lastPublished: number | null;
    /** The other person who holds its words, or '' (VE-D85). */
    heldBy?: string;
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

    /** Every content type. */
    async contentTypes(): Promise<ContentType[]> {
        const firestore = this.injector.get(Firestore);
        const snap = await runInInjectionContext(this.injector, () => getDocs(collection(firestore, 'ContentTypes')));
        return snap.docs.map((doc) => ({ ...(doc.data() as ContentType), id: doc.id }));
    }

    /**
     * A type's list template as the page is drawn from it: its folder's, else the
     * default's when that is not a template (ContentListComponent); '' when neither is.
     */
    async listTemplate(templateFolder: string | null | undefined): Promise<string> {
        const folder = templateFolderFor(templateFolder);
        const own = await this.file(siteTemplateUrl(folder, 'list'));
        if (isTemplateFragment(own)) return own;
        if (folder === DEFAULT_TEMPLATE_FOLDER) return '';
        const shared = await this.file(siteTemplateUrl(DEFAULT_TEMPLATE_FOLDER, 'list'));
        return isTemplateFragment(shared) ? shared : '';
    }

    /** The content types by slug, for the card block boxes; empty when they cannot be read. */
    async cardTypes(): Promise<Map<string, CardTypeInfo>> {
        try {
            return new Map((await this.contentTypes()).map((type) =>
                [type.slug || '', { name: type.name || type.slug || '', ownOrder: type.entryOrder === 'manual' }]));
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
     * is marked), then the list page of every type with public pages (its title, its
     * summary and its cards can be changed whatever it marks, VE-D65), then every static
     * page with at least one marked area, so an editor never opens a page with nothing
     * to change.
     */
    async list(): Promise<MorePageRow[]> {
        const names = Object.keys(siteManifest().pages).sort();
        const [types, files] = await Promise.all([
            // Without the types, the other pages are still listed.
            this.contentTypes().catch((error): ContentType[] => {
                console.error('[MorePages] Could not read the content types:', error);
                return [];
            }),
            Promise.all(names.map(async (name) => ({ name, html: await this.file(sitePageUrl(name)) }))),
        ]);
        const lists = types.filter((type) => type.slug && type.hasPublicUrl !== false)
            .map((type) => ({
                pageId: pageTextId.listPage(type.slug), kind: 'list' as const, name: type.slug,
                title: type.name || type.slug, address: `/${type.slug}`,
            }))
            .sort((a, b) => a.title.localeCompare(b.title));
        const pages: Omit<MorePageRow, 'status' | 'lastPublished' | 'heldBy'>[] = [
            { pageId: pageTextId.home(), kind: 'home', name: '', title: '', address: '/' },
            ...lists,
            ...files
                .filter((file) => hasPageTextMarks(file.html) && readPageFile(file.html).areas.length > 0)
                .map((file) => ({
                    pageId: pageTextId.staticPage(file.name), kind: 'static' as const, name: file.name,
                    title: readPageFile(file.html).title || layoutLabel(file.name), address: `/p/${file.name}`,
                })),
        ];
        const uid = this.injector.get(HoldService).me()?.uid;
        return Promise.all(pages.map(async (page) => {
            const [draft, published] = await Promise.all([this.pageText.draft(page.pageId).catch(() => null), this.pageText.published(page.pageId)]);
            const hold = pageHeldByOther(draft, published, uid);
            return {
                ...page, status: morePageStatus(draft, published), lastPublished: published?.publishedAt?.toMillis?.() ?? null,
                ...(hold ? { heldBy: hold.name || '?' } : {}),
            };
        }));
    }
}
