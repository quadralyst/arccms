import { describe, it, expect } from 'vitest';
import { highlightSegments } from './search.model';

describe('highlightSegments', () => {
    it('splits text into plain and hit segments', () => {
        expect(highlightSegments('Gunjan Karun', [[7, 12]])).toEqual([
            { text: 'Gunjan ', hit: false },
            { text: 'Karun', hit: true },
        ]);
    });

    it('handles several ranges and a leading hit', () => {
        expect(highlightSegments('Gunjan Karun', [[0, 6], [7, 10]])).toEqual([
            { text: 'Gunjan', hit: true },
            { text: ' ', hit: false },
            { text: 'Kar', hit: true },
            { text: 'un', hit: false },
        ]);
    });

    it('ignores empty, reversed, out-of-range and overlapping ranges', () => {
        expect(highlightSegments('abc', [[2, 2], [3, 1], [10, 12]])).toEqual([{ text: 'abc', hit: false }]);
        expect(highlightSegments('abcdef', [[0, 4], [2, 6]])).toEqual([
            { text: 'abcd', hit: true },
            { text: 'ef', hit: false },
        ]);
        expect(highlightSegments('abc', [[1, 99]])).toEqual([{ text: 'a', hit: false }, { text: 'bc', hit: true }]);
    });

    it('returns the whole text when there is nothing to highlight, and nothing for empty text', () => {
        expect(highlightSegments('abc', undefined)).toEqual([{ text: 'abc', hit: false }]);
        expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', hit: false }]);
        expect(highlightSegments('', [[0, 1]])).toEqual([]);
    });
});
