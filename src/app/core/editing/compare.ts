import { momentMillis } from './hold';

/**
 * What differs between a draft and what is live (specs/visual-editing-spec.md,
 * VE-D80, VE6.B1): one list of changes, for an entry and for a page's text. An
 * empty list is "nothing to publish", whatever the saved form or the dates say.
 * Pure, so the rules are tested on their own.
 */
export type ChangeKind = 'text' | 'rich' | 'picture' | 'list' | 'rows' | 'value' | 'link';

export interface Change {
    /** Stable across reads: what it is, in which language. */
    id: string;
    /** The field or area it changes: `title`, `content`, `cf:price`, `text:hero`, `url:hero`, `seo:title`. */
    field: string;
    /** The language, or '' for what is the same in every language. */
    lang: string;
    kind: ChangeKind;
    before: string;
    after: string;
    /** For `rows`: how many were added, removed and changed. */
    rows?: { added: number; removed: number; changed: number };
    /** The words are the same: formatting, a link or a picture inside them changed. */
    sameWords?: true;
}

/** An entry's own fields that a person edits, in the order the panel shows them. */
const ENTRY_FIELDS: readonly { key: string; kind: ChangeKind; perLanguage?: boolean }[] = [
    { key: 'title', kind: 'text', perLanguage: true },
    { key: 'content', kind: 'rich', perLanguage: true },
    { key: 'coverImage', kind: 'picture' },
    { key: 'summary', kind: 'text', perLanguage: true },
    { key: 'urlSlug', kind: 'text' },
    { key: 'authorId', kind: 'value' },
    { key: 'layout', kind: 'value' },
    { key: 'tags', kind: 'list' },
    { key: 'seoTitle', kind: 'text', perLanguage: true },
    { key: 'metaDescription', kind: 'text', perLanguage: true },
    { key: 'canonicalUrl', kind: 'text' },
    { key: 'updatedOn', kind: 'value' },
    { key: 'references', kind: 'list' },
    // By the entry linked to: its copied title and summary are kept in step by the CMS.
    { key: 'previousContent', kind: 'link' },
    { key: 'nextContent', kind: 'link' },
];

/** One stable text for any stored value: key order, empty values and time types make no difference. */
export function stableText(value: unknown): string {
    const norm = (v: unknown): unknown => {
        if (v === null || v === undefined || v === '') return null;
        const time = typeof v === 'object' ? momentMillis(v) : null;
        if (time !== null) return { time };
        if (Array.isArray(v)) return v.length ? v.map(norm) : null;
        if (typeof v === 'object') {
            const entries = Object.entries(v as Record<string, unknown>)
                .map(([k, x]) => [k, norm(x)] as const)
                .filter(([, x]) => x !== null)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            return entries.length ? Object.fromEntries(entries) : null;
        }
        return v;
    };
    const out = norm(value);
    return out === null ? '' : typeof out === 'string' ? out : JSON.stringify(out);
}

/** Rich text with the spaces that make no difference on the page taken out, and an empty body as nothing. */
function richText(value: unknown): string {
    const html = typeof value === 'string' ? value : '';
    const tidy = html.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    return /^(<p>(<br\s*\/?>)?<\/p>)*$/i.test(tidy) ? '' : tidy;
}

/** A value as the review list shows it, its markup taken out. */
export function plainText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        return value
            .replace(/<\s*(br|\/p|\/h[1-6]|\/li|\/div|\/blockquote)\b[^>]*>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
            .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    }
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    const time = momentMillis(value);
    if (time !== null) {
        // The day as the person chose it, not the day it is in London.
        const at = new Date(time);
        return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    }
    if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join('\n');
    const object = value as Record<string, unknown>;
    const known = object['label'] ?? object['title'] ?? object['name'] ?? object['url'] ?? object['address'];
    if (known !== undefined) return plainText(known);
    return Object.entries(object).filter(([key]) => key !== 'id' && key !== 'position' && key !== 'order')
        .map(([, v]) => plainText(v)).filter(Boolean).join(', ');
}

const isRowList = (value: unknown): value is Record<string, unknown>[] =>
    Array.isArray(value) && value.some((row) => row && typeof row === 'object' && !Array.isArray(row) && 'id' in row);

/** Every field of each row, a line each, for the list of changes. */
function rowsText(value: unknown): string {
    if (!Array.isArray(value)) return '';
    return value.map((row) => (row && typeof row === 'object'
        ? Object.entries(row as Record<string, unknown>).filter(([key]) => !['id', 'position', 'order'].includes(key))
            .map(([, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v).map(plainText).filter(Boolean).join(', ') : plainText(v)))
            .filter(Boolean).join(' / ')
        : plainText(row))).filter(Boolean).join('\n');
}

function rowCounts(before: unknown, after: unknown): { added: number; removed: number; changed: number } {
    const map = (rows: unknown) => new Map((Array.isArray(rows) ? rows : []).map((row: any, i) => [String(row?.id ?? i), stableText(row)]));
    const was = map(before);
    const now = map(after);
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [id, text] of now) {
        if (!was.has(id)) added++;
        else if (was.get(id) !== text) changed++;
    }
    for (const id of was.keys()) if (!now.has(id)) removed++;
    return { added, removed, changed };
}

/** `shown`: what stands for each value in the list, when the value itself is an id. */
function fieldChange(
    field: string, lang: string, kind: ChangeKind, before: unknown, after: unknown, shown?: { before: unknown; after: unknown },
): Change | null {
    const linked = (value: unknown) => String((value as { id?: unknown } | null)?.id ?? '');
    const same = kind === 'rich' ? richText(before) === richText(after)
        : kind === 'link' ? linked(before) === linked(after)
            : stableText(before) === stableText(after);
    if (same) return null;
    const rows = kind === 'rows' ? rowCounts(before, after) : undefined;
    const text = (value: unknown) => (kind === 'picture' ? (typeof value === 'string' ? value : '')
        : kind === 'rows' ? rowsText(value) : plainText(value));
    const was = text(shown?.before ?? before);
    const now = text(shown?.after ?? after);
    return {
        id: `${lang}|${field}`, field, lang, kind, before: was, after: now,
        ...(rows ? { rows } : {}), ...(was === now && (was || kind === 'rich') ? { sameWords: true as const } : {}),
    };
}

/** The kind of a custom field's value, from its type when known, else from what it holds. */
function customKind(type: string | undefined, before: unknown, after: unknown): ChangeKind {
    if (type === 'richtext') return 'rich';
    if (type === 'image') return 'picture';
    const value = after ?? before;
    if (isRowList(value)) return 'rows';
    if (Array.isArray(value)) return 'list';
    return typeof value === 'string' ? 'text' : 'value';
}

export interface EntryCompareInput {
    draft: Record<string, any> | null;
    published: Record<string, any> | null;
    /** The type's fields: their order and types. */
    fields?: readonly { key: string; type?: string }[];
    /** Each language's translation, the draft's and the published one. */
    translations?: Record<string, { draft: Record<string, any> | null; published: Record<string, any> | null }>;
}

/** What differs between an entry's draft and its published copy, in the panel's order, the languages after. */
export function entryChanges(input: EntryCompareInput): Change[] {
    const changes: Change[] = [];
    const typeOf = new Map((input.fields ?? []).map((f) => [f.key, f.type]));
    const order = new Map((input.fields ?? []).map((f, i) => [f.key, i]));
    const add = (change: Change | null) => {
        if (change) changes.push(change);
    };
    const customs = (lang: string, draft: Record<string, any>, published: Record<string, any>) => {
        // `_ref_…` are copies the CMS keeps in step by itself, not words anyone typed.
        const keys = [...new Set([...Object.keys(draft), ...Object.keys(published)])].filter((key) => !key.startsWith('_ref_'));
        keys.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || (a < b ? -1 : 1));
        for (const key of keys) {
            // A chosen entry is stored by its id; its copy beside it has its title.
            const ref = `_ref_${key}`;
            const shown = draft[ref] || published[ref] ? { before: published[ref], after: draft[ref] } : undefined;
            add(fieldChange(`cf:${key}`, lang, customKind(typeOf.get(key), published[key], draft[key]), published[key], draft[key], shown));
        }
    };
    const draft = input.draft ?? {};
    const published = input.published ?? {};
    for (const { key, kind } of ENTRY_FIELDS) {
        const shown = key === 'authorId' ? { before: published['authorName'], after: draft['authorName'] } : undefined;
        add(fieldChange(key, '', kind, published[key], draft[key], shown));
    }
    customs('', draft['customFields'] ?? {}, published['customFields'] ?? {});
    for (const lang of Object.keys(input.translations ?? {}).sort()) {
        const d = input.translations![lang].draft ?? {};
        const p = input.translations![lang].published ?? {};
        for (const { key, kind, perLanguage } of ENTRY_FIELDS) if (perLanguage) add(fieldChange(key, lang, kind, p[key], d[key]));
        customs(lang, d['customFields'] ?? {}, p['customFields'] ?? {});
    }
    return changes;
}

/** Page text as stored: each value an object with `value`. */
export interface PageValues {
    text?: Record<string, Record<string, { value?: unknown } | undefined> | undefined>;
    urls?: Record<string, { value?: unknown } | undefined>;
    seo?: Record<string, { title?: { value?: unknown }; description?: { value?: unknown } } | undefined>;
    shareImage?: { value?: unknown } | null;
}

/** What differs between a page's draft and its published copy. An area with no value shows its file's words ('' here). */
export function pageChanges(draft: PageValues | null | undefined, published: PageValues | null | undefined): Change[] {
    const changes: Change[] = [];
    const add = (change: Change | null) => {
        if (change) changes.push(change);
    };
    const valueOf = (entry: { value?: unknown } | null | undefined) => (typeof entry?.value === 'string' ? entry.value : '');
    const keys = (a: object | null | undefined, b: object | null | undefined) =>
        [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
    for (const lang of keys(draft?.text, published?.text)) {
        const d = draft?.text?.[lang];
        const p = published?.text?.[lang];
        for (const key of keys(d, p)) {
            const before = valueOf(p?.[key]);
            const after = valueOf(d?.[key]);
            add(fieldChange(`text:${key}`, lang, /<[a-z]/i.test(before + after) ? 'rich' : 'text', before, after));
        }
    }
    for (const key of keys(draft?.urls, published?.urls)) {
        const before = valueOf(published?.urls?.[key]);
        const after = valueOf(draft?.urls?.[key]);
        const picture = /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(after || before);
        add(fieldChange(`url:${key}`, '', picture ? 'picture' : 'text', before, after));
    }
    for (const lang of keys(draft?.seo, published?.seo)) {
        for (const field of ['title', 'description'] as const) {
            add(fieldChange(`seo:${field}`, lang, 'text', valueOf(published?.seo?.[lang]?.[field]), valueOf(draft?.seo?.[lang]?.[field])));
        }
    }
    add(fieldChange('shareImage', '', 'picture', valueOf(published?.shareImage), valueOf(draft?.shareImage)));
    return changes;
}

/** One piece of a comparison of words: the same in both, removed, or added. */
export interface WordPart {
    kind: 'same' | 'removed' | 'added';
    text: string;
}

/** Longer texts are compared by line, not by word, so the review list opens at once. */
const MAX_WORDS = 1200;

/** The words removed and added between two texts, in reading order. */
export function wordDiff(before: string, after: string): WordPart[] {
    if (before === after) return before ? [{ kind: 'same', text: before }] : [];
    const split = (text: string, by: RegExp) => text.match(by) ?? [];
    let a = split(before, /\s+|[^\s]+/g);
    let b = split(after, /\s+|[^\s]+/g);
    if (a.length * b.length > MAX_WORDS * MAX_WORDS) {
        a = split(before, /[^\n]*\n|[^\n]+$/g);
        b = split(after, /[^\n]*\n|[^\n]+$/g);
        if (a.length * b.length > MAX_WORDS * MAX_WORDS) {
            return [{ kind: 'removed' as const, text: before }, { kind: 'added' as const, text: after }].filter((p) => p.text);
        }
    }
    // The longest common run of pieces.
    const rows = a.length + 1;
    const cols = b.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
        }
    }
    const parts: WordPart[] = [];
    const push = (kind: WordPart['kind'], text: string) => {
        const last = parts[parts.length - 1];
        if (last?.kind === kind) last.text += text;
        else parts.push({ kind, text });
    };
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            push('same', a[i]);
            i++;
            j++;
        } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) push('removed', a[i++]);
        else push('added', b[j++]);
    }
    while (i < a.length) push('removed', a[i++]);
    while (j < b.length) push('added', b[j++]);
    return tidied(parts);
}

/** Words changed one after another read as one change: the spaces between them go with it. */
function tidied(parts: readonly WordPart[]): WordPart[] {
    const out: WordPart[] = [];
    let removed = '';
    let added = '';
    const flush = () => {
        if (removed) out.push({ kind: 'removed', text: removed });
        if (added) out.push({ kind: 'added', text: added });
        removed = '';
        added = '';
    };
    parts.forEach((part, at) => {
        const between = part.kind === 'same' && !part.text.trim() && (removed || added) && at < parts.length - 1;
        if (part.kind === 'same' && !between) {
            flush();
            out.push({ ...part });
            return;
        }
        if (part.kind !== 'added') removed += part.text;
        if (part.kind !== 'removed') added += part.text;
    });
    flush();
    return out;
}
