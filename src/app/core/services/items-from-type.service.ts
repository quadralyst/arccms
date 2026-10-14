/**
 * Items From Type Service
 *
 * The rows of a detail template's data-arc-items-src loops when the app draws
 * the page (core/utils/items-from-type.ts): the type's published entries in its
 * display order, without the page's own entry, translated into the page's
 * language where a translation exists, as cards (core/utils/content-cards.ts).
 * The same reads and rules as publishing (functions/src/pages/published-entries.ts,
 * readItemsFromType), so the app shows what the published page shows.
 *
 * A type that does not exist, or cannot be read, gives no rows.
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs, limit, orderBy, query, where } from '@angular/fire/firestore';
import { cardData } from '../utils/content-cards';
import { entryOrderOf } from '../utils/display-order';
import { ItemsFromTypeLoop, pickItemsFromType } from '../utils/items-from-type';
import { ContentType, contentTypeName } from '../../pages/admin/contents/content-types/content-types.model';
import { IContentTranslation, mergeTranslation } from '../../pages/admin/contents/draft-content-store/content-translation.model';

/** The page whose template holds the loop. */
export interface ItemsFromTypePage {
    /** The language the page is read in, such as 'en' or 'hi'. */
    lang: string;
    /** '' on the default language, '/{lang}' otherwise. */
    langPrefix: string;
    /** Whether `lang` is not the default, so entries' translations apply. */
    translated: boolean;
    /** The page's own type and entry, which is never shown. */
    type: string;
    id: string;
}

@Injectable({ providedIn: 'root' })
export class ItemsFromTypeService {
    private injector = inject(Injector);

    private get firestore(): Firestore {
        return this.injector.get(Firestore);
    }

    /** The rows of one loop. Never rejects: a failed read gives no rows. */
    async rows(loop: Pick<ItemsFromTypeLoop, 'type' | 'limit'>, page: ItemsFromTypePage): Promise<Record<string, any>[]> {
        try {
            const exclude = loop.type === page.type ? page.id : '';
            const type = await this.readType(loop.type);
            if (!type) return [];
            const entries = await this.readEntries(loop.type, type, loop.limit + (exclude ? 1 : 0));
            const shown = pickItemsFromType(entries, entryOrderOf(type), loop.limit, exclude);
            const typeName = contentTypeName(type, page.lang);
            return await Promise.all(shown.map(async (entry) => {
                const translation = page.translated ? await this.readTranslation(loop.type, entry['id'], page.lang) : null;
                return cardData({ ...mergeTranslation(entry, translation), id: entry['id'] },
                    loop.type, typeName, page.lang, page.langPrefix, type.hasPublicUrl !== false);
            }));
        } catch (error) {
            console.error(`Could not read the entries of '${loop.type}' for a data-arc-items-src loop:`, error);
            return [];
        }
    }

    private async readType(slug: string): Promise<ContentType | null> {
        const snap = await runInInjectionContext(this.injector, () =>
            getDocs(query(collection(this.firestore, 'ContentTypes'), where('slug', '==', slug), limit(1))));
        return snap.empty ? null : ({ ...(snap.docs[0].data() as ContentType), slug });
    }

    /**
     * A type's published entries in its display order, as publishing reads them:
     * newest first is one limited query; a type in its own order is read whole.
     */
    private async readEntries(slug: string, type: ContentType, count: number): Promise<Record<string, any>[]> {
        const published = collection(this.firestore, `arc_${slug}`);
        const manual = entryOrderOf(type) === 'manual';
        const snap = await runInInjectionContext(this.injector, () =>
            getDocs(manual ? published : query(published, orderBy('publishedOn', 'desc'), limit(count))));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    private async readTranslation(slug: string, id: string, lang: string): Promise<IContentTranslation | null> {
        try {
            const snap = await runInInjectionContext(this.injector, () =>
                getDoc(doc(this.firestore, `arc_${slug}`, id, 'translations', lang)));
            return snap.exists() ? { ...(snap.data() as IContentTranslation), lang } : null;
        } catch {
            // The entry shows in the default language.
            return null;
        }
    }
}
