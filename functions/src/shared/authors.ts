/**
 * Authors for the publish pipeline (docs/discoverability-spec.md, D2).
 *
 * Reads `Authors/{id}` once per deploy and shapes it for two consumers: the
 * template data (`author.*` bindings, `authorName`) and the Article's
 * `author` Person node. Mirrors src/shared/models/author.model.ts.
 */
import { db } from '../init.js';
import type { PersonInput } from './structured-data.js';

export interface AuthorProfile {
    id: string;
    name: string;
    slug: string;
    bio: string;
    photoUrl: string;
    jobTitle: string;
    url: string;
    sameAs: string[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: AuthorProfile | null; timestamp: number }>();

/** Shapes a raw document; null when it has no usable name. */
export function toAuthorProfile(id: string, data: Record<string, unknown> | undefined): AuthorProfile | null {
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const name = str(data?.['name']);
    if (!name) return null;
    return {
        id,
        name,
        slug: str(data?.['slug']),
        bio: str(data?.['bio']),
        photoUrl: str(data?.['photoUrl']),
        jobTitle: str(data?.['jobTitle']),
        url: str(data?.['url']),
        sameAs: Array.isArray(data?.['sameAs'])
            ? (data!['sameAs'] as unknown[]).map(str).filter(u => /^https?:\/\//i.test(u))
            : [],
    };
}

/**
 * The author a content item points at, or null when it has none, the id is
 * stale, or the read fails. A missing author must never fail a publish; the
 * page simply carries no byline.
 */
export async function getAuthor(authorId: string | null | undefined): Promise<AuthorProfile | null> {
    const id = (authorId || '').trim();
    if (!id) return null;

    const cached = cache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

    try {
        const snap = await db.collection('Authors').doc(id).get();
        const profile = snap.exists ? toAuthorProfile(snap.id, snap.data()) : null;
        cache.set(id, { data: profile, timestamp: Date.now() });
        return profile;
    } catch (error) {
        console.error(`Could not read author ${id}:`, error);
        return null;
    }
}

/** The Person node input for structured data. */
export function authorToPerson(author: AuthorProfile | null): PersonInput | undefined {
    if (!author) return undefined;
    return {
        name: author.name,
        url: author.url || undefined,
        imageUrl: author.photoUrl || undefined,
        description: author.bio || undefined,
        jobTitle: author.jobTitle || undefined,
        sameAs: author.sameAs,
    };
}

/**
 * Template bindings. `author` is an object so templates write
 * `{{ author.name }}` and gate the box on `data-arc-if="author.name"`;
 * `authorName` is the flat form for lists and one-line bylines.
 */
export function authorTemplateData(author: AuthorProfile | null): { author: Record<string, string>; authorName: string } {
    if (!author) return { author: {}, authorName: '' };
    return {
        author: {
            name: author.name,
            bio: author.bio,
            photoUrl: author.photoUrl,
            jobTitle: author.jobTitle,
            url: author.url,
        },
        authorName: author.name,
    };
}

export function clearAuthorCache(): void {
    cache.clear();
}
