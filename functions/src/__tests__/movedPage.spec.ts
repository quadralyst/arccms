import { describe, it, expect } from 'vitest';
import { movedPageFiles, movedPageHtml } from '../pages/moved-page.js';

// RF4 4.6: a published entry whose address changed.
describe('moved-page', () => {
    const entry = {
        contentTypeSlug: 'blog',
        from: 'old-post',
        to: 'new-post',
        redirect: true,
        languages: ['en', 'hi'],
        defaultLang: 'en',
        baseUrl: 'https://example.com/',
    };

    it('leaves a page at the old address in every language that sends visitors to the new one', () => {
        const { add, remove } = movedPageFiles(entry);
        expect(add.map((f) => f.path)).toEqual(['/blog/old-post.html', '/hi/blog/old-post.html']);
        expect(add[0].content).toContain('content="0; url=/blog/new-post"');
        expect(add[0].content).toContain('<link rel="canonical" href="https://example.com/blog/new-post">');
        expect(add[1].content).toContain('url=/hi/blog/new-post');
        expect(add[1].content).toContain('<html lang="hi">');
        // The old Markdown twins go; the old pages are replaced, not removed.
        expect(remove).toEqual(['/blog/old-post.md', '/hi/blog/old-post.md']);
    });

    it('takes the old address down when the admin unticked the box', () => {
        const { add, remove } = movedPageFiles({ ...entry, redirect: false });
        expect(add).toEqual([]);
        expect(remove).toEqual(['/blog/old-post.md', '/blog/old-post.html', '/hi/blog/old-post.md', '/hi/blog/old-post.html']);
    });

    it('changes nothing when the address did not change', () => {
        expect(movedPageFiles({ ...entry, to: 'old-post' })).toEqual({ add: [], remove: [] });
        expect(movedPageFiles({ ...entry, from: '' })).toEqual({ add: [], remove: [] });
    });

    it('keeps the query and fragment, never search-indexes itself, and escapes what it prints', () => {
        const html = movedPageHtml('/blog/a"b</script>', 'https://example.com/blog/x', 'en');
        expect(html).toContain('location.replace("/blog/a\\"b\\u003c/script>" + location.search + location.hash)');
        expect(html).toContain('<meta name="robots" content="noindex">');
        expect(html).toContain('href="/blog/a&quot;b&lt;/script&gt;"');
        expect(html).not.toContain('</script></script>');
    });

    // RF4 server review L4: only the languages given are moved.
    it('moves only the languages it is given', () => {
        const { add } = movedPageFiles({ ...entry, languages: ['en'] });
        expect(add.map((f) => f.path)).toEqual(['/blog/old-post.html']);
    });
});
