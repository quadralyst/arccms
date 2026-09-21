/**
 * HTML to Markdown, for the Markdown twin of every published page
 * (docs/discoverability-spec.md, D-D8).
 *
 * Covers what the Tiptap editor produces: headings, paragraphs, emphasis,
 * links, images, nested lists, task lists, blockquotes, code, tables,
 * horizontal rules and line breaks. Unknown elements contribute their text.
 * Scripts and styles are dropped. Pure and dependency-free apart from
 * cheerio, which the pipeline already uses.
 */
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

const BLOCK_TAGS = new Set([
    'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre',
    'table', 'thead', 'tbody', 'tr', 'hr', 'figure', 'figcaption', 'details', 'summary',
]);

export function htmlToMarkdown(html: string): string {
    if (!html || !html.trim()) return '';
    const $ = cheerio.load(`<body>${html}</body>`, { xmlMode: false });
    $('script, style, template').remove();
    const out = renderChildren($('body')[0] as Element, $, 0);
    return collapseBlankLines(out).trim() + (out.trim() ? '\n' : '');
}

function renderChildren(el: Element, $: cheerio.CheerioAPI, listDepth: number): string {
    return (el.children as AnyNode[]).map(child => renderNode(child, $, listDepth)).join('');
}

function renderNode(node: AnyNode, $: cheerio.CheerioAPI, listDepth: number): string {
    if (node.type === 'text') {
        return escapeText(node.data || '');
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return '';
    const el = node as Element;
    const tag = el.name.toLowerCase();
    const inner = () => renderChildren(el, $, listDepth);

    switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
            const level = Number(tag[1]);
            return `\n\n${'#'.repeat(level)} ${inline(inner())}\n\n`;
        }
        case 'p':
            return `\n\n${inline(inner())}\n\n`;
        case 'br':
            return '  \n';
        case 'hr':
            return '\n\n---\n\n';
        case 'strong': case 'b':
            return wrap(inner(), '**');
        case 'em': case 'i':
            return wrap(inner(), '*');
        case 's': case 'del': case 'strike':
            return wrap(inner(), '~~');
        case 'code':
            return el.parent && (el.parent as Element).name === 'pre' ? inner() : `\`${textOf(el, $)}\``;
        case 'pre': {
            const code = $(el).find('code').first();
            const lang = (code.attr('class') || '').match(/language-([\w-]+)/)?.[1] || '';
            const body = (code.length ? code.text() : $(el).text()).replace(/\n$/, '');
            return `\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
        }
        case 'a': {
            const href = ($(el).attr('href') || '').trim();
            const text = inline(inner());
            return href ? `[${text || href}](${href})` : text;
        }
        case 'img': {
            const src = ($(el).attr('src') || '').trim();
            if (!src) return '';
            const alt = ($(el).attr('alt') || '').trim();
            return `![${alt}](${src})`;
        }
        case 'ul': case 'ol':
            return `\n\n${renderList(el, $, listDepth, tag === 'ol')}\n\n`;
        case 'li':
            // Only reached for a stray <li> outside a list; render as a bullet.
            return `\n- ${inline(inner())}\n`;
        case 'blockquote': {
            const body = collapseBlankLines(inner()).trim();
            return `\n\n${body.split('\n').map(line => `> ${line}`.trimEnd()).join('\n')}\n\n`;
        }
        case 'table':
            return `\n\n${renderTable(el, $)}\n\n`;
        case 'iframe': {
            const src = ($(el).attr('src') || '').trim();
            const title = ($(el).attr('title') || 'Embedded content').trim();
            return src ? `\n\n[${title}](${src})\n\n` : '';
        }
        case 'input':
            // Tiptap task items: a checkbox before the label.
            if (($(el).attr('type') || '') === 'checkbox') return $(el).attr('checked') !== undefined ? '[x] ' : '[ ] ';
            return '';
        case 'figcaption':
            return `\n\n*${inline(inner())}*\n\n`;
        default:
            return BLOCK_TAGS.has(tag) ? `\n\n${inner()}\n\n` : inner();
    }
}

function renderList(list: Element, $: cheerio.CheerioAPI, depth: number, ordered: boolean): string {
    const items = (list.children as AnyNode[]).filter(
        (n): n is Element => n.type === 'tag' && (n as Element).name.toLowerCase() === 'li',
    );
    const indent = '  '.repeat(depth);
    return items.map((li, index) => {
        const marker = ordered ? `${index + 1}.` : '-';
        // Nested lists render as their own block after the item's own text.
        const nested = (li.children as AnyNode[]).filter(
            (n): n is Element => n.type === 'tag' && ['ul', 'ol'].includes((n as Element).name.toLowerCase()),
        );
        const ownText = inline(
            (li.children as AnyNode[])
                .filter(n => !nested.includes(n as Element))
                .map(n => renderNode(n, $, depth + 1))
                .join(''),
        );
        const nestedText = nested
            .map(n => renderList(n, $, depth + 1, (n as Element).name.toLowerCase() === 'ol'))
            .filter(Boolean)
            .join('\n');
        return `${indent}${marker} ${ownText}${nestedText ? `\n${nestedText}` : ''}`;
    }).join('\n');
}

function renderTable(table: Element, $: cheerio.CheerioAPI): string {
    const rows = $(table).find('tr').toArray();
    if (!rows.length) return '';
    const cells = rows.map(tr =>
        $(tr).children('th, td').toArray().map(cell => inline(renderChildren(cell as Element, $, 0)).replace(/\|/g, '\\|')),
    );
    const width = Math.max(...cells.map(r => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
    const [head, ...body] = cells.map(pad);
    const line = (r: string[]) => `| ${r.join(' | ')} |`;
    return [line(head), `| ${head.map(() => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}

/** Inline content: whitespace collapsed to single spaces, trimmed. */
function inline(text: string): string {
    return text.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function wrap(text: string, marks: string): string {
    const inner = inline(text);
    if (!inner) return '';
    // Keep surrounding spaces outside the marks so "**bold** text" stays valid.
    const lead = /^\s/.test(text) ? ' ' : '';
    const tail = /\s$/.test(text) ? ' ' : '';
    return `${lead}${marks}${inner}${marks}${tail}`;
}

function textOf(el: Element, $: cheerio.CheerioAPI): string {
    return $(el).text();
}

function escapeText(text: string): string {
    // Only characters that would otherwise start Markdown syntax at line
    // starts get escaped; a stray asterisk or underscore mid-sentence is
    // harmless and escaping it makes the file harder to read.
    return text.replace(/ /g, ' ');
}

function collapseBlankLines(text: string): string {
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
