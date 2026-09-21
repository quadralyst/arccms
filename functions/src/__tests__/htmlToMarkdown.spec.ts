import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../shared/html-to-markdown.js';

describe('htmlToMarkdown (docs/discoverability-spec.md, D-D8)', () => {
    it('returns an empty string for nothing', () => {
        expect(htmlToMarkdown('')).toBe('');
        expect(htmlToMarkdown('   ')).toBe('');
    });

    it('renders headings and paragraphs with one blank line between blocks', () => {
        const md = htmlToMarkdown('<h2>Why</h2><p>Because <strong>it</strong> matters.</p><h3>How</h3><p>Like so.</p>');
        expect(md).toBe('## Why\n\nBecause **it** matters.\n\n### How\n\nLike so.\n');
    });

    it('renders emphasis, strikethrough, inline code and line breaks', () => {
        expect(htmlToMarkdown('<p>a <em>b</em> <b>c</b> <s>d</s> <code>e()</code>.<br>next</p>'))
            .toBe('a *b* **c** ~~d~~ `e()`.  \nnext\n');
    });

    it('renders links and images', () => {
        expect(htmlToMarkdown('<p>See <a href="https://x.com/a">this</a> and <img src="/i.png" alt="pic"></p>'))
            .toBe('See [this](https://x.com/a) and ![pic](/i.png)\n');
        expect(htmlToMarkdown('<p><a href="https://x.com"></a></p>')).toBe('[https://x.com](https://x.com)\n');
    });

    it('renders nested bullet and numbered lists', () => {
        const md = htmlToMarkdown('<ul><li>One<ul><li>Sub</li></ul></li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>');
        expect(md).toBe('- One\n  - Sub\n- Two\n\n1. First\n2. Second\n');
    });

    it('renders task lists', () => {
        const md = htmlToMarkdown('<ul data-type="taskList"><li><label><input type="checkbox" checked></label><div><p>Done</p></div></li><li><label><input type="checkbox"></label><div><p>Todo</p></div></li></ul>');
        expect(md).toBe('- [x] Done\n- [ ] Todo\n');
    });

    it('renders blockquotes and code blocks with a language', () => {
        expect(htmlToMarkdown('<blockquote><p>Quoted</p><p>Twice</p></blockquote>')).toBe('> Quoted\n>\n> Twice\n');
        expect(htmlToMarkdown('<pre><code class="language-ts">const a = 1;\n</code></pre>')).toBe('```ts\nconst a = 1;\n```\n');
    });

    it('renders tables with a header row and escapes pipes', () => {
        const md = htmlToMarkdown('<table><tr><th>Name</th><th>Price</th></tr><tr><td>Gold</td><td>10 | 20</td></tr></table>');
        expect(md).toBe('| Name | Price |\n| --- | --- |\n| Gold | 10 \\| 20 |\n');
    });

    it('renders horizontal rules, iframes and figcaptions', () => {
        expect(htmlToMarkdown('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb\n');
        expect(htmlToMarkdown('<iframe src="https://www.youtube.com/embed/x" title="Demo"></iframe>')).toBe('[Demo](https://www.youtube.com/embed/x)\n');
        expect(htmlToMarkdown('<figure><img src="/a.png" alt="A"><figcaption>Caption</figcaption></figure>')).toBe('![A](/a.png)\n\n*Caption*\n');
    });

    it('drops scripts and styles, keeps text of unknown tags, and unwraps divs', () => {
        expect(htmlToMarkdown('<div><span>Hello</span> <script>x()</script><style>p{}</style><custom>world</custom></div>'))
            .toBe('Hello world\n');
    });

    it('normalises non-breaking spaces and stray whitespace', () => {
        expect(htmlToMarkdown('<p>a&nbsp;b</p>\n\n\n<p>  c  </p>')).toBe('a b\n\nc\n');
    });
});
