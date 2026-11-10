import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { requireAdmin } from '../search/auth.js';

/** The highest results page a search may ask for. */
export const MAX_UNSPLASH_PAGE = 100;

/**
 * Callable Cloud Function: searchUnsplash
 *
 * Proxies Unsplash image search server-side so the API key never reaches the client.
 * Keys are stored in Firestore at Settings/integrations.unsplash.
 *
 * Usage:
 *   - Warmup ping:  { warmup: true }
 *   - Search:       { query: string, page: number }
 *
 * Requires: an admin (the media library is an admin page).
 */
export const searchUnsplash = onCall(async (request) => {
    await requireAdmin(request);

    // Warmup ping — return immediately to pre-warm the cold start
    if (request.data?.warmup === true) {
        return { ok: true };
    }

    const { query, page = 1 } = request.data || {};

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        throw new HttpsError('invalid-argument', 'A non-empty query string is required.');
    }
    if (!Number.isInteger(page) || page < 1 || page > MAX_UNSPLASH_PAGE) {
        throw new HttpsError('invalid-argument', `page must be a whole number from 1 to ${MAX_UNSPLASH_PAGE}.`);
    }

    // Read Unsplash credentials from Firestore Settings/integrations
    const settingsDoc = await db.collection('Settings').doc('integrations').get();

    if (!settingsDoc.exists) {
        throw new HttpsError('not-found', 'Integrations settings not found. Please configure Unsplash keys in Settings.');
    }

    const unsplash = settingsDoc.data()?.unsplash;

    if (!unsplash?.accessKey) {
        throw new HttpsError('not-found', 'Unsplash access key not configured. Please add it in Settings > Integrations.');
    }

    const url = `https://api.unsplash.com/search/photos?page=${page}&query=${encodeURIComponent(query.trim())}&per_page=20`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            Authorization: `Client-ID ${unsplash.accessKey}`,
        },
        signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
        console.error(`Unsplash API error: ${response.status} ${response.statusText}`);
        throw new HttpsError('internal', `Unsplash API returned an error: ${response.status}`);
    }

    const result = await response.json() as any;

    return {
        items: result.results,
        pagination: {
            pageIndex: page,
            pageSize: 20,
            // Never more pages than a search may ask for: the page's pager counts from these.
            totalItems: Math.min(result.total, MAX_UNSPLASH_PAGE * 20),
            totalPages: Math.min(MAX_UNSPLASH_PAGE, Math.ceil(result.total / 20)),
        },
        status: 200,
    };
});
