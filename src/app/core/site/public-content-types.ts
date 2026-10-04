/**
 * The slugs of the content types with public pages, for the browser app
 * (functions/src/shared/public-content-types.ts is the publish side's).
 *
 * Their list and item pages, the home page and search are the only addresses
 * that exist in every language, so they decide which links a translated page
 * points at its language (isLocalizedPath in core/utils/language-links.ts) and
 * which /{lang}/... addresses are content at all (publicContentTypeGuard).
 */
import { Injectable, inject, signal } from '@angular/core';
import { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class PublicContentTypesService {
    private firestore = inject(Firestore, { optional: true });
    private pending: Promise<ReadonlySet<string>> | null = null;

    /** The slugs once read; empty until then, so nothing is prefixed that may not exist. */
    readonly slugs = signal<ReadonlySet<string>>(new Set());

    /** Reads the list once per page load; an empty set when it cannot be read. */
    load(): Promise<ReadonlySet<string>> {
        this.pending ??= this.read();
        return this.pending;
    }

    private async read(): Promise<ReadonlySet<string>> {
        if (!this.firestore) return this.slugs();
        try {
            const snap = await getDocs(collection(this.firestore, 'ContentTypes'));
            const slugs = new Set(snap.docs
                .map((doc) => doc.data() as { slug?: string; hasPublicUrl?: boolean })
                .filter((type) => type.slug && type.hasPublicUrl !== false)
                .map((type) => type.slug as string));
            this.slugs.set(slugs);
            return slugs;
        } catch {
            this.pending = null;
            return this.slugs();
        }
    }
}

/**
 * Lets /{lang}/{type}[/{slug}] match only a public content type, so /hi/signup
 * is not read as a content type called "signup" (it falls through to
 * languageRedirect). When the list cannot be read, it lets the address through.
 */
export const publicContentTypeGuard: CanMatchFn = async (_route: Route, segments: UrlSegment[]) => {
    const service = inject(PublicContentTypesService);
    const slugs = await service.load();
    if (!slugs.size) return true;
    return slugs.has(segments[1]?.path ?? '');
};
