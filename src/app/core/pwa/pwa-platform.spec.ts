import { describe, expect, it } from 'vitest';
import { detectPlatform } from './pwa-platform';

const UA = {
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
    ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
    it('knows Safari on iPhone, the only iPhone browser that can install', () => {
        expect(detectPlatform(UA.iphoneSafari, 5)).toEqual({ platform: 'ios', iosSafari: true });
        expect(detectPlatform(UA.iphoneChrome, 5)).toEqual({ platform: 'ios', iosSafari: false });
    });

    it('counts an iPad in desktop mode as iOS, and a real Mac as a computer', () => {
        expect(detectPlatform(UA.ipadDesktopMode, 5)).toEqual({ platform: 'ios', iosSafari: true });
        expect(detectPlatform(UA.ipadDesktopMode, 0)).toEqual({ platform: 'desktop', iosSafari: false });
        expect(detectPlatform(UA.macChrome, 0).platform).toBe('desktop');
    });

    it('knows Android', () => {
        expect(detectPlatform(UA.android, 5).platform).toBe('android');
    });
});
