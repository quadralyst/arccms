import { describe, it, expect } from 'vitest';
import { ChecklistInput, evaluateDiscoverability } from './discoverability-checklist';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const GOOD: ChecklistInput = {
    title: 'How much does Arc CMS cost in India?',
    bodyHtml: `<p>${words(30)}</p><h2>What does it include?</h2><ul><li>a</li><li>b</li></ul>`
        + `<section data-arc-block="faq"><h3>Q?</h3><p>A.</p></section>`
        + `<p><a href="/articles/one">one</a> <a href="https://site.example/articles/two">two</a> <a href="/pricing">three</a> <a href="https://other.example">ext</a></p>`
        + `<p>${words(300)}</p>`,
    summary: 'Summary',
    metaDescription: 'A meta description that is long enough to count, describing the page in a sentence or two.',
    coverImage: 'https://site.example/c.jpg',
    authorId: 'a1',
    references: [{ url: 'https://ref.example' }],
    tags: ['pricing', 'india'],
    publishedOn: new Date(),
    updatedOn: null,
    siteOrigin: 'https://site.example/',
};

describe('evaluateDiscoverability (D-D13)', () => {
    it('scores a well-shaped draft 100 with every rule passing', () => {
        const report = evaluateDiscoverability(GOOD);
        expect(report.results.filter(r => !r.ok).map(r => r.id)).toEqual([]);
        expect(report.score).toBe(100);
        expect(report.passed).toBe(report.total);
    });

    it('fails the right rules on an empty draft and weights the score', () => {
        const report = evaluateDiscoverability({
            ...GOOD, title: '', bodyHtml: '', metaDescription: '', coverImage: null, authorId: null, references: [], tags: [],
            publishedOn: new Date(Date.now() - 400 * 24 * 3600 * 1000),
        });
        expect(report.score).toBe(0);
        const failed = report.results.filter(r => !r.ok).map(r => r.id);
        expect(failed).toEqual(expect.arrayContaining(['title_length', 'meta_description', 'answer_first', 'question_heading', 'list_or_table', 'blocks', 'internal_links', 'length', 'cover_image', 'author', 'sources', 'tags', 'freshness']));
    });

    it('counts only internal links, ignoring anchors, mail and other hosts', () => {
        const report = evaluateDiscoverability({
            ...GOOD,
            bodyHtml: '<p><a href="#top">a</a> <a href="mailto:x@y">b</a> <a href="https://other.example/p">c</a> <a href="//cdn.example/x">d</a> <a href="/one">e</a></p>',
        });
        const links = report.results.find(r => r.id === 'internal_links')!;
        expect(links.ok).toBe(false);
        expect(links.detail).toBe('1');
    });

    it('judges the opening paragraph by length and freshness by the later of the two dates', () => {
        const short = evaluateDiscoverability({ ...GOOD, bodyHtml: `<p>${words(5)}</p>` });
        expect(short.results.find(r => r.id === 'answer_first')!.ok).toBe(false);
        const long = evaluateDiscoverability({ ...GOOD, bodyHtml: `<p>${words(120)}</p>` });
        expect(long.results.find(r => r.id === 'answer_first')!.ok).toBe(false);

        const stale = evaluateDiscoverability({ ...GOOD, publishedOn: new Date(Date.now() - 500 * 24 * 3600 * 1000), updatedOn: { seconds: Math.floor(Date.now() / 1000) - 60 } });
        expect(stale.results.find(r => r.id === 'freshness')!.ok).toBe(true);
        const unpublished = evaluateDiscoverability({ ...GOOD, publishedOn: null, updatedOn: null });
        expect(unpublished.results.find(r => r.id === 'freshness')!.ok).toBe(true);
    });

    it('carries translation keys for label and fix', () => {
        const rule = evaluateDiscoverability(GOOD).results[0];
        expect(rule.labelKey).toBe(`admin.contents.checklist.${rule.id}`);
        expect(rule.fixKey).toBe(`admin.contents.checklist.${rule.id}_fix`);
    });
});
