/**
 * The automatic summary: this file is the source and
 * functions/src/shared/summary-text.ts its mirror. Every case runs on both.
 */
import { describe, expect, it } from 'vitest';
import * as app from './summary-text';
import * as published from '../../../functions/src/shared/summary-text';

const copies = [['the app', app], ['publishing', published]] as const;

/** A sentence of `words` ordinary words, ending in a full stop. */
const sentence = (words: number, start = 'Garden') => `${start} ${Array.from({ length: words - 1 }, (_, i) => `word${i}`).join(' ')}.`;

describe.each(copies)('summary text, %s copy', (_copy, { SUMMARY_LIMIT, automaticSummaries, bodyExcerpt, clipWords, shortText, summaryPlainText }) => {
    describe('summaryPlainText', () => {
        it('leaves file cards out of the summary', () => {
            const html = '<p>Download the details.</p><a class="arc-file" data-arc-file="pdf" href="https://x/a.pdf"><span class="arc-file-title">Brochure</span><span class="arc-file-meta">PDF · 28 KB</span></a><p>See you there.</p>';
            expect(summaryPlainText(html)).toBe('Download the details. See you there.');
        });

        it('keeps a space between blocks, and none inside a word', () => {
            expect(summaryPlainText('<h2>Title</h2><p>One<br>two</p><p>wo<b>rd</b></p>')).toBe('Title One two word');
        });

        it('keeps ordinary links', () => {
            expect(summaryPlainText('<p>Read <a href="https://x">the guide</a>.</p>')).toBe('Read the guide.');
        });

        it('never glues a heading or a label in a box to the next words', () => {
            // The editor's Key takeaways block (arc-block-extension.ts).
            const takeaways = '<section data-arc-block="takeaways" class="arc-block"><h3>Key takeaways</h3><ul><li><p>A small garden grows best</p></li></ul></section>';
            expect(summaryPlainText(takeaways)).toBe('Key takeaways A small garden grows best');
            // Pasted or imported boxes: any block element, opening or closing.
            expect(summaryPlainText('<aside><strong>Key takeaways</strong><ul><li>A small garden</li></ul></aside>')).toBe('Key takeaways A small garden');
            expect(summaryPlainText('<details><summary>More</summary>Hidden text</details>')).toBe('More Hidden text');
            expect(summaryPlainText('<table><tr><td>One</td><td>Two</td></tr></table><figure><img src="a.jpg"><figcaption>Caption</figcaption></figure>After')).toBe('One Two Caption After');
            expect(summaryPlainText('<div>Label</div>Text<hr>More<br/>Last')).toBe('Label Text More Last');
        });

        it('reads common entities as their characters, and never makes a tag', () => {
            expect(summaryPlainText('<p>Tom &amp; Jerry&nbsp;say &quot;hi&quot; &#39;twice&#39;</p>')).toBe('Tom & Jerry say "hi" \'twice\'');
            expect(summaryPlainText('<p>&lt;script&gt; stays text</p>')).toBe('&lt;script&gt; stays text');
            expect(summaryPlainText('<p>Before</p><script>alert(1)</script><style>p{}</style><p>After</p>')).toBe('Before After');
        });

        it('is empty for an empty body', () => {
            expect(summaryPlainText('')).toBe('');
            expect(summaryPlainText('<p></p><p>&nbsp;</p>')).toBe('');
            expect(summaryPlainText(undefined as unknown as string)).toBe('');
        });
    });

    describe('bodyExcerpt', () => {
        it('is all of a short body', () => {
            expect(bodyExcerpt('<p>  Short body. </p>')).toBe('Short body.');
            expect(bodyExcerpt('<p>No full stop at the end</p>')).toBe('No full stop at the end');
        });

        it('is the whole sentences that fit in the limit', () => {
            const first = sentence(12);
            const second = sentence(8, 'Second');
            const third = sentence(20, 'Third');
            const excerpt = bodyExcerpt(`<p>${first} ${second}</p><p>${third}</p>`);
            expect(`${first} ${second} ${third}`.length).toBeGreaterThan(SUMMARY_LIMIT);
            expect(excerpt).toBe(`${first} ${second}`);
            expect(excerpt.length).toBeLessThanOrEqual(SUMMARY_LIMIT);
        });

        it('ends a sentence at a question or exclamation mark, and after a closing quote', () => {
            const text = `Is it worth it? ${'Yes it is, for most homes with a garden and a south facing roof!'} "It paid for itself," she said. ${sentence(30, 'Later')}`;
            expect(bodyExcerpt(`<p>${text}</p>`)).toBe('Is it worth it? Yes it is, for most homes with a garden and a south facing roof! "It paid for itself," she said.');
        });

        it('does not end a sentence at an abbreviation before a lowercase word', () => {
            const text = 'Small things in a garden, such as new paths, e.g. the ones at the back, matter more than the size of the beds when you plan a new garden for a sunny place in the hills.';
            const excerpt = bodyExcerpt(`<p>${text} ${sentence(10, 'More')}</p>`);
            expect(excerpt.endsWith('e.g.')).toBe(false);
            expect(excerpt.endsWith('...')).toBe(true);
        });

        it('cuts a long first sentence at a word and ends with an ellipsis', () => {
            const long = 'When the fair has no single organiser the opening date slips a week at a time and the stall plan keeps moving because each group waits for the other one to agree on the map first';
            const excerpt = bodyExcerpt(`<p>${long}.</p>`);
            expect(excerpt.length).toBeLessThanOrEqual(SUMMARY_LIMIT);
            expect(excerpt.endsWith('...')).toBe(true);
            const kept = excerpt.slice(0, -3);
            // Every word kept is a whole word of the body.
            expect(long.startsWith(kept)).toBe(true);
            expect(long[kept.length]).toBe(' ');
        });

        it('never ends mid-word, at any length of word or limit', () => {
            const words = ['a', 'bb', 'seed', 'gardening', 'watering', 'whether', 'flower'];
            const text = Array.from({ length: 80 }, (_, i) => words[(i * 3) % words.length]).join(' ');
            for (let limit = 20; limit <= 200; limit += 7) {
                const excerpt = bodyExcerpt(`<p>${text}</p>`, limit);
                expect(excerpt.length).toBeLessThanOrEqual(limit);
                const kept = excerpt.replace(/\.\.\.$/, '');
                expect(text.startsWith(kept)).toBe(true);
                expect([' ', undefined]).toContain(text[kept.length]);
            }
        });

        it('fills a short first sentence with more words when the next one is too long to fit', () => {
            const excerpt = bodyExcerpt(`<p>Spring is here. ${sentence(40, 'The')}</p>`);
            expect(excerpt.startsWith('Spring is here. The word0')).toBe(true);
            expect(excerpt.endsWith('...')).toBe(true);
            expect(excerpt.length).toBeLessThanOrEqual(SUMMARY_LIMIT);
        });

        it('keeps a heading apart from the first paragraph', () => {
            const html = `<section data-arc-block="takeaways"><h3>Key takeaways</h3><ul><li><p>A small garden grows best with sun for most of the day.</p></li></ul></section><p>${sentence(30)}</p>`;
            expect(bodyExcerpt(html)).toBe('Key takeaways A small garden grows best with sun for most of the day.');
        });

        it('leaves file cards out', () => {
            const card = '<a class="arc-file" data-arc-file="pdf" href="https://x/a.pdf"><span class="arc-file-title">Brochure</span><span class="arc-file-meta">PDF · 28 KB</span></a>';
            expect(bodyExcerpt(`${card}<p>The details are in the brochure.</p>`)).toBe('The details are in the brochure.');
            expect(bodyExcerpt(card)).toBe('');
        });

        it('is empty for an empty body', () => {
            expect(bodyExcerpt('')).toBe('');
            expect(bodyExcerpt('<p></p>')).toBe('');
            expect(bodyExcerpt(null as unknown as string)).toBe('');
        });

        it('cuts a run of letters with no word in it (a web address) inside', () => {
            const excerpt = bodyExcerpt(`<p>See https://example.com/${'a'.repeat(300)}</p>`);
            expect(excerpt.length).toBe(SUMMARY_LIMIT);
            expect(excerpt.endsWith('...')).toBe(true);
        });

        it('ends a sentence in scripts with their own full stop', () => {
            const hindi = `यह पहला वाक्य है। ${'यह दूसरा लंबा वाक्य है '.repeat(10)}।`;
            expect(bodyExcerpt(`<p>${hindi}</p>`, 60)).toBe('यह पहला वाक्य है।');
            expect(shortText('第一句。第二句很长很长。', 8)).toBe('第一句。');
        });
    });

    describe('clipWords', () => {
        it('keeps text that fits, and cuts the rest at a word with "..."', () => {
            expect(clipWords('Short text', 20)).toBe('Short text');
            expect(clipWords('The quick brown fox jumps over the lazy dog', 20)).toBe('The quick brown...');
        });

        it('leaves no comma or full stop before the ellipsis', () => {
            expect(clipWords('One, two, three, four, five', 15)).toBe('One, two...');
            expect(clipWords('One. Two three four five', 10)).toBe('One...');
        });

        it('does not split an emoji', () => {
            const clipped = clipWords('😀'.repeat(20), 10);
            expect(clipped.endsWith('...')).toBe(true);
            expect(clipped.slice(0, -3)).toBe('😀'.repeat(3));
        });
    });

    describe('automaticSummaries', () => {
        // Entries stored before this rule keep their old automatic summary:
        // it must still be known as automatic, not as written by hand.
        const body = `<h2>Key takeaways</h2><p>${'The fair opens a week later each year and the stall plan keeps moving. '.repeat(3)}</p>`;

        it('starts with the current summary', () => {
            expect(automaticSummaries(body)[0]).toBe(bodyExcerpt(body));
        });

        it('knows the first 100 characters the editor used to store, with and without a space between blocks', () => {
            const all = automaticSummaries(body);
            expect(all).toContain('Key takeaways The fair opens a week later each year and the stall plan keeps moving. The fair opens');
            expect(all).toContain('Key takeawaysThe fair opens a week later each year and the stall plan keeps moving. The fair opens a');
        });

        it('has no empty or repeated entries', () => {
            expect(automaticSummaries('<p>Short body.</p>')).toEqual(['Short body.']);
            expect(automaticSummaries('')).toEqual([]);
        });
    });
});
