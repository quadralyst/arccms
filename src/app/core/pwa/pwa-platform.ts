/** Where the site is running, for the install guide and the install counters. */
export type PwaPlatform = 'android' | 'ios' | 'desktop';

export interface PlatformInfo {
    platform: PwaPlatform;
    /** Safari on iPhone or iPad. */
    iosSafari: boolean;
    /**
     * On iPhone and iPad: this browser adds a page to the home screen from its own
     * Share menu. Safari always has; Chrome, Edge, Firefox and the others since
     * iOS 16.4. An app's built-in web view (Instagram, Facebook, the Google app)
     * cannot. False off iOS.
     */
    iosShare: boolean;
}

/** The iOS version that lets browsers other than Safari add to the home screen. */
const OTHER_BROWSERS_SINCE: [number, number] = [16, 4];

/** Apps that open links in their own web view, which cannot add to the home screen. */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|GSA\/|MicroMessenger|Snapchat|LinkedInApp|Twitter|musical_ly|BytedanceWebview|Pinterest/;

/**
 * Reads the platform from the user agent. An iPad in desktop mode reports itself
 * as a Mac, so a "Mac" with a touch screen counts as iOS.
 */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): PlatformInfo {
    const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
    if (!ios) return { platform: /Android/.test(userAgent) ? 'android' : 'desktop', iosSafari: false, iosShare: false };

    // A web view in another app: an in-app marker, or no Safari token at all.
    if (IN_APP.test(userAgent) || !/Safari\//.test(userAgent)) return { platform: 'ios', iosSafari: false, iosShare: false };
    // Chrome, Firefox, Edge and Opera each add their own marker.
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(userAgent);
    if (!otherBrowser) return { platform: 'ios', iosSafari: true, iosShare: true };
    return { platform: 'ios', iosSafari: false, iosShare: atLeast(iosVersion(userAgent), OTHER_BROWSERS_SINCE) };
}

/** "CPU iPhone OS 17_5" is 17.5; null when the agent does not say (an iPad in desktop mode). */
function iosVersion(userAgent: string): [number, number] | null {
    const match = userAgent.match(/OS (\d+)_(\d+)/);
    return match ? [Number(match[1]), Number(match[2])] : null;
}

/** An unknown version counts as recent: such a device asks for desktop pages, which only recent iPads do. */
function atLeast(version: [number, number] | null, wanted: [number, number]): boolean {
    if (!version) return true;
    return version[0] > wanted[0] || (version[0] === wanted[0] && version[1] >= wanted[1]);
}
