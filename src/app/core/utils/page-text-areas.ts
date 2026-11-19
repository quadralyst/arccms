import { PAGE_TEXT_KEY, type PageTextKind } from './page-text-model';

/**
 * The areas a page's file marks for editors (specs/visual-editing-spec.md,
 * VE-D41, VE-D50), read for the classic editor: what each one is, what the file
 * has in it, and the section it sits in. Read with the browser's own parser, so
 * the admin loads no other.
 */

/** A section of the page, for grouping its areas (VE-D50). */
export interface PageSection {
    /** Its place on the page, from 0; -1 for areas in no `<section>`. */
    index: number;
    /** Its `data-arc-label`, else its first heading, else ''. */
    label: string;
}

/** One marked area. */
export interface PageTextArea {
    key: string;
    kind: Exclude<PageTextKind, 'title' | 'description' | 'none'>;
    /** The name the developer gave it (`data-arc-label`), else ''. */
    label: string;
    /** The words an empty area shows (`data-arc-placeholder`), else ''. */
    placeholder: string;
    section: PageSection;
    /** The file's words: text, rich text's HTML, alt text, link text, a section title. */
    fileText: string;
    /** The file's address: a picture's, a link's, a background's. */
    fileUrl: string;
    /** The area's `data-arc-t` key for its words (for alt text and a section title, from `data-arc-t-attr`), else ''. */
    stringKey: string;
    /** Whether a link holds elements (an icon), so only its address is edited. */
    addressOnly: boolean;
}

/** A card block on the page (VE-D50). */
export interface PageCardBlock {
    type: string;
    /** How many cards it shows (`count`, default 4). */
    count: number;
    /** Its `section-title` in the file, else ''. */
    fileTitle: string;
    /** The page text key of its section title when it is marked, else ''. */
    titleKey: string;
    section: PageSection;
}

/** What the editor needs from a page's file. */
export interface PageFile {
    areas: PageTextArea[];
    cardBlocks: PageCardBlock[];
    /** The file's own title and description, the SEO tab's defaults. */
    title: string;
    description: string;
    /** Their `data-arc-t` keys, for a language without its own file. */
    titleStringKey: string;
    descriptionStringKey: string;
}

const clean = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();

/** The `data-arc-t-attr` key of one attribute, or ''. */
function attrStringKey(element: Element, attr: string): string {
    for (const pair of (element.getAttribute('data-arc-t-attr') || '').split(',')) {
        const [name, key] = pair.split(':').map((part) => part.trim());
        if (name === attr && key) return key;
    }
    return '';
}

/** The address in an element's own `background-image`, else ''. */
export function backgroundUrlOf(style: string | null): string {
    const match = /background-image\s*:\s*url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/i.exec(style || '');
    return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : '';
}

const NOT_EDITABLE = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'input', 'link', 'source', 'track', 'wbr', 'param',
    'script', 'style', 'noscript', 'template', 'iframe', 'object', 'textarea', 'select', 'option', 'head', 'html', 'body',
]);

/** What an area is, as page-text.ts decides it (kept the same by page-text-areas.spec.ts). */
function kindOf(element: Element): PageTextKind {
    const name = element.tagName.toLowerCase();
    const kind = (element.getAttribute('data-arc-edit-kind') || '').trim().toLowerCase();
    if (name === 'title') return 'title';
    if (name === 'meta') return (element.getAttribute('name') || '').toLowerCase() === 'description' ? 'description' : 'none';
    if (name === 'arc-content-partials') return 'section-title';
    if (NOT_EDITABLE.has(name)) return 'none';
    if (kind === 'background') return 'background';
    if (name === 'img') return 'picture';
    if (kind === 'rich') return 'rich';
    if (name === 'a') return 'link';
    return 'text';
}

/** Reads the marked areas, card blocks, title and description of a page's file. */
export function readPageFile(html: string): PageFile {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const sections = Array.from(doc.querySelectorAll('section'));
    const sectionOf = (element: Element): PageSection => {
        const section = element.closest('section');
        if (!section) return { index: -1, label: '' };
        const heading = section.querySelector('h1, h2, h3, h4');
        return { index: sections.indexOf(section), label: clean(section.getAttribute('data-arc-label')) || clean(heading?.textContent) };
    };

    const areas: PageTextArea[] = [];
    const seen = new Set<string>();
    for (const element of Array.from(doc.querySelectorAll('[data-arc-edit]'))) {
        const key = (element.getAttribute('data-arc-edit') || '').trim();
        const kind = kindOf(element);
        if (!PAGE_TEXT_KEY.test(key) || seen.has(key) || kind === 'none' || kind === 'title' || kind === 'description') continue;
        seen.add(key);
        const area: PageTextArea = {
            key, kind,
            label: clean(element.getAttribute('data-arc-label')),
            placeholder: clean(element.getAttribute('data-arc-placeholder')),
            section: sectionOf(element),
            fileText: '', fileUrl: '', stringKey: element.getAttribute('data-arc-t') || '', addressOnly: false,
        };
        switch (kind) {
            case 'text': area.fileText = clean(element.textContent); break;
            case 'rich': area.fileText = element.innerHTML.trim(); break;
            case 'section-title':
                area.fileText = clean(element.getAttribute('section-title'));
                area.stringKey = attrStringKey(element, 'section-title');
                break;
            case 'picture':
                area.fileText = clean(element.getAttribute('alt'));
                area.fileUrl = (element.getAttribute('src') || '').trim();
                area.stringKey = attrStringKey(element, 'alt');
                break;
            case 'link':
                area.addressOnly = element.children.length > 0;
                area.fileText = area.addressOnly ? '' : clean(element.textContent);
                area.fileUrl = (element.getAttribute('href') || '').trim();
                break;
            case 'background':
                area.fileUrl = backgroundUrlOf(element.getAttribute('style'));
                break;
        }
        areas.push(area);
    }

    const cardBlocks: PageCardBlock[] = Array.from(doc.querySelectorAll('arc-content-partials'))
        // Cards in the header and footer are not this page's (VE-D20).
        .filter((element) => !element.closest('arc-header, arc-footer'))
        .map((element) => {
            const count = parseInt(element.getAttribute('count') || '', 10);
            const key = (element.getAttribute('data-arc-edit') || '').trim();
            return {
                type: (element.getAttribute('content-type') || '').trim(),
                count: Number.isFinite(count) && count > 0 ? count : 4,
                fileTitle: clean(element.getAttribute('section-title')),
                titleKey: PAGE_TEXT_KEY.test(key) ? key : '',
                section: sectionOf(element),
            };
        })
        .filter((block) => !!block.type);

    const title = doc.head?.querySelector('title');
    const description = doc.querySelector('meta[name="description"]');
    return {
        areas, cardBlocks,
        title: clean(title?.textContent),
        description: clean(description?.getAttribute('content')),
        titleStringKey: title?.getAttribute('data-arc-t') || '',
        descriptionStringKey: description ? attrStringKey(description, 'content') : '',
    };
}
