/**
 * Turns documents into index entries and writes them.
 *
 * Three callers: the wildcard trigger (onAnyDocumentWritten.ts), code that
 * writes data itself and wants the index updated in step (the publish
 * pipeline), and the reindex callable. All three end up here, so an entry is
 * built one way only.
 *
 * Spec: docs/search-spec.md, decision S-D12 and phase S1.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { tokenize, MAX_TOKENS_PER_ENTRY } from './tokenizer.js';
import {
    ANY_LANGUAGE,
    SEARCH_INDEX_COLLECTION,
    fieldText,
    readPath,
    searchEntryId,
    type SearchContext,
    type SearchDocument,
    type SearchFieldSpec,
    type SearchIndexEntry,
    type SearchSource,
    type SearchVariant,
} from './source.js';

/** Characters of each field kept on the entry for ranking and highlighting. */
const FIELD_TEXT_LIMIT = 500;

/** Snippets are shown in a dropdown; anything longer is noise there. */
const SNIPPET_LIMIT = 200;

/** Plain text of a value that may carry HTML. */
export function plainText(value: unknown): string {
    return fieldText(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/** Trims to a limit on a word boundary. */
export function clip(text: string, limit: number): string {
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit);
    const space = cut.lastIndexOf(' ');
    return (space > limit / 2 ? cut.slice(0, space) : cut).trim();
}

/**
 * Anything date-like as a Timestamp. Duck-typed rather than `instanceof`,
 * because a Timestamp read back from Firestore, one built by the client SDK
 * and a plain `{ seconds, nanoseconds }` from a test all mean the same thing.
 */
function toTimestamp(value: unknown): Timestamp {
    if (value instanceof Date) return Timestamp.fromDate(value);
    if (value && typeof value === 'object') {
        const raw = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
        if (typeof raw.toDate === 'function') return Timestamp.fromDate(raw.toDate());
        const seconds = typeof raw.seconds === 'number' ? raw.seconds : raw._seconds;
        if (typeof seconds === 'number') return Timestamp.fromDate(new Date(seconds * 1000));
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
    }
    return Timestamp.now();
}

function resolveFields(source: SearchSource, doc: SearchDocument, ctx: SearchContext): SearchFieldSpec[] {
    return typeof source.fields === 'function' ? source.fields(doc, ctx) : source.fields;
}

async function resolveVariants(
    source: SearchSource,
    doc: SearchDocument,
    ctx: SearchContext,
): Promise<SearchVariant[]> {
    if (source.variants) return source.variants(doc, ctx);
    const lang = source.lang ? source.lang(doc, ctx) : ANY_LANGUAGE;
    return [{ lang: lang || ANY_LANGUAGE, doc }];
}

/**
 * The index entry for one language variant.
 *
 * Tokens are gathered field by field in the order the source lists them, so
 * when the cap bites it trims the last field, never the title.
 */
export function buildEntry(
    source: SearchSource,
    variant: SearchVariant,
    specs: SearchFieldSpec[],
    ctx: SearchContext,
): SearchIndexEntry {
    const tokens: string[] = [];
    const seen = new Set<string>();
    const fields: Record<string, string> = {};
    const weights: Record<string, number> = {};

    for (const spec of specs) {
        const text = plainText(readPath(variant.doc, spec.path));
        if (!text) continue;
        fields[spec.path] = clip(text, FIELD_TEXT_LIMIT);
        weights[spec.path] = spec.weight;
        for (const token of tokenize(text, { prefix: spec.prefix })) {
            if (tokens.length >= MAX_TOKENS_PER_ENTRY) break;
            if (seen.has(token)) continue;
            seen.add(token);
            tokens.push(token);
        }
    }

    const display = source.display(variant.doc, ctx, variant.lang);
    return {
        source: source.id,
        scope: source.scope,
        lang: variant.lang,
        collection: ctx.collection,
        docId: ctx.docId,
        tokens,
        fields,
        weights,
        boost: source.boost ?? 1,
        title: plainText(display.title),
        snippet: clip(plainText(display.snippet ?? ''), SNIPPET_LIMIT),
        badge: plainText(display.badge ?? ''),
        link: display.link,
        meta: display.meta ?? {},
        sortAt: toTimestamp(display.sortAt),
        indexedAt: Timestamp.now(),
    };
}

/**
 * Every entry a document produces: none when the source excludes it, one
 * per language otherwise.
 */
export async function buildEntries(
    source: SearchSource,
    doc: SearchDocument,
    ctx: SearchContext,
): Promise<SearchIndexEntry[]> {
    if (source.include && !(await source.include(doc, ctx))) return [];
    const specs = resolveFields(source, doc, ctx);
    const variants = await resolveVariants(source, doc, ctx);
    return variants
        .map(variant => buildEntry(source, variant, specs, ctx))
        .filter(entry => entry.tokens.length > 0 && entry.title);
}

/**
 * Writes a document's entries and deletes the ones it no longer produces,
 * so a cleared translation drops out of the index rather than lingering.
 */
export async function upsertSearchEntries(
    sourceId: string,
    collection: string,
    docId: string,
    entries: SearchIndexEntry[],
): Promise<void> {
    const existing = await db.collection(SEARCH_INDEX_COLLECTION)
        .where('source', '==', sourceId)
        .where('collection', '==', collection)
        .where('docId', '==', docId)
        .get();

    const wanted = new Set(entries.map(entry => searchEntryId(sourceId, collection, docId, entry.lang)));
    const batch = db.batch();
    let writes = 0;

    for (const entry of entries) {
        batch.set(db.collection(SEARCH_INDEX_COLLECTION).doc(searchEntryId(sourceId, collection, docId, entry.lang)), entry);
        writes++;
    }
    for (const doc of existing.docs) {
        if (!wanted.has(doc.id)) {
            batch.delete(doc.ref);
            writes++;
        }
    }
    if (writes > 0) await batch.commit();
}

/** Removes every language entry of a document from one source. */
export async function removeSearchEntries(sourceId: string, collection: string, docId: string): Promise<number> {
    const existing = await db.collection(SEARCH_INDEX_COLLECTION)
        .where('source', '==', sourceId)
        .where('collection', '==', collection)
        .where('docId', '==', docId)
        .get();
    if (existing.empty) return 0;
    const batch = db.batch();
    existing.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return existing.size;
}

/** Builds and writes one document's entries for one source. */
export async function indexDocument(
    source: SearchSource,
    doc: SearchDocument | null | undefined,
    ctx: SearchContext,
): Promise<number> {
    if (!doc) {
        await removeSearchEntries(source.id, ctx.collection, ctx.docId);
        return 0;
    }
    const entries = await buildEntries(source, doc, ctx);
    await upsertSearchEntries(source.id, ctx.collection, ctx.docId, entries);
    return entries.length;
}
