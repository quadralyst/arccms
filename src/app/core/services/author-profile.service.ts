/**
 * Author Profile Service
 *
 * Public read of one `Authors/{id}` document for the SPA fallback pages
 * (docs/discoverability-spec.md, D2): the byline, the author box and the
 * Article's `author` Person node. Cached per id; a missing or denied read
 * yields null and the page simply shows no byline.
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { IAuthor, normalizeAuthor } from '../../../shared/models/author.model';

@Injectable({ providedIn: 'root' })
export class AuthorProfileService {
    private injector = inject(Injector);
    private cache = new Map<string, Promise<IAuthor | null>>();

    private get firestore(): Firestore {
        return this.injector.get(Firestore);
    }

    load(authorId: string | null | undefined): Promise<IAuthor | null> {
        const id = (authorId || '').trim();
        if (!id) return Promise.resolve(null);
        let pending = this.cache.get(id);
        if (!pending) {
            pending = this.fetch(id);
            this.cache.set(id, pending);
        }
        return pending;
    }

    private async fetch(id: string): Promise<IAuthor | null> {
        try {
            const snap = await runInInjectionContext(this.injector, () =>
                getDoc(doc(this.firestore, 'Authors', id)),
            );
            if (!snap.exists()) return null;
            const data = normalizeAuthor(snap.data() as Partial<IAuthor>);
            return data.name ? ({ ...data, id } as IAuthor) : null;
        } catch (error) {
            console.error(`Error loading author ${id}:`, error);
            this.cache.delete(id);
            return null;
        }
    }
}
