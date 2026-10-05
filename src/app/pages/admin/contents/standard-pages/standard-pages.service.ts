import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from '@angular/fire/firestore';
import { isOn } from '../../../../core/features/features';
import { STANDARD_PAGES_SLUG, standardPages, standardPagesType, type OwnerDetails } from './standard-pages';

export interface StandardPagesResult {
    /** The Pages type was created now. */
    createdType: boolean;
    /** The pages created now, by URL slug. */
    createdPages: string[];
    /**
     * A content type with the slug `info` exists that Arc CMS did not create:
     * nothing was added, so the admin's own type is never mixed with these.
     */
    foreignType: boolean;
}

/**
 * Creates the standard pages (specs/site-sections-spec.md, SS6): the Pages type
 * when it is missing, and each page that is missing, as a draft. Never changes
 * what exists, so it is safe to run again: the setup wizard runs it, and so does
 * Add standard pages on the content types page for an install from before.
 */
@Injectable({ providedIn: 'root' })
export class StandardPagesService {
    private firestore = inject(Firestore);
    private injector = inject(EnvironmentInjector);

    private run<T>(fn: () => T): T {
        return runInInjectionContext(this.injector, fn);
    }

    async ensure(): Promise<StandardPagesResult> {
        const types = collection(this.firestore, 'ContentTypes');
        const existing = await this.run(() => getDocs(query(types, where('slug', '==', STANDARD_PAGES_SLUG), limit(1))));
        const found = existing.docs[0]?.data() as { standard?: string } | undefined;
        if (found && found.standard !== 'pages') return { createdType: false, createdPages: [], foreignType: true };

        const withContactForm = isOn('contact');
        let createdType = false;
        if (!found) {
            const ref = this.run(() => doc(types, STANDARD_PAGES_SLUG));
            await this.run(() => setDoc(ref, {
                ...standardPagesType(withContactForm),
                id: ref.id,
                createdBy: 'system',
                createdAt: serverTimestamp(),
                modifiedBy: 'system',
                modifiedAt: serverTimestamp(),
            }));
            createdType = true;
        }

        const owner = await this.owner();
        const drafts = collection(this.firestore, `arc_${STANDARD_PAGES_SLUG}_drafts`);
        const createdPages: string[] = [];
        const pages = standardPages(owner, withContactForm);
        for (const [index, page] of pages.entries()) {
            const has = await this.run(() => getDocs(query(drafts, where('urlSlug', '==', page.urlSlug), limit(1))));
            if (!has.empty) continue;
            const ref = this.run(() => doc(drafts, page.urlSlug));
            await this.run(() => setDoc(ref, {
                id: ref.id,
                title: page.title,
                content: page.content,
                urlSlug: page.urlSlug,
                type: STANDARD_PAGES_SLUG,
                status: 'draft',
                coverImage: null,
                tags: [],
                categoryIdArr: [],
                categoryNameArr: [],
                seoTitle: '',
                metaDescription: '',
                canonicalUrl: '',
                summary: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                customFields: page.customFields,
                // In footer order on a new type; added to an existing one, a page
                // goes after the pages there (core/utils/display-order.ts).
                ...(createdType ? { sortOrder: index + 1 } : {}),
                createdBy: 'system',
                createdAt: serverTimestamp(),
                modifiedBy: 'system',
                modifiedAt: serverTimestamp(),
            }));
            createdPages.push(page.urlSlug);
        }
        return { createdType, createdPages, foreignType: false };
    }

    /** Name, email and address from Settings, About, for the outlines; empty when unreadable. */
    private async owner(): Promise<OwnerDetails> {
        try {
            const snap = await this.run(() => getDoc(doc(this.firestore, 'Settings', 'about')));
            const data = (snap.data() ?? {}) as OwnerDetails;
            return { name: data.name, contactEmail: data.contactEmail, address: data.address };
        } catch {
            return {};
        }
    }
}
