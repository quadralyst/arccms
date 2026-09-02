import {
    isYouTubeUrl,
    parseYouTubeId,
    youTubeEmbedUrl,
    youTubeThumbnailUrl,
    youTubeVideo,
} from './youtube';
import {
    parseYouTubeId as parseServerSide,
    youTubeVideo as youTubeVideoServerSide,
} from '../../../functions/src/shared/youtube';

const ID = 'dQw4w9WgXcQ';

/**
 * Shared with the parity check below, so every URL shape is exercised against
 * both the browser copy and the Cloud Functions mirror.
 */
export const URL_CASES: [label: string, url: string, expected: string | null][] = [
    ['canonical watch URL', `https://www.youtube.com/watch?v=${ID}`, ID],
    ['watch URL without www', `https://youtube.com/watch?v=${ID}`, ID],
    ['watch URL without scheme', `youtube.com/watch?v=${ID}`, ID],
    ['watch URL with a timestamp', `https://www.youtube.com/watch?v=${ID}&t=30s`, ID],
    ['watch URL with the timestamp first', `https://www.youtube.com/watch?t=30&v=${ID}`, ID],
    ['watch URL in a playlist', `https://www.youtube.com/watch?v=${ID}&list=PL123&index=2`, ID],
    ['mobile watch URL', `https://m.youtube.com/watch?v=${ID}`, ID],
    ['music watch URL', `https://music.youtube.com/watch?v=${ID}`, ID],
    ['short share link', `https://youtu.be/${ID}`, ID],
    ['short share link with a timestamp', `https://youtu.be/${ID}?t=42`, ID],
    ['short share link without scheme', `youtu.be/${ID}`, ID],
    ['short share link with a trailing slash', `https://youtu.be/${ID}/`, ID],
    ['embed URL', `https://www.youtube.com/embed/${ID}`, ID],
    ['nocookie embed URL', `https://www.youtube-nocookie.com/embed/${ID}`, ID],
    ['embed URL with params', `https://www.youtube.com/embed/${ID}?rel=0&start=10`, ID],
    ['shorts URL', `https://www.youtube.com/shorts/${ID}`, ID],
    ['live URL', `https://www.youtube.com/live/${ID}`, ID],
    ['legacy /v/ URL', `https://www.youtube.com/v/${ID}`, ID],
    ['http rather than https', `http://www.youtube.com/watch?v=${ID}`, ID],
    ['surrounding whitespace', `  https://youtu.be/${ID}  `, ID],
    ['a bare video id', ID, ID],

    ['a Vimeo URL', 'https://vimeo.com/123456789', null],
    ['a lookalike host', `https://notyoutube.com/watch?v=${ID}`, null],
    ['a host that merely ends in youtube.com', `https://evil-youtube.com/watch?v=${ID}`, null],
    ['a YouTube channel page', 'https://www.youtube.com/@someone', null],
    ['a YouTube search', 'https://www.youtube.com/results?search_query=cats', null],
    ['a watch URL with a truncated id', 'https://www.youtube.com/watch?v=tooshort', null],
    ['a watch URL with an over-long id', `https://www.youtube.com/watch?v=${ID}EXTRA`, null],
    ['plain prose', 'watch this great video', null],
    ['an empty string', '', null],
];

describe('youtube', () => {
    describe('parseYouTubeId', () => {
        it.each(URL_CASES)('handles %s', (_label, url, expected) => {
            expect(parseYouTubeId(url)).toBe(expected);
        });

        it.each([null, undefined, 42, {}])('returns null for %s', (input) => {
            expect(parseYouTubeId(input as any)).toBeNull();
        });

        it('does not mistake a query id on a non-YouTube host', () => {
            // The host check has to come first, or any site with a ?v= param
            // would be treated as a video.
            expect(parseYouTubeId(`https://example.com/watch?v=${ID}`)).toBeNull();
        });
    });

    describe('isYouTubeUrl', () => {
        it('accepts a real link and rejects prose', () => {
            expect(isYouTubeUrl(`https://youtu.be/${ID}`)).toBe(true);
            expect(isYouTubeUrl('https://example.com')).toBe(false);
        });
    });

    describe('youTubeEmbedUrl', () => {
        it('defaults to the no-cookie host', () => {
            // Matches the rich-text editor, and stops YouTube setting tracking
            // cookies on visitors who never press play.
            expect(youTubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}`);
        });

        it('can opt back into the tracking host', () => {
            expect(youTubeEmbedUrl(ID, { nocookie: false })).toBe(`https://www.youtube.com/embed/${ID}`);
        });
    });

    describe('youTubeThumbnailUrl', () => {
        it('uses hqdefault, which every video has', () => {
            // maxresdefault is missing for older uploads and would leave a
            // broken image in the gallery.
            expect(youTubeThumbnailUrl(ID)).toBe(`https://img.youtube.com/vi/${ID}/hqdefault.jpg`);
        });
    });

    describe('youTubeVideo', () => {
        it('returns the id, embed and thumbnail together', () => {
            expect(youTubeVideo(`https://www.youtube.com/watch?v=${ID}&t=10`)).toEqual({
                id: ID,
                embed: `https://www.youtube-nocookie.com/embed/${ID}`,
                thumb: `https://img.youtube.com/vi/${ID}/hqdefault.jpg`,
            });
        });

        it('returns null for anything that is not a video', () => {
            expect(youTubeVideo('https://example.com')).toBeNull();
        });
    });

    /**
     * The Cloud Functions build cannot import from src/, so the parser exists
     * twice. Publishing uses the server copy and the preview uses this one —
     * if they drift, a page renders differently once published, which is the
     * hardest kind of bug to notice.
     */
    describe('parity with the Cloud Functions mirror', () => {
        it.each(URL_CASES)('agrees on %s', (_label, url, expected) => {
            expect(parseServerSide(url)).toBe(expected);
        });

        it('builds the same embed and thumbnail', () => {
            expect(youTubeVideoServerSide(`https://youtu.be/${ID}`))
                .toEqual(youTubeVideo(`https://youtu.be/${ID}`));
        });
    });
});
