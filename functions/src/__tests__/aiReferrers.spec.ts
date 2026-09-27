import { describe, it, expect } from 'vitest';
import { aiReferrerLabel, bucketAiReferrers } from '../shared/ai-referrers.js';

describe('AI referrers (D-D14)', () => {
    it('labels assistant sources and ignores the rest', () => {
        expect(aiReferrerLabel('chatgpt.com')).toBe('ChatGPT');
        expect(aiReferrerLabel('www.perplexity.ai')).toBe('Perplexity');
        expect(aiReferrerLabel('copilot.microsoft.com')).toBe('Copilot');
        expect(aiReferrerLabel('google')).toBeNull();
        expect(aiReferrerLabel('(direct)')).toBeNull();
        expect(aiReferrerLabel('')).toBeNull();
    });

    it('buckets and sums per assistant, sorted, with percentages of the top row', () => {
        const items = bucketAiReferrers([
            { name: 'google', value: 500 },
            { name: 'chatgpt.com', value: 30 },
            { name: 'chat.openai.com', value: 10 },
            { name: 'perplexity.ai', value: 20 },
            { name: 'claude.ai', value: 0 },
        ]);
        expect(items).toEqual([
            { name: 'ChatGPT', value: 40, percentage: 100 },
            { name: 'Perplexity', value: 20, percentage: 50 },
            { name: 'Claude', value: 0, percentage: 0 },
        ]);
        expect(bucketAiReferrers([])).toEqual([]);
    });
});
