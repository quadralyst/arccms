/**
 * What a template can bind, by page: the admin's Template Reference (the view
 * page of a content type) shows these lists, and template-reference.spec.ts
 * checks each key against the data publishing gives that page, so the reference
 * cannot promise a binding that prints nothing. docs/features/templates.html
 * describes the same bindings in full.
 */

export interface TemplateAttr {
    /** The binding as publishing provides it, dotted for nested values; the spec checks it. */
    key: string;
    label: string;
    /** What the admin copies. */
    syntax: string;
    note?: string;
}

export interface TemplateRefSection {
    id: string;
    title: string;
    /** Font Awesome class for the heading. */
    icon: string;
    hint?: string;
    rows: TemplateAttr[];
}

/** The parts of a content type field the reference needs. */
export interface TemplateRefField {
    key: string;
    label: string;
    type: string;
    useCollectionRef?: boolean;
}

const bind = (key: string, label: string, syntax = `{{ ${key} }}`, note?: string): TemplateAttr =>
    note ? { key, label, syntax, note } : { key, label, syntax };

/** detail.html, outside any loop. */
export const DETAIL_FIELDS: TemplateAttr[] = [
    bind('title', 'Title'),
    bind('summary', 'Summary'),
    bind('content', 'Body (HTML)', '[innerHTML]="content"'),
    bind('coverImage', 'Cover image', '<img data-arc-bind="coverImage" alt="">', 'Sizes: coverImage_s, _m, _l, _xl'),
    bind('publishedOn', 'Published date', '{{ publishedOn }}', 'Long date in the page\'s language'),
    bind('updatedOnDisplay', 'Updated date', '<span data-arc-if="updatedOnDisplay">Updated {{ updatedOnDisplay }}</span>', 'Empty unless marked as a revision'),
    bind('readTime', 'Minutes to read'),
    bind('readingTime', 'Read time text', '{{ readingTime }}', '"5 min read", from the min_read string'),
    bind('authorName', 'Byline'),
    bind('author.name', 'Author box', '<aside data-arc-if="author.name">{{ author.name }}</aside>', 'Also author.bio, author.photoUrl, author.jobTitle, author.url'),
    bind('contentType', 'Type name'),
    bind('contentTypeSlug', 'Type slug'),
    bind('urlSlug', 'URL slug'),
    bind('id', 'Document id'),
    bind('metaDescription', 'Meta description'),
    bind('share.facebook', 'Share on Facebook', 'href="{{ share.facebook }}"', 'Also share.twitter, share.linkedin, share.whatsapp, share.email'),
    bind('nextContent.slug', 'Next entry link', 'href="{{ langPrefix }}/{{ contentTypeSlug }}/{{ nextContent.slug }}"', 'With nextContent.title; previousContent is the same. Hide with data-arc-if="nextContent"'),
    bind('hasReferences', 'Has sources', 'data-arc-if="hasReferences"'),
    bind('hasRelated', 'Has related entries', 'data-arc-if="hasRelated"', 'Needs the search feature'),
    bind('lang', 'Page language'),
    bind('langPrefix', 'Language prefix', '{{ langPrefix }}', '"" or "/hi"'),
];

/** Loops on a detail page; `key` is the loop, the note lists each row's bindings. */
export const DETAIL_LOOPS: TemplateAttr[] = [
    bind('tags', 'Tags', 'data-arc-loop="tags"', 'Rows: {{ name }}, {{ color }}'),
    bind('references', 'Sources', 'data-arc-loop="references"', 'Rows: {{ title }}, {{ url }}'),
    bind('related', 'Related entries', 'data-arc-loop="related"', 'Rows: {{ title }}, {{ url }}, {{ snippet }}, {{ badge }}'),
];

/** list.html, outside the items loop. */
export const LIST_FIELDS: TemplateAttr[] = [
    bind('items', 'Entries', 'data-arc-loop="items"', 'In the type\'s entry order, up to 100; data-limit="N" caps it'),
    bind('contentType', 'Type name'),
    bind('contentTypeSlug', 'Type slug'),
    bind('contentTypeDescription', 'Type description'),
    bind('lang', 'Page language'),
    bind('langPrefix', 'Language prefix', '{{ langPrefix }}', '"" or "/hi"'),
];

/** partials.html, outside the items loop. */
export const PARTIALS_FIELDS: TemplateAttr[] = [
    bind('items', 'Cards', 'data-arc-loop="items"', 'In the type\'s entry order; count from the count attribute'),
    bind('sectionTitle', 'Section title', '{{ sectionTitle }}', 'section-title attribute, else "Latest {type}"'),
    bind('listUrl', 'List page link', '<a data-arc-if="listUrl" href="{{ listUrl }}">', 'Empty for a type without public pages'),
    bind('hasItems', 'Has entries', 'data-arc-if="hasItems"'),
    bind('contentType', 'Type name'),
    bind('contentTypeSlug', 'Type slug'),
    bind('contentTypeDescription', 'Type description'),
    bind('lang', 'Page language'),
    bind('langPrefix', 'Language prefix', '{{ langPrefix }}', '"" or "/hi"'),
];

/** Each row of the items loop, in lists and partials alike. */
export const ITEM_FIELDS: TemplateAttr[] = [
    bind('title', 'Title'),
    bind('url', 'Link', '<a data-arc-if="url" href="{{ url }}">', 'In the page\'s language; empty for a type without public pages'),
    bind('coverImage', 'Cover image', '<img data-arc-bind="coverImage" alt="">', 'Sizes: coverImage_s, _m, _l, _xl'),
    bind('excerpt', 'Excerpt', '{{ excerpt }}', 'Meta description or body, first 25 words'),
    bind('publishedOn', 'Published date', '{{ publishedOn }}', 'Short date'),
    bind('readTime', 'Minutes to read'),
    bind('authorName', 'Byline'),
    bind('tagsHtml', 'Tag pills (HTML)', 'data-arc-bind="tagsHtml"', 'First three tags; a loop cannot run inside a row'),
    bind('tagsDisplay', 'Tag names', '{{ tagsDisplay }}', 'First three, comma separated'),
    bind('contentType', 'Type name'),
    bind('contentTypeSlug', 'Type slug'),
    bind('urlSlug', 'URL slug'),
    bind('id', 'Document id'),
    bind('content', 'Body (HTML)', 'data-arc-bind="content"'),
];

export const DIRECTIVES: TemplateAttr[] = [
    bind('{{ }}', 'Insert as text', '{{ key }}', 'In text or any attribute; dots reach inside'),
    bind('data-arc-bind', 'Fill an element', 'data-arc-bind="key"', 'img src, a href, time datetime; HTML is kept'),
    bind('[innerHTML]', 'Set HTML', '[innerHTML]="key"', 'Top-level keys only'),
    bind('[attr]', 'Set an attribute', '[href]="key"', 'Any attribute'),
    bind('data-arc-if', 'Show when set', 'data-arc-if="key"', 'Removes the element when empty, 0 or false'),
    bind('data-arc-loop', 'Repeat', 'data-arc-loop="key"', 'Repeats the first child only'),
    bind('data-limit', 'Cap a loop', 'data-limit="6"', 'On the loop element'),
    bind('data-arc-style-background', 'Background color', 'data-arc-style-background="key"'),
    bind('data-arc-t', 'Translate fixed text', 'data-arc-t="read_more"', 'From strings/{lang}.json'),
    // The site's own details from Settings, About (SS3): in templates, the header, footer and static pages.
    bind('data-arc-site', 'Site detail', '<a data-arc-site="phone"></a>', 'name, description, email, phone, address or logo; links become mailto: and tel:'),
    bind('data-arc-site-if', 'Show when the site has it', 'data-arc-site-if="phone"', 'Also social'),
    bind('data-arc-site-loop', 'Social links', 'data-arc-site-loop="social"', 'Rows: {{ url }}, {{ label }}, {{ platform }}, {{ icon }}'),
];

/**
 * The name a template can use for a custom field: the key without the type's
 * slug (TemplateHydrationService.aliasCustomFields), or the full key when the
 * short one is a built-in the alias never replaces.
 */
export function templateKey(fieldKey: string, typeSlug: string): string {
    const prefix = [`${typeSlug}-`, `${typeSlug}_`].find((p) => typeSlug && fieldKey.startsWith(p) && fieldKey.length > p.length);
    if (!prefix) return fieldKey;
    const short = fieldKey.slice(prefix.length);
    const builtIn = new Set([...DETAIL_FIELDS, ...ITEM_FIELDS, ...DETAIL_LOOPS].map((r) => r.key.split('.')[0]));
    return builtIn.has(short) ? fieldKey : short;
}

/** Row bindings of the repeating field types (docs/features/templates.html, Custom field bindings). */
const LOOP_ROWS: Record<string, string> = {
    infocard: 'Rows: {{ headline }}, {{ info }}, {{ icon }} or {{ image }}',
    gallery: 'Rows: {{ image }} or {{ video_embed }}, {{ caption }}',
    labelvalue: 'Rows: {{ label }}, {{ value }}',
    maplocation: 'Rows: {{ label }}, {{ address }}, map_embed for an iframe',
    faq: 'Rows: {{ question }}, {{ answer }}; data-arc-bind="answer_html" for paragraphs and links',
};

/** How to bind one custom field, by its type. */
export function customFieldReference(field: TemplateRefField, typeSlug: string): TemplateAttr {
    const k = templateKey(field.key, typeSlug);
    const full = field.key;
    const detailOnly = 'Detail pages only';
    const row = (syntax: string, note: string): TemplateAttr => ({ key: full, label: field.label, syntax, note });

    if (field.useCollectionRef && ['dropdown', 'radio', 'checkbox'].includes(field.type)) {
        return field.type === 'checkbox'
            ? row(`{{ ${k} }}`, 'The chosen ids; the copied fields are a list {{ }} cannot print')
            : row(`{{ ref_${full}.title }}`, `${detailOnly}; also ref_${full}.urlSlug, .coverImage. {{ ${k} }} is the id`);
    }
    switch (field.type) {
        case 'richtext':
            return row(`data-arc-bind="${k}"`, 'HTML; {{ }} would print the tags');
        case 'image':
            return row(`<img data-arc-bind="${k}" alt="">`, `Sizes: ${k}_s, ${k}_m, ${k}_l, ${k}_xl`);
        case 'icon':
            return row(`<i class="{{ ${k} }}"></i>`, `Also ${k}_svg, ${k}_label`);
        case 'color':
            return row(`style="color: {{ ${k} }}"`, `Also ${k}_rgb, ${k}_rgb_values`);
        case 'boolean':
            return row(`data-arc-if="${k}"`, 'Shows the element when on');
        case 'date':
        case 'datetime':
            return row(`<time data-arc-bind="${k}"></time>`, 'Date in the page\'s language; {{ }} prints the stored value');
        case 'checkbox':
            return row(`{{ ${k} }}`, 'Ticked options joined with commas');
        case 'labelvalue':
        case 'maplocation':
        case 'faq':
            return row(`data-arc-loop="${k}"`, `${detailOnly}. Heading: {{ ${k}_heading }}. ${LOOP_ROWS[field.type]}`);
        case 'infocard':
        case 'gallery':
            return row(`data-arc-loop="${k}"`, `${detailOnly}. ${LOOP_ROWS[field.type]}`);
        default:
            return row(`{{ ${k} }}`, field.type);
    }
}

/** The Template Reference of one content type, section by section. */
export function templateReference(typeSlug: string, fields: TemplateRefField[] = []): TemplateRefSection[] {
    const sections: TemplateRefSection[] = [];
    if (fields.length) {
        sections.push({
            id: 'custom', title: 'This type\'s fields', icon: 'fas fa-database',
            hint: 'On detail pages and in each item of a list or card block, unless noted',
            rows: fields.map((f) => customFieldReference(f, typeSlug)),
        });
    }
    sections.push(
        { id: 'detail', title: 'Detail page', icon: 'fas fa-file-lines', hint: 'detail.html, outside loops. Every other saved field is there too.', rows: DETAIL_FIELDS },
        { id: 'detail-loops', title: 'Detail page loops', icon: 'fas fa-repeat', rows: DETAIL_LOOPS },
        { id: 'list', title: 'List page', icon: 'fas fa-list', hint: 'list.html, outside the items loop', rows: LIST_FIELDS },
        { id: 'partials', title: 'Card block', icon: 'fas fa-table-cells-large', hint: 'partials.html, outside the items loop', rows: PARTIALS_FIELDS },
        { id: 'items', title: 'Each item', icon: 'fas fa-clone', hint: 'Inside data-arc-loop="items", in lists and card blocks', rows: ITEM_FIELDS },
        { id: 'directives', title: 'Attributes', icon: 'fas fa-code', rows: DIRECTIVES },
    );
    return sections;
}
