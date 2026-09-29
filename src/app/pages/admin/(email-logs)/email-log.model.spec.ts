import { describe, expect, it } from 'vitest';
import { sentSubject } from './email-log.model';

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
