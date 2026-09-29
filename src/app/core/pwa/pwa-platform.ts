/** Where the site is running, for the install guide and the install counters. */
export type PwaPlatform = 'android' | 'ios' | 'desktop';

export interface PlatformInfo {
    platform: PwaPlatform;
    /** On iPhone and iPad only Safari can install; other browsers there cannot. */
    iosSafari: boolean;
}

/**
 * Reads the platform from the user agent. An iPad in desktop mode reports itself
 * as a Mac, so a "Mac" with a touch screen counts as iOS.
 */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): PlatformInfo {
    const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
    if (ios) {
        // Chrome, Firefox, Edge and the in-app browsers all add their own marker.
        const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(userAgent);
        return { platform: 'ios', iosSafari: !otherBrowser && /Safari/.test(userAgent) };
    }
    return { platform: /Android/.test(userAgent) ? 'android' : 'desktop', iosSafari: false };
}
