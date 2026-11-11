/**
 * Callable: mediaUsage
 *
 * How many content entries use a media library file, so the media manager can
 * warn before it is deleted. The admin can still delete it.
 *
 * Content keeps an image as a plain URL, never as a media id: the cover image,
 * an image or gallery field, and `<img>` or file links inside rich text. The URL
 * is usually one of the image's sizes (S, M, L, XL), each with its own token, so
 * a URL is matched by its Storage path, the `/o/<path>` part, against every
 * file of the media document. Unsplash photos and pasted links are not library
 * files and never match.
 *
 * Checks drafts and published entries of every content type, counting an entry
 * once whichever copy uses the file. Not checked: translations (they nearly
 * always use the same images as the entry), the published history, and fields
 * copied in from another entry by a collection reference (that entry is the one
 * that uses it, and is counted itself).
 *
 * Cost: one content type at a time, each collection in pages of `USAGE_PAGE`
 * entries with only the fields that can hold a file, so memory stays flat
 * however large the site. It stops at `USAGE_CAP` entries: the warning only
 * needs "20 or more", not the exact number.
 *
 * Input:  { mediaId: string } for an image, or { fileId: string } for a document
 * Output: { count, titles, more } (count up to USAGE_CAP; more: true when it
 *         stopped there, so there may be others; titles: the first few)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { getDraftCollectionName, getPublishedCollectionName } from '../draftContent/collectionHelpers.js';

/** How many entry titles the reply names. */
export const USAGE_TITLES = 3;

/** Stop counting here: "used in 20 or more entries" is warning enough. */
export const USAGE_CAP = 20;

/** Entries read per query. Rich text can be large, so pages stay small. */
export const USAGE_PAGE = 100;

/** The content fields that can hold a library file's URL. */
const CONTENT_FIELDS = ['title', 'coverImage', 'content', 'customFields'];

/** Every Storage path of a media document: each image size, an older upload's one file, a document's file. */
export function mediaPaths(data: Record<string, any> | undefined): string[] {
    if (!data) return [];
    const paths = new Set<string>();
    const add = (value: unknown) => {
        if (typeof value === 'string' && value.trim()) paths.add(value.trim());
    };
    if (data['variants'] && typeof data['variants'] === 'object') {
        for (const variant of Object.values(data['variants'] as Record<string, any>)) add(variant?.path);
    }
    add(data['path']);
    const fromUrl = storagePathOf(data['downloadURL']);
    if (fromUrl) add(fromUrl);
    return [...paths];
}

/** The Storage path inside a Firebase download URL, or null. */
export function storagePathOf(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    const match = /\/o\/([^?#"'\s<>]+)/.exec(url);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
}

/**
 * What to look for in stored content: each path as it appears in a download
 * URL (`arccms%2FmediaImages%2Fphoto-m.webp`), lower case, as the comparison is.
 */
export function usageNeedles(paths: string[]): string[] {
    return paths.map((path) => `/o/${encodeURIComponent(path)}`.toLowerCase());
}

/**
 * Whether any text in a stored value holds one of the needles. Objects copied
 * from another entry by a collection reference (they carry `_refCollection`)
 * are skipped: the entry they came from is counted on its own.
 */
export function holdsMedia(value: unknown, needles: string[]): boolean {
    if (typeof value === 'string') {
        const text = value.toLowerCase();
        return needles.some((needle) => text.includes(needle));
    }
    if (Array.isArray(value)) return value.some((item) => holdsMedia(item, needles));
    if (value && typeof value === 'object') {
        if ('_refCollection' in value) return false;
        return Object.values(value as Record<string, unknown>).some((item) => holdsMedia(item, needles));
    }
    return false;
}

export interface MediaUsageResult {
    count: number;
    titles: string[];
    /** True when counting stopped at USAGE_CAP: there may be more. */
    more: boolean;
}

/**
 * Count the entries of the given content types that hold one of the needles,
 * up to `cap`. One type at a time, each collection page by page.
 */
export async function countUsage(slugs: string[], needles: string[], cap = USAGE_CAP, page = USAGE_PAGE): Promise<MediaUsageResult> {
    const used = new Map<string, string>();
    for (const slug of slugs) {
        for (const name of [getDraftCollectionName(slug), getPublishedCollectionName(slug)]) {
            let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
            for (;;) {
                let query = db.collection(name).select(...CONTENT_FIELDS).limit(page);
                if (last) query = query.startAfter(last);
                const result = await query.get();
                for (const entry of result.docs) {
                    const key = `${slug}/${entry.id}`;
                    if (used.has(key)) continue;
                    const { title, ...rest } = entry.data();
                    if (holdsMedia(rest, needles)) used.set(key, typeof title === 'string' ? title : '');
                    if (used.size >= cap) return summarise(used, true);
                }
                if (result.docs.length < page) break;
                last = result.docs[result.docs.length - 1];
            }
        }
    }
    return summarise(used, false);
}

function summarise(used: Map<string, string>, more: boolean): MediaUsageResult {
    return { count: used.size, titles: [...used.values()].filter(Boolean).slice(0, USAGE_TITLES), more };
}

export const mediaUsage = onCall({ memory: '512MiB', timeoutSeconds: 60 }, async (request): Promise<MediaUsageResult> => {
    await requireAdmin(request);
    const mediaId = typeof request.data?.mediaId === 'string' ? request.data.mediaId.trim() : '';
    const fileId = typeof request.data?.fileId === 'string' ? request.data.fileId.trim() : '';
    const id = mediaId || fileId;
    if (!id || id.includes('/')) {
        throw new HttpsError('invalid-argument', 'Which file? The media id is missing.');
    }

    const snap = await db.collection(mediaId ? 'media' : 'mediaFiles').doc(id).get();
    const needles = usageNeedles(mediaPaths(snap.data()));
    if (!snap.exists || needles.length === 0) return { count: 0, titles: [], more: false };

    const types = await db.collection('ContentTypes').get();
    const slugs = [...new Set(types.docs
        .map((doc) => doc.data()?.['slug'])
        .filter((slug): slug is string => typeof slug === 'string' && !!slug && !slug.includes('/')))];

    return countUsage(slugs, needles);
});
