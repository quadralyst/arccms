import { describe, expect, it } from 'vitest';
import { inSentence } from './in-sentence';

describe('inSentence', () => {
    it('writes a title-case label as words inside a sentence', () => {
        expect(inSentence('Download Label')).toBe('download label');
        expect(inSentence('Feature Badge Caption')).toBe('feature badge caption');
        expect(inSentence('Cover image')).toBe('cover image');
    });

    it('leaves acronyms, names with inner capitals and other scripts alone', () => {
        expect(inSentence('Download URL')).toBe('download URL');
        expect(inSentence('FAQ')).toBe('FAQ');
        expect(inSentence('URL slug')).toBe('URL slug');
        expect(inSentence('YouTube Video')).toBe('YouTube video');
        expect(inSentence('टिकट मूल्य')).toBe('टिकट मूल्य');
    });
});
