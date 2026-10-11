import { describe, expect, it } from 'vitest';
import { summaryPlainText } from './summary-text';

describe('summaryPlainText', () => {
    it('leaves file cards out of the summary', () => {
        const html = '<p>Download the details.</p><a class="arc-file" data-arc-file="pdf" href="https://x/a.pdf"><span class="arc-file-title">Brochure</span><span class="arc-file-meta">PDF · 28 KB</span></a><p>See you there.</p>';
        expect(summaryPlainText(html).trim()).toBe('Download the details. See you there.');
    });

    it('keeps a space between blocks, and none inside a word', () => {
        expect(summaryPlainText('<h2>Title</h2><p>One<br>two</p><p>wo<b>rd</b></p>').trim()).toBe('Title One two word');
    });

    it('keeps ordinary links', () => {
        expect(summaryPlainText('<p>Read <a href="https://x">the guide</a>.</p>').trim()).toBe('Read the guide.');
    });
});
