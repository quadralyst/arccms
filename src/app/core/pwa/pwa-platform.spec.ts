import { describe, expect, it } from 'vitest';
import { detectPlatform } from './pwa-platform';

const UA = {
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
    iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
    iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.0.2592.56 Mobile/15E148 Safari/605.1.15',
    ipadChrome: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
    oldIphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/110.0.5481.83 Mobile/15E148 Safari/604.1',
    instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; en_US)',
    facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]',
    googleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/326.0.0 Mobile/15E148 Safari/604.1',
    webView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
    it('knows Safari on iPhone', () => {
        expect(detectPlatform(UA.iphoneSafari, 5)).toEqual({ platform: 'ios', iosSafari: true, iosShare: true });
    });

    it('lets Chrome, Firefox and Edge on iPhone and iPad add to the home screen from their Share menu (iOS 16.4 and later)', () => {
        for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge, UA.ipadChrome]) {
            expect(detectPlatform(ua, 5)).toEqual({ platform: 'ios', iosSafari: false, iosShare: true });
        }
    });

    it('sends to Safari only what truly cannot: an older iOS, and web views inside other apps', () => {
        for (const ua of [UA.oldIphoneChrome, UA.instagram, UA.facebook, UA.googleApp, UA.webView]) {
            expect(detectPlatform(ua, 5)).toEqual({ platform: 'ios', iosSafari: false, iosShare: false });
        }
    });

    it('counts an iPad in desktop mode as iOS, and a real Mac as a computer', () => {
        expect(detectPlatform(UA.ipadDesktopMode, 5)).toEqual({ platform: 'ios', iosSafari: true, iosShare: true });
        expect(detectPlatform(UA.ipadDesktopMode, 0)).toEqual({ platform: 'desktop', iosSafari: false, iosShare: false });
        expect(detectPlatform(UA.macChrome, 0).platform).toBe('desktop');
    });

    it('knows Android', () => {
        expect(detectPlatform(UA.android, 5).platform).toBe('android');
    });
});
