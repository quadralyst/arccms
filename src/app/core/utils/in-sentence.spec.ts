import { describe, expect, it } from 'vitest';
import { inSentence } from './in-sentence';

describe('inSentence', () => {
    it('writes a sentence-case label as words inside a sentence', () => {
        expect(inSentence('Cover image')).toBe('cover image');
        expect(inSentence('Seats')).toBe('seats');
        expect(inSentence('Office in London')).toBe('office in London');
    });

    it('keeps a title-case label as written, so a name is never written small', () => {
        expect(inSentence('London Office')).toBe('London Office');
        expect(inSentence('Download Label')).toBe('Download Label');
        expect(inSentence('Download URL')).toBe('Download URL');
    });

    it('leaves acronyms, names with inner capitals and other scripts alone', () => {
        expect(inSentence('FAQ')).toBe('FAQ');
        expect(inSentence('URL slug')).toBe('URL slug');
        expect(inSentence('YouTube')).toBe('YouTube');
        expect(inSentence('टिकट मूल्य')).toBe('टिकट मूल्य');
    });
});
