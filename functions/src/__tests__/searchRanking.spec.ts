/**
 * Every row of the behaviour table in docs/search-spec.md Appendix B, run
 * through the real tokenizer and ranker against the fixture entries A, B
 * and C. If a row here changes, the spec's table changes with it.
 */
import { describe, it, expect } from 'vitest';
import { queryTokens, tokenize } from '../search/tokenizer.js';
import { rank, highlightRanges, scoreEntry, type Rankable } from '../search/ranking.js';
import { fallbackTokenSets } from '../search/fallback.js';

interface Fixture extends Rankable {
    id: string;
    title: string;
    snippet: string;
    tokens: string[];
}

function entry(id: string, title: string, summary = '', sortAt = 0): Fixture {
    const fields: Record<string, string> = { title };
    const weights: Record<string, number> = { title: 3 };
    if (summary) {
        fields['summary'] = summary;
        weights['summary'] = 2;
    }
    return {
        id,
        title,
        snippet: summary,
        fields,
        weights,
        boost: 1,
        sortAt,
        tokens: [...tokenize(title, { prefix: true }), ...tokenize(summary, { prefix: true })],
    };
}

const A = entry('A', 'Gunjan Karun', '', 3);
const B = entry('B', 'Firebase Hosting Guide', 'Written by Gunjan Karun in 2024', 2);
const C = entry('C', 'Interview: Gunjan on Firebase', '', 1);
const ALL = [A, B, C];

/** Mimics the callable: filter by any shared token, rank, fall back on a typo. */
function search(query: string, candidates = ALL): string[] {
    const { tokens, phrase } = queryTokens(query);
    const attempts = fallbackTokenSets(tokens);
    for (const attempt of attempts) {
        const matching = candidates.filter(c => attempt.tokens.some(t => c.tokens.includes(t)));
        const ranked = rank(matching, attempt.tokens, attempt.fallback ? '' : phrase);
        if (ranked.length) return ranked.map(r => r.entry.id);
    }
    return [];
}

describe('Appendix B', () => {
    it('kar: title prefix hit outranks summary prefix hit', () => {
        expect(search('kar')).toEqual(['A', 'B']);
    });

    it('Karun Gunjan: order-free, both-token matches first', () => {
        expect(search('Karun Gunjan')).toEqual(['A', 'B', 'C']);
    });

    it('gunjan fire: both in the title beats one in each field', () => {
        expect(search('gunjan fire')).toEqual(['C', 'B', 'A']);
    });

    it('GUNJÁN: case and accent folded, title hits above summary hits', () => {
        expect(search('GUNJÁN')).toEqual(['A', 'C', 'B']);
    });

    it("karun's: apostrophe removed, the fallback shortens karuns to karun", () => {
        expect(search("karun's")).toEqual(['A', 'B']);
        const attempts = fallbackTokenSets(queryTokens("karun's").tokens);
        expect(attempts[1]).toEqual({ tokens: ['karun'], fallback: 'karun' });
    });

    it('gunjam: a typo falls back to a shorter prefix', () => {
        expect(search('gunjam')).toEqual(['A', 'C', 'B']);
    });

    it('गुंजन: Devanagari survives tokenizing end to end', () => {
        const hindi = entry('H', 'गुंजन करुण');
        expect(search('गुंजन', [hindi, A])).toEqual(['H']);
    });

    it('arun: infix is not indexed', () => {
        expect(search('arun')).toEqual([]);
    });

    it('the: stop words only, nothing is read', () => {
        // The callable returns before any query when tokens are empty; here
        // the stop word survives as the sole token and matches nothing.
        expect(search('the')).toEqual([]);
    });

    it('2024: numbers are ordinary tokens', () => {
        expect(search('2024')).toEqual(['B']);
    });

    it('firebase hosting guide: all three in the title first', () => {
        expect(search('firebase hosting guide')).toEqual(['B', 'C']);
    });

    it('Gunjan Karun: phrase bonus puts the exact title first', () => {
        expect(search('Gunjan Karun')).toEqual(['A', 'B', 'C']);
    });
});

describe('scoreEntry', () => {
    it('returns null when nothing matches', () => {
        expect(scoreEntry(A, ['zzz'], 'zzz')).toBeNull();
        expect(scoreEntry(A, [], '')).toBeNull();
    });

    it('scores a whole word above a prefix in the same field', () => {
        const whole = scoreEntry(A, ['karun'], 'karun')!;
        const prefix = scoreEntry(A, ['kar'], 'kar')!;
        expect(whole.score).toBeGreaterThan(prefix.score);
    });

    it('applies the source boost', () => {
        const boosted = { ...A, boost: 2 };
        expect(scoreEntry(boosted, ['karun'], 'karun')!.score)
            .toBeCloseTo(scoreEntry(A, ['karun'], 'karun')!.score * 2);
    });

    it('falls back to a weight of 1 for a field with no recorded weight', () => {
        const noWeights = { ...A, weights: {} };
        expect(scoreEntry(noWeights, ['karun'], 'karun')).not.toBeNull();
    });
});

describe('rank tie-breaks', () => {
    it('prefers the more recent entry on an equal score', () => {
        const older = entry('old', 'Same Title', '', 1);
        const newer = entry('new', 'Same Title', '', 2);
        expect(rank([older, newer], ['same'], 'same').map((r: { entry: Fixture }) => r.entry.id)).toEqual(['new', 'old']);
    });
});

describe('highlightRanges', () => {
    it('marks whole-word matches in the original string', () => {
        expect(highlightRanges('Gunjan Karun', ['karun'])).toEqual([[7, 12]]);
    });

    it('marks only the matched prefix', () => {
        expect(highlightRanges('Gunjan Karun', ['kar'])).toEqual([[7, 10]]);
    });

    it('matches through accents and case', () => {
        expect(highlightRanges('Gunján Karun', ['gunjan'])).toEqual([[0, 6]]);
    });

    it('merges overlapping ranges and keeps distinct ones apart', () => {
        expect(highlightRanges('Gunjan Karun', ['gunjan', 'karun'])).toEqual([[0, 6], [7, 12]]);
        expect(highlightRanges('Karun', ['kar', 'karun'])).toEqual([[0, 5]]);
    });

    it('returns nothing for empty input', () => {
        expect(highlightRanges('', ['a'])).toEqual([]);
        expect(highlightRanges('abc', [])).toEqual([]);
    });
});
