import { describe, it, expect } from 'vitest';
import { calculateReadingTime } from '../shared/reading-time.js';

describe('calculateReadingTime', () => {
    it('should return 0 for empty string', () => {
        expect(calculateReadingTime('')).toBe(0);
    });

    it('should return 0 for null/undefined input', () => {
        expect(calculateReadingTime(null as any)).toBe(0);
        expect(calculateReadingTime(undefined as any)).toBe(0);
    });

    it('should strip HTML tags before counting words', () => {
        const html = '<p>hello world</p>';
        expect(calculateReadingTime(html)).toBe(1); // 2 words / 200 WPM = 0.01 → ceil = 1
    });

    it('should strip HTML entities', () => {
        // "one &amp; two" = 3 words after stripping entity
        const html = 'one &amp; two';
        expect(calculateReadingTime(html)).toBe(1);
    });

    it('should return 1 minute for 200 words', () => {
        const words = Array(200).fill('word').join(' ');
        expect(calculateReadingTime(words)).toBe(1);
    });

    it('should return 2 minutes for 201 words', () => {
        const words = Array(201).fill('word').join(' ');
        expect(calculateReadingTime(words)).toBe(2);
    });

    it('should return 2 minutes for 400 words', () => {
        const words = Array(400).fill('word').join(' ');
        expect(calculateReadingTime(words)).toBe(2);
    });

    it('should return 0 for content with only HTML tags', () => {
        expect(calculateReadingTime('<div><span></span></div>')).toBe(0);
    });

    it('should round up fractional reading times', () => {
        // 250 words → 250/200 = 1.25 → ceil = 2
        const words = Array(250).fill('word').join(' ');
        expect(calculateReadingTime(words)).toBe(2);
    });

    it('should handle complex HTML with mixed content', () => {
        const html = `
            <div class="content">
                <h1>Title Here</h1>
                <p>This is a <strong>paragraph</strong> with <em>some</em> HTML.</p>
                <ul>
                    <li>Item one</li>
                    <li>Item two</li>
                </ul>
            </div>
        `;
        // Words: Title, Here, This, is, a, paragraph, with, some, HTML., Item, one, Item, two = 13
        const result = calculateReadingTime(html);
        expect(result).toBe(1); // 13/200 = 0.065 → ceil = 1
    });
});
