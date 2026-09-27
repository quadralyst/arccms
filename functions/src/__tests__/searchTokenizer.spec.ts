/**
 * The tokenizer is shared by the indexer and the query side, so these pin
 * both what gets indexed and what a query turns into.
 *
 * Spec: docs/search-spec.md, decisions S-D3 to S-D6 and Appendix B.
 */
import { describe, it, expect } from 'vitest';
import {
    normalize,
    tokenize,
    queryTokens,
    words,
    isStopWord,
    PREFIX_MAX,
    MAX_QUERY_TOKENS,
} from '../search/tokenizer.js';

describe('normalize', () => {
    it('lowercases and folds Latin accents', () => {
        expect(normalize('GUNJÁN Karún')).toBe('gunjan karun');
        expect(normalize('Café Résumé')).toBe('cafe resume');
    });

    it('leaves Devanagari marks untouched (S-D6)', () => {
        expect(normalize('गुंजन करुण')).toBe('गुंजन करुण');
        expect(normalize('हिन्दी')).toBe('हिन्दी');
    });

    it('removes apostrophes rather than splitting on them', () => {
        expect(normalize("karun's")).toBe('karuns');
        expect(normalize('Karun’s')).toBe('karuns');
    });

    it('turns punctuation into spaces and collapses whitespace', () => {
        expect(normalize('Interview: Gunjan, on Firebase!')).toBe('interview gunjan on firebase');
        expect(normalize('  a   b\n\tc ')).toBe('a b c');
    });

    it('strips HTML tags and entities', () => {
        expect(normalize('<p>Hello&nbsp;<b>World</b></p>')).toBe('hello world');
    });

    it('keeps numbers', () => {
        expect(normalize('Written in 2024')).toBe('written in 2024');
    });

    it('returns empty for empty input', () => {
        expect(normalize('')).toBe('');
        expect(normalize('   ')).toBe('');
    });
});

describe('tokenize', () => {
    it('emits whole words without prefixes by default', () => {
        expect(tokenize('Gunjan Karun')).toEqual(['gunjan', 'karun']);
    });

    it('emits prefixes from 2 characters up to length minus one', () => {
        expect(tokenize('Karun', { prefix: true })).toEqual(['karun', 'ka', 'kar', 'karu']);
    });

    it('caps prefixes at PREFIX_MAX characters', () => {
        const tokens = tokenize('internationalization', { prefix: true });
        expect(tokens[0]).toBe('internationalization');
        expect(tokens.at(-1)).toHaveLength(PREFIX_MAX);
        expect(tokens).toHaveLength(1 + (PREFIX_MAX - 2 + 1));
    });

    it('drops stop words and single characters', () => {
        expect(tokenize('The guide to a Firebase site')).toEqual(['guide', 'firebase', 'site']);
        expect(tokenize('a b c gunjan')).toEqual(['gunjan']);
    });

    it('dedupes tokens across words', () => {
        expect(tokenize('Karun Karun Kar', { prefix: true })).toEqual(['karun', 'ka', 'kar', 'karu']);
    });

    it('keeps only the first maxWords words', () => {
        expect(tokenize('one two three four', { maxWords: 2 })).toEqual(['one', 'two']);
    });
});

describe('queryTokens', () => {
    it('drops stop words unless the query is nothing else', () => {
        expect(queryTokens('the guide').tokens).toEqual(['guide']);
        expect(queryTokens('the').tokens).toEqual(['the']);
    });

    it('never emits prefixes', () => {
        expect(queryTokens('kar').tokens).toEqual(['kar']);
    });

    it('is order-free and deduped', () => {
        expect(queryTokens('Karun Gunjan Karun').tokens.sort()).toEqual(['gunjan', 'karun']);
    });

    it('keeps the longest tokens when there are too many', () => {
        const query = Array.from({ length: 15 }, (_, i) => 'w'.repeat(i + 2)).join(' ');
        const { tokens } = queryTokens(query);
        expect(tokens).toHaveLength(MAX_QUERY_TOKENS);
        expect(tokens[0]).toBe('w'.repeat(16));
    });

    it('produces the phrase for the title bonus', () => {
        expect(queryTokens('Gunjan Karun').phrase).toBe('gunjan karun');
    });

    it('is empty for an empty or single-character query', () => {
        expect(queryTokens('').tokens).toEqual([]);
        expect(queryTokens('k').tokens).toEqual([]);
    });
});

describe('words and isStopWord', () => {
    it('splits normalized words', () => {
        expect(words("Karun's guide")).toEqual(['karuns', 'guide']);
    });

    it('knows the English stop list only', () => {
        expect(isStopWord('the')).toBe(true);
        expect(isStopWord('का')).toBe(false);
    });
});
