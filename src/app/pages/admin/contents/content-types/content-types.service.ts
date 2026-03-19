import { Injectable } from '@angular/core';
import { query, where, getDocs, limit } from '@angular/fire/firestore';
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
      const q = query(this.dbCollection, where('slug', '==', slug), limit(1));
      const querySnapshot = await getDocs(q);

      return {
        exists: !querySnapshot.empty,
        slug: slug,
      };
    } catch (error) {
      console.error('Error checking slug existence:', error);
      return { exists: false, slug: slug };
    }
  }
}
