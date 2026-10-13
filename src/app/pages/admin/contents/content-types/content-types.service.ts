import { Injectable, runInInjectionContext } from '@angular/core';
import { collection, getCountFromServer, query, where, getDocs, getDocsFromServer, limit } from '@angular/fire/firestore';
import { DbService } from '../../../../../shared/services/db.service';
import { ContentType } from './content-types.model';

@Injectable({
  providedIn: 'root',
})
export class ContentTypesService extends DbService<ContentType> {
  constructor() {
    super('ContentTypes');
  }

  /**
   * Check if a URL slug already exists in the collection
   * @param slug The URL slug to check
   * @returns Promise with exists flag and the slug
   */
  async checkExistingSlugUrl(
    slug: string,
  ): Promise<{ exists: boolean; slug: string }> {
    try {
      const querySnapshot = await runInInjectionContext(this.injector, () => {
        const q = query(this.dbCollection, where('slug', '==', slug), limit(1));
        return getDocs(q);
      });

      return {
        exists: !querySnapshot.empty,
        slug: slug,
      };
    } catch (error) {
      console.error('Error checking slug existence:', error);
      return { exists: false, slug: slug };
    }
  }

  /**
   * Whether a content type other than `exceptId` already uses `slug`, asked of
   * the server at save time. A type's entries live under its slug (`arc_{slug}`),
   * so two types with one slug share their entries, and deleting either used to
   * delete both sets. Unlike `checkExistingSlugUrl`, which only suggests a free
   * slug while typing, this throws when it cannot read: a save must not go
   * ahead on an unanswered check.
   */
  async slugInUse(slug: string, exceptId?: string): Promise<boolean> {
    const snapshot = await runInInjectionContext(this.injector, () =>
      getDocsFromServer(query(this.dbCollection, where('slug', '==', slug))),
    );
    return snapshot.docs.some((d) => d.id !== exceptId);
  }

  /**
   * Whether anything is stored under `slug`: an entry, a draft or a tag. The
   * slug names their collections (`arc_{slug}`, `arc_{slug}_drafts`,
   * `Tags_{slug}`), so renaming a type that has any would leave them behind
   * under the old name, gone from the admin and the site. Asked of the server;
   * throws when it cannot tell, so a rename never goes ahead on a guess.
   */
  async hasStoredItems(slug: string): Promise<boolean> {
    const snapshots = await Promise.all(
      [`arc_${slug}`, `arc_${slug}_drafts`, `Tags_${slug}`].map((name) =>
        runInInjectionContext(this.injector, () => getDocsFromServer(query(collection(this.firestore, name), limit(1)))),
      ),
    );
    return snapshots.some((snap) => !snap.empty);
  }

  /**
   * What deleting a type removes, for its confirmation: the number of entries
   * (every entry has a draft, so the drafts are counted), or `null` when they
   * could not be counted; and whether another type shares the slug, in which
   * case `onContentTypeDeleted` keeps the entries for that type.
   */
  async deleteImpact(type: Pick<ContentType, 'id' | 'slug'>): Promise<{ entries: number | null; shared: boolean }> {
    const [entries, shared] = await Promise.all([
      runInInjectionContext(this.injector, () =>
        getCountFromServer(collection(this.firestore, `arc_${type.slug}_drafts`)),
      ).then((snap) => snap.data().count, () => null),
      this.slugInUse(type.slug, type.id).catch(() => false),
    ]);
    return { entries, shared };
  }
}
