import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { PAGE_TEXT_ID, type PageTextValues } from '../shared/page-text.js';

/**
 * Where page text lives (specs/visual-editing-spec.md, VE-D39): the editors'
 * draft in SitePageTextDrafts/{pageId}, what is published in
 * SitePageText/{pageId}, every publish in SitePageText/{pageId}/History. Only
 * this file writes the published copy and its history (the rules let nobody
 * else).
 */
export const PAGE_TEXT_DRAFTS = 'SitePageTextDrafts';
export const PAGE_TEXT_PUBLISHED = 'SitePageText';
export const PAGE_TEXT_HISTORY = 'History';

/** The fields of a draft that are the page's values, and nothing else. */
export function pageTextValuesOf(data: Record<string, unknown> | undefined | null): PageTextValues {
    const values: PageTextValues = {};
    if (!data) return values;
    const map = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : undefined);
    if (map(data['text'])) values.text = data['text'] as PageTextValues['text'];
    if (map(data['urls'])) values.urls = data['urls'] as PageTextValues['urls'];
    if (map(data['seo'])) values.seo = data['seo'] as PageTextValues['seo'];
    if (map(data['shareImage'])) values.shareImage = data['shareImage'] as PageTextValues['shareImage'];
    return values;
}

/**
 * A page's published values, or null when it has none. A read that fails
 * throws: the page is then not built, and the live one keeps the editors'
 * words, rather than going out without them.
 */
export async function loadPublishedPageText(pageId: string): Promise<PageTextValues | null> {
    const snap = await db.collection(PAGE_TEXT_PUBLISHED).doc(pageId).get();
    return snap.exists ? pageTextValuesOf(snap.data()) : null;
}

/**
 * The values as the public may read them: each one's `value` only. Who saved it,
 * when, and the texts it was saved against stay in the draft and in History,
 * which only staff read.
 */
export function publicPageTextValues(values: PageTextValues): PageTextValues {
    const bare = (entry: { value?: unknown } | undefined) =>
        entry && typeof entry.value === 'string' ? { value: entry.value } : undefined;
    const each = <T>(map: Record<string, T> | undefined, fn: (item: T) => unknown) => {
        const out: Record<string, any> = {};
        for (const [key, item] of Object.entries(map || {})) {
            const kept = fn(item);
            if (kept !== undefined) out[key] = kept;
        }
        return out;
    };
    const out: PageTextValues = {};
    if (values.text) out.text = each(values.text, (byKey) => each(byKey, bare));
    if (values.urls) out.urls = each(values.urls, bare);
    if (values.seo) out.seo = each(values.seo, (seo) => each(seo as Record<string, { value?: unknown }>, bare));
    const share = bare(values.shareImage);
    if (share) out.shareImage = share;
    return out;
}

/**
 * A mark of a page's published values that changes with every publish, '' when it
 * has none. Read before and after a page is built and released, it tells whether
 * words were published meanwhile (processPublishQueue).
 */
export async function publishedPageTextStamp(pageId: string): Promise<string> {
    const snap = await db.collection(PAGE_TEXT_PUBLISHED).doc(pageId).get();
    const time = snap.exists ? snap.updateTime : undefined;
    return time ? `${time.seconds}.${time.nanoseconds}` : '';
}

/** What a page id names: the home page, the static page `/p/{name}`, or a type's list page `/{slug}`. */
export function pageOfPageTextId(pageId: string): { kind: 'home' } | { kind: 'static'; name: string } | { kind: 'list'; slug: string } | null {
    if (!PAGE_TEXT_ID.test(pageId)) return null;
    if (pageId === 'home') return { kind: 'home' };
    if (pageId.startsWith('list-')) return { kind: 'list', slug: pageId.slice('list-'.length) };
    return { kind: 'static', name: pageId.slice('p-'.length) };
}

/**
 * The published copy's page did not go live (its rebuild or release failed): it
 * no longer says which draft it was made from, so the admin shows "Changes not
 * published" and Publish can be pressed again, instead of a page shown as published
 * while the site keeps the old words.
 */
export async function markPageTextUnreleased(pageId: string): Promise<void> {
    try {
        await db.collection(PAGE_TEXT_PUBLISHED).doc(pageId).update({ draftUpdatedAt: null });
    } catch (error) {
        // A page whose words were never published: nothing to mark.
        if ((error as { code?: unknown })?.code === 5 || (error as { code?: unknown })?.code === 'not-found') return;
        throw error;
    }
}

/**
 * Publishes a page's draft (VE-D57): copies its values into SitePageText (the
 * whole document, so a value the draft no longer has is gone) and keeps the
 * whole draft in History. A page with no draft publishes no values, which brings it
 * back to its file. The caller rebuilds the page.
 *
 * The same write lets go of the page (VE-D76): its `editing` goes, and not its
 * `updatedAt`, so nothing reads as saved. One transaction, so words saved meanwhile are
 * either in what is published or still held. A page whose release then fails is held
 * by nobody, with its changes waiting.
 *
 * `historyId`: the queue item's id, so the same item delivered twice keeps one History entry.
 */
export async function publishPageTextDraft(pageId: string, historyId?: string): Promise<void> {
    const draftRef = db.collection(PAGE_TEXT_DRAFTS).doc(pageId);
    const ref = db.collection(PAGE_TEXT_PUBLISHED).doc(pageId);
    const historyRef = historyId ? ref.collection(PAGE_TEXT_HISTORY).doc(historyId) : ref.collection(PAGE_TEXT_HISTORY).doc();
    await db.runTransaction(async (tx) => {
        const draft = await tx.get(draftRef);
        const data = draft.exists ? draft.data() : undefined;
        const values = pageTextValuesOf(data);
        const stamp = {
            publishedAt: FieldValue.serverTimestamp(),
            // The draft this copy was made from, so the admin can tell a draft changed since (VE-D48).
            draftUpdatedAt: data?.['updatedAt'] ?? null,
        };
        // Anyone reads the published copy: the values alone, no account ids.
        tx.set(ref, { ...publicPageTextValues(values), ...stamp });
        // History is for Restore (VE-D51): the whole draft, with who saved what and against which text.
        tx.set(historyRef, { ...values, ...stamp, publishedBy: typeof data?.['updatedBy'] === 'string' ? data['updatedBy'] : '' });
        if (data && 'editing' in data) tx.update(draftRef, { editing: FieldValue.delete() });
    });
}
