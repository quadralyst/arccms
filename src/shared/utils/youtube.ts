/**
 * YouTube URL handling for the Gallery field.
 *
 * Editors paste whatever the YouTube share button, the address bar or a phone
 * gave them, and every one of those is a different shape. What gets stored is
 * the raw URL; the id, embed and thumbnail are derived at render time, so a
 * fix here repairs existing content instead of needing a migration.
 *
 * Mirrored server-side in functions/src/shared/youtube.ts — a parity spec
 * checks the two agree, so this file is the one to change.
 *
 * Deliberately *not* reused by the rich-text editor's YouTube extension
 * (src/shared/components/tiptap-editor/service/youtube-extension.ts), whose
 * own parser captures everything after the URL — `watch?v=abc&t=30` gives it a
 * video id of `abc&t=30`. Harmless for an iframe src that ignores the extra,
 * wrong for building a thumbnail URL. Switching that code path over is a
 * separate change with its own behaviour to check.
 */

/** Hosts that serve YouTube videos. `www.` is stripped before matching. */
const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtube-nocookie.com',
    'youtu.be',
]);

/** Path prefixes that carry the id as the next segment. */
const ID_PATH_SEGMENTS = new Set(['embed', 'shorts', 'live', 'v']);

/** A YouTube id is exactly 11 characters of URL-safe base64. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in `input`, or null when it is not a YouTube link.
 *
 * Returning null rather than guessing is what lets the editor reject a bad
 * paste at entry instead of storing something that renders as a blank frame.
 */
export function parseYouTubeId(input: string | null | undefined): string | null {
    if (!input || typeof input !== 'string') return null;

    const trimmed = input.trim();
    if (!trimmed) return null;

    // Someone pasting just the id is unambiguous and worth accepting.
    if (VIDEO_ID.test(trimmed)) return trimmed;

    let url: URL;
    try {
        // A bare `youtu.be/xyz` has no scheme; without one it parses as a
        // relative path and the hostname check below would never match.
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!YOUTUBE_HOSTS.has(host)) return null;

    // youtu.be/<id> — the id is the whole path.
    if (host === 'youtu.be') {
        return validId(url.pathname.split('/')[1]);
    }

    // The canonical watch URL. Checked before the path so a `?v=` on an
    // otherwise odd path still wins.
    const queryId = url.searchParams.get('v');
    if (queryId) return validId(queryId);

    const [, first, second] = url.pathname.split('/');
    if (first && ID_PATH_SEGMENTS.has(first.toLowerCase())) {
        return validId(second);
    }

    return null;
}

function validId(candidate: string | undefined): string | null {
    if (!candidate) return null;
    // Trailing junk is common — `youtu.be/<id>/` or a stray segment.
    const cleaned = candidate.trim();
    return VIDEO_ID.test(cleaned) ? cleaned : null;
}

/** True when `input` is a YouTube link this app can render. */
export function isYouTubeUrl(input: string | null | undefined): boolean {
    return parseYouTubeId(input) !== null;
}

/**
 * The embed URL for a video id.
 *
 * `youtube-nocookie.com` by default, matching what the rich-text editor
 * already does — it stops YouTube setting tracking cookies on visitors who
 * never press play.
 */
export function youTubeEmbedUrl(id: string, options: { nocookie?: boolean } = {}): string {
    const host = options.nocookie === false ? 'www.youtube.com' : 'www.youtube-nocookie.com';
    return `https://${host}/embed/${id}`;
}

/**
 * A poster image for a video id.
 *
 * `hqdefault` rather than `maxresdefault`: every video has one, whereas
 * maxres is missing for older and lower-resolution uploads and would leave a
 * broken image in the gallery.
 */
export function youTubeThumbnailUrl(id: string): string {
    return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

/** Everything a template needs for one video, or null if the URL is not one. */
export interface YouTubeVideo {
    id: string;
    embed: string;
    thumb: string;
}

export function youTubeVideo(input: string | null | undefined): YouTubeVideo | null {
    const id = parseYouTubeId(input);
    if (!id) return null;
    return { id, embed: youTubeEmbedUrl(id), thumb: youTubeThumbnailUrl(id) };
}
