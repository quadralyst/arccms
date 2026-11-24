/** What differs between a draft and what is live (specs/visual-editing-spec.md, VE6.B1). */
import { describe, expect, it } from 'vitest';
import { entryChanges, pageChanges, plainText, stableText, wordDiff } from './compare';
import { changedJustNow, heldByOther, holdOf, isHeld, HeldError } from './hold';

describe('entryChanges', () => {
    const published = {
        title: 'Guide', content: '<p>One two</p>', summary: 'S', coverImage: 'a.png', tags: ['x'],
        customFields: { price: 5, faq: [{ id: 'r1', q: 'Q1' }, { id: 'r2', q: 'Q2' }], _ref_author: { id: '1', title: 'Old' } },
        publishedOn: { seconds: 1 }, modifiedAt: { seconds: 2 }, sortOrder: 4, modifiedBy: 'u1',
    };

    it('is empty for the same words, whatever the dates, key order or empty values', () => {
        const draft = {
            ...published, modifiedAt: { seconds: 99 }, sortOrder: 9, modifiedBy: 'u2', status: 'draft', editing: { by: 'u2' }, changedOnPage: 'home',
            content: '<p>One  two</p>\n', seoTitle: '', references: [], canonicalUrl: null,
            customFields: { faq: [{ q: 'Q1', id: 'r1' }, { id: 'r2', q: 'Q2' }], price: 5, note: '', _ref_author: { id: '1', title: 'New' } },
        };
        expect(entryChanges({ draft, published })).toEqual([]);
    });

    it('lists fields, body, picture and rows, in the panel\'s order', () => {
        const draft = {
            ...published, title: 'Guide 2', content: '<p>One three</p>', coverImage: 'b.png', tags: ['x', 'y'],
            customFields: { price: 6, faq: [{ id: 'r1', q: 'Changed' }, { id: 'r3', q: 'New' }] },
        };
        const changes = entryChanges({ draft, published, fields: [{ key: 'faq', type: 'faq' }, { key: 'price', type: 'number' }] });
        expect(changes.map((c) => c.field)).toEqual(['title', 'content', 'coverImage', 'tags', 'cf:faq', 'cf:price']);
        expect(changes.find((c) => c.field === 'content')).toMatchObject({ kind: 'rich', before: 'One two', after: 'One three' });
        expect(changes.find((c) => c.field === 'cf:faq')).toMatchObject({ kind: 'rows', rows: { added: 1, removed: 1, changed: 1 } });
        expect(changes.find((c) => c.field === 'coverImage')).toMatchObject({ kind: 'picture', before: 'a.png', after: 'b.png' });
    });

    it('compares each language\'s translation, also one added or removed whole', () => {
        const changes = entryChanges({
            draft: published, published,
            translations: {
                hi: { draft: { title: 'नया' }, published: { title: 'पुराना' } },
                ta: { draft: null, published: { summary: 'Gone' } },
            },
        });
        expect(changes.map((c) => [c.lang, c.field])).toEqual([['hi', 'title'], ['ta', 'summary']]);
    });

    it('compares the series links by the entry linked to, not by its copied title', () => {
        const at = (next: unknown) => entryChanges({ draft: { nextContent: next }, published: { nextContent: { id: 'a', title: 'A' } } });
        expect(at({ id: 'a', title: 'A renamed' })).toEqual([]);
        expect(at({ id: 'b', title: 'B' })).toMatchObject([{ field: 'nextContent', before: 'A', after: 'B' }]);
        expect(at(null)).toMatchObject([{ field: 'nextContent', after: '' }]);
        expect(entryChanges({ draft: { previousContent: { id: 'x', title: 'X' } }, published: {} }).map((c) => c.field)).toEqual(['previousContent']);
    });

    it('says names for ids, each row\'s words, and when only formatting changed', () => {
        const changes = entryChanges({
            draft: { authorId: 'u2', authorName: 'Ravi', content: '<p>One <b>two</b></p>', customFields: { cat: 'c2', _ref_cat: { id: 'c2', title: 'Cakes' }, faq: [{ id: 'r', q: 'Why', a: 'New' }] } },
            published: { authorId: 'u1', authorName: 'Asha', content: '<p>One two</p>', customFields: { cat: 'c1', _ref_cat: { id: 'c1', title: 'Breads' }, faq: [{ id: 'r', q: 'Why', a: 'Old' }] } },
        });
        const of = (field: string) => changes.find((c) => c.field === field)!;
        expect(of('authorId')).toMatchObject({ before: 'Asha', after: 'Ravi' });
        expect(of('cf:cat')).toMatchObject({ before: 'Breads', after: 'Cakes' });
        expect(of('cf:faq')).toMatchObject({ before: 'Why / Old', after: 'Why / New' });
        expect(of('content').sameWords).toBe(true);
        expect(of('authorId').sameWords).toBeUndefined();
    });

    it('treats an entry with nothing published as all new', () => {
        expect(entryChanges({ draft: { title: 'New', content: '<p></p>' }, published: null }).map((c) => c.field)).toEqual(['title']);
    });
});

describe('pageChanges', () => {
    it('compares values only: who saved them and against what makes no difference', () => {
        const draft = { text: { en: { hero: { value: 'Hi', by: 'u', fileText: 'Hello' } } }, urls: { photo: { value: '/a.jpg' } }, seo: { en: { title: { value: 'T' } } } };
        expect(pageChanges(draft, { text: { en: { hero: { value: 'Hi' } } }, urls: { photo: { value: '/a.jpg' } }, seo: { en: { title: { value: 'T' } } } })).toEqual([]);
    });

    it('lists words, pictures, search words and the share picture, and a value put back to the file\'s', () => {
        const changes = pageChanges(
            { text: { en: { hero: { value: 'Hi <b>all</b>' } } }, urls: { photo: { value: '/b.jpg' } }, seo: { en: { description: { value: 'D' } } } },
            { text: { en: { hero: { value: 'Hi' }, intro: { value: 'Gone' } } }, urls: { photo: { value: '/a.jpg' } }, shareImage: { value: '/s.png' } },
        );
        expect(changes.map((c) => [c.field, c.kind])).toEqual([
            ['text:hero', 'rich'], ['text:intro', 'text'], ['url:photo', 'picture'], ['seo:description', 'text'], ['shareImage', 'picture'],
        ]);
        expect(changes[1]).toMatchObject({ before: 'Gone', after: '' });
        expect(pageChanges(null, null)).toEqual([]);
    });
});

describe('wordDiff and plain words', () => {
    it('marks the words removed and added', () => {
        expect(wordDiff('We sell bread daily', 'We bake bread daily')).toEqual([
            { kind: 'same', text: 'We ' }, { kind: 'removed', text: 'sell' }, { kind: 'added', text: 'bake' }, { kind: 'same', text: ' bread daily' },
        ]);
        expect(wordDiff('About First article', 'About Priya summary')).toEqual([
            { kind: 'same', text: 'About ' }, { kind: 'removed', text: 'First article' }, { kind: 'added', text: 'Priya summary' },
        ]);
        expect(wordDiff('', 'New')).toEqual([{ kind: 'added', text: 'New' }]);
        expect(wordDiff('Same', 'Same')).toEqual([{ kind: 'same', text: 'Same' }]);
        expect(wordDiff('', '')).toEqual([]);
    });

    it('a very long text is still compared, by line', () => {
        const long = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
        const parts = wordDiff(long, long.replace('line 10\n', 'line ten\n'));
        expect(parts.map((p) => p.text).join('')).toContain('line ten');
    });

    it('never gives markup back', () => {
        expect(plainText('<p>a <b>b</b></p><script>x</script>&lt;i&gt;')).toBe('a b\nx<i>');
        expect(plainText([{ id: '1', q: 'Why', a: '<p>So</p>' }])).toBe('Why, So');
        expect(stableText({ b: 1, a: { seconds: 5, nanoseconds: 0 } })).toBe(stableText({ a: new Date(5000), b: 1, c: '' }));
    });
});

describe('the hold', () => {
    it('is someone else\'s only when it names another account', () => {
        expect(holdOf({ editing: { by: 'u1', name: 'Asha' } })?.name).toBe('Asha');
        expect(holdOf({ editing: null })).toBeNull();
        expect(holdOf({ editing: { name: 'No account' } })).toBeNull();
        expect(heldByOther({ editing: { by: 'u1', name: 'A' } }, 'u1')).toBeNull();
        expect(heldByOther({ editing: { by: 'u1', name: 'A' } }, 'u2')?.by).toBe('u1');
        expect(isHeld(new HeldError({ by: 'u1', name: 'A' }))).toBe(true);
        expect(isHeld(new Error('x'))).toBe(false);
    });

    it('knows a change made moments ago', () => {
        expect(changedJustNow({ by: 'u', name: 'A', at: { seconds: 1000 } }, 1000_000 + 60_000)).toBe(true);
        expect(changedJustNow({ by: 'u', name: 'A', at: { seconds: 1000 } }, 1000_000 + 400_000)).toBe(false);
        expect(changedJustNow(null, 0)).toBe(false);
    });
});
