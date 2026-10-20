import { describe, expect, it } from 'vitest';
import { fileSize, sentSubject } from './email-log.model';

describe('sentSubject (App audience test, 2026-09-29)', () => {
    it('shows what was sent, even a blank subject, never the raw template', () => {
        expect(sentSubject({ subject: '##TITLE##', processedSubject: '' })).toBe('(no subject)');
        expect(sentSubject({ subject: 'Hi ##NAME##', processedSubject: 'Hi Asha' })).toBe('Hi Asha');
    });

    it('falls back to the template subject before the email is sent', () => {
        expect(sentSubject({ subject: 'Hi ##NAME##' })).toBe('Hi ##NAME##');
        expect(sentSubject({ subject: '' })).toBe('(no subject)');
    });
});

describe('fileSize (an email\'s attachments, specs/app-email-spec.md)', () => {
    it('says a size the way people read it', () => {
        expect(fileSize(820)).toBe('820 B');
        expect(fileSize(12_698)).toBe('12.4 KB');
        expect(fileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
});
