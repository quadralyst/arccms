import { describe, expect, it } from 'vitest';
import { describeBrowser, ownFeedbackFile, sitePath, toFeedbackItem } from './feedback-admin.service';

describe('describeBrowser', () => {
    it('names the browser and the system', () => {
        expect(describeBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36')).toBe('Chrome on Android');
        expect(describeBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
        expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0')).toBe('Edge on Windows');
        expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('Firefox on macOS');
    });

    it('shows the raw description when it knows neither', () => {
        expect(describeBrowser('SomeBot/1.0')).toBe('SomeBot/1.0');
    });
});

describe('ownFeedbackFile (review F)', () => {
    const item = { id: 'AbCdEfGhIjKlMnOpQrSt', userDocId: 'rec1' };

    it('keeps the item\'s own screenshot and voice note, with or without an upload folder', () => {
        expect(ownFeedbackFile(item, 'screenshotPath', 'users/rec1/feedback/AbCdEfGhIjKlMnOpQrSt/screenshot.jpg', ''))
            .toBe('users/rec1/feedback/AbCdEfGhIjKlMnOpQrSt/screenshot.jpg');
        expect(ownFeedbackFile(item, 'voicePath', 'arccms/users/rec1/feedback/AbCdEfGhIjKlMnOpQrSt/voice.webm', 'arccms/'))
            .toBe('arccms/users/rec1/feedback/AbCdEfGhIjKlMnOpQrSt/voice.webm');
    });

    it('drops a path naming any other file, so the admin never opens or deletes it', () => {
        expect(ownFeedbackFile(item, 'screenshotPath', 'arccms/mediaImages/logo.png', 'arccms/')).toBeUndefined();
        expect(ownFeedbackFile(item, 'screenshotPath', 'arccms/users/other/recordings/a.webm', 'arccms/')).toBeUndefined();
        expect(ownFeedbackFile(item, 'screenshotPath', 'arccms/users/rec1/feedback/OtherItem/screenshot.jpg', 'arccms/')).toBeUndefined();
        expect(ownFeedbackFile(item, 'voicePath', 'arccms/users/rec1/feedback/AbCdEfGhIjKlMnOpQrSt/screenshot.jpg', 'arccms/')).toBeUndefined();
        expect(ownFeedbackFile(item, 'voicePath', 42, 'arccms/')).toBeUndefined();
        expect(ownFeedbackFile({ id: 'x' }, 'voicePath', 'users/undefined/feedback/x/voice.webm', '')).toBeUndefined();
    });
});

describe('reading an item the browser wrote (review F)', () => {
    it('survives a malformed item: wrong types become blanks, never a crash', () => {
        const item = toFeedbackItem('f1', {
            userDocId: 'rec1', message: 42, page: 'x', device: { userAgent: 1, viewport: { w: 1 }, installed: 'yes' },
            sender: ['x'], status: 'odd', voiceSeconds: '12',
        });
        expect(item).toMatchObject({ id: 'f1', userDocId: 'rec1', message: '', status: 'new', page: undefined, sender: undefined, voiceSeconds: undefined });
        expect(item.device).toMatchObject({ userAgent: undefined, viewport: undefined, installed: false });
        expect(() => describeBrowser(item.device?.userAgent)).not.toThrow();
        expect(describeBrowser(1 as never)).toBe('');
    });

    it('links only to a page on this site', () => {
        expect(sitePath('/learn/1')).toBe('/learn/1');
        expect(sitePath('https://evil.example')).toBeUndefined();
        expect(sitePath('//evil.example')).toBeUndefined();
        expect(sitePath('/\\evil.example')).toBeUndefined();
        expect(sitePath('javascript:alert(1)')).toBeUndefined();
    });
});
