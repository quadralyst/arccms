/**
 * Plain text as safe HTML, for FAQ answers (SS4): this file is the source and
 * functions/src/shared/plain-text.ts its mirror.
 */
import { describe, it, expect } from 'vitest';
import { plainTextHtml } from './plain-text';
import * as published from '../../../functions/src/shared/plain-text';

const CASES: [string, string, string][] = [
    ['one line', 'Yes, we deliver.', '<p>Yes, we deliver.</p>'],
    ['paragraphs and line breaks', 'First line\nsecond line\n\nNew paragraph', '<p>First line<br>second line</p><p>New paragraph</p>'],
    ['Windows line endings', 'a\r\n\r\nb', '<p>a</p><p>b</p>'],
    ['markup, escaped', '<b>bold</b> & "quotes"', '<p>&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;</p>'],
    ['a link, its full stop left outside', 'See https://example.com/terms.', '<p>See <a href="https://example.com/terms">https://example.com/terms</a>.</p>'],
    ['a link in brackets', '(https://example.com/a?b=1&c=2)', '<p>(<a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>)</p>'],
    ['no javascript: links', 'javascript:alert(1)', '<p>javascript:alert(1)</p>'],
    ['nothing', '   ', ''],
];

describe('plainTextHtml', () => {
    it.each(CASES)('%s', (_label, text, html) => {
        expect(plainTextHtml(text)).toBe(html);
        expect(published.plainTextHtml(text)).toBe(html);
    });

    it('gives nothing for a value that is not text', () => {
        expect(plainTextHtml(undefined)).toBe('');
        expect(plainTextHtml(42)).toBe('');
    });
});
