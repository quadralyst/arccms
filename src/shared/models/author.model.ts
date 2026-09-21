/**
 * Author Model
 *
 * A person who writes for the site (docs/discoverability-spec.md, D-D5).
 * Stored in the `Authors` collection: public-read (nothing private lives
 * here), admin-write. Not a user, because guest and past authors are not
 * users and user documents carry private fields; not a content type, because
 * the JSON-LD must not depend on a type an admin may rename or delete.
 *
 * Content references an author by `authorId` and denormalises `authorName`
 * for lists and search. Mirrored server-side in functions/src/shared/authors.ts.
 */

import { IBaseModel } from './base-model';

export interface IAuthor extends IBaseModel {
    /** Display name; the only required field. */
    name: string;
    /** URL-safe handle derived from the name; reserved for author pages later. */
    slug: string;
    /** Short biography, plain text. */
    bio: string;
    /** Absolute URL of a photo. */
    photoUrl: string;
    /** e.g. "Founder", "Staff writer". */
    jobTitle: string;
    /** The author's own site or profile page. */
    url: string;
    /** Profile URLs for the same person: LinkedIn, X, GitHub, Mastodon. */
    sameAs: string[];
}

export type IAuthorData = Omit<IAuthor, keyof IBaseModel>;

/** The author fields a content item carries. */
export interface IContentAuthorRef {
    authorId?: string | null;
    authorName?: string;
}

/** The settings document that holds the default author now lives in discoverability.model.ts (D3). */
export { DEFAULT_DISCOVERABILITY_SETTINGS } from './discoverability.model';
export type { IDiscoverabilitySettings } from './discoverability.model';

export const EMPTY_AUTHOR: IAuthorData = {
    name: '',
    slug: '',
    bio: '',
    photoUrl: '',
    jobTitle: '',
    url: '',
    sameAs: [],
};

/** Lower-case, hyphenated, ASCII-only handle. Non-Latin names fall back to ''. */
export function authorSlug(name: string): string {
    return (name || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Trims every field, drops non-URL sameAs entries, derives the slug. */
export function normalizeAuthor(input: Partial<IAuthorData>): IAuthorData {
    const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const name = clean(input.name);
    return {
        name,
        slug: clean(input.slug) || authorSlug(name),
        bio: clean(input.bio),
        photoUrl: clean(input.photoUrl),
        jobTitle: clean(input.jobTitle),
        url: clean(input.url),
        sameAs: (input.sameAs || []).map(clean).filter(u => /^https?:\/\//i.test(u)),
    };
}

/** Case- and whitespace-insensitive name match, for bulk import lookups. */
export function authorNameKey(name: string): string {
    return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
