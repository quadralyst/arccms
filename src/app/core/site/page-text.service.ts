import { Injectable, Injector, inject, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, deleteField, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { PublishQueueService } from '../../pages/admin/contents/publish-queue/publish-queue.service';
import { pageChanges, type Change } from '../editing/compare';
import { HeldError, heldByOther, type EditingHold } from '../editing/hold';
import { HoldService } from '../editing/hold.service';
import { PAGE_TEXT_ID, PAGE_TEXT_KEY, type PageTextValues } from '../utils/page-text-model';

/**
 * Page text in the app (specs/visual-editing-spec.md, VE-D39, VE-D52, VE-D57):
 * what editors changed on the home page and the static pages.
 *
 * - `published(pageId)`: what is published, for the pages the app draws itself
 *   (the home page and `/p/{name}` opened through the router), which fill it as
 *   publishing does (VE-D40). Anyone may read it.
 * - `session(pageId)`: the editors' draft, live, saved a field at a time.
 */
export const PAGE_TEXT_DRAFTS = 'SitePageTextDrafts';
export const PAGE_TEXT_PUBLISHED = 'SitePageText';

/**
 * A published copy: each value's words or address alone (who saved it stays in
 * the draft and in History, which only staff read), and the draft it was made from.
 */
export interface PublishedPageText extends PageTextValues {
    publishedAt?: { toMillis?: () => number } | null;
    draftUpdatedAt?: { toMillis?: () => number } | null;
}

/** One publish of a page, as History keeps it: the whole draft, and who published it. */
export interface PageTextVersion extends PageTextValues {
    id: string;
    publishedAt?: { toMillis?: () => number } | null;
    publishedBy?: string;
}

/** A draft: the values, and who changed it last. */
export interface PageTextDraft extends PageTextValues {
    updatedAt?: { toMillis?: () => number } | null;
    updatedBy?: string;
    /** Who holds the page's words (VE-D76); counts only while they are not published. */
    editing?: unknown;
}

/** What a saved value remembers besides itself (VE-D44, VE-D45). */
export interface PageTextSaveContext {
    /** The file's text of the area when saved. */
    fileText?: string;
    /** The default language's text a translation was made from. */
    sourceText?: string;
}

const millis = (time: { toMillis?: () => number } | null | undefined): number => time?.toMillis?.() ?? 0;

/** Whether a draft was saved after the draft the published copy was made from. */
export function savedSincePublished(draft: PageTextDraft | null, published: PublishedPageText | null): boolean {
    if (!draft) return false;
    if (!published) return true;
    return millis(draft.updatedAt) > millis(published.draftUpdatedAt);
}

/**
 * Whether a draft has changes not published (VE-D48): saved since, and its words
 * differ (VE6.B1). A published copy that names no draft did not go live, so its
 * page waits whatever the words are.
 */
export function hasUnpublishedChanges(draft: PageTextDraft | null, published: PublishedPageText | null): boolean {
    if (!savedSincePublished(draft, published)) return false;
    if (published && !published.draftUpdatedAt) return true;
    return pageChanges(draft, published).length > 0;
}

/** Someone else holds a page's words: they saved changes that are not published (VE-D77). */
export function pageHeldByOther(draft: PageTextDraft | null, published: PublishedPageText | null, uid: string | null | undefined): EditingHold | null {
    return savedSincePublished(draft, published) ? heldByOther(draft, uid) : null;
}

@Injectable({ providedIn: 'root' })
export class PageTextService {
    private injector = inject(Injector);

    /** What is published for a page, or null when nothing is or it cannot be read (the page is then its file). */
    async published(pageId: string): Promise<PublishedPageText | null> {
        if (!PAGE_TEXT_ID.test(pageId)) return null;
        try {
            const firestore = this.injector.get(Firestore);
            const snap = await runInInjectionContext(this.injector, () => getDoc(doc(firestore, PAGE_TEXT_PUBLISHED, pageId)));
            return snap.exists() ? (snap.data() as PublishedPageText) : null;
        } catch (error) {
            console.error(`[PageText] Could not read the published text of ${pageId}:`, error);
            return null;
        }
    }

    /**
     * Follows what is published for a page: null when nothing is or it cannot be
     * read. Returns the function that stops following.
     */
    followPublished(pageId: string, next: (published: PublishedPageText | null) => void): () => void {
        if (!PAGE_TEXT_ID.test(pageId)) {
            next(null);
            return () => undefined;
        }
        const firestore = this.injector.get(Firestore);
        return runInInjectionContext(this.injector, () => onSnapshot(
            doc(firestore, PAGE_TEXT_PUBLISHED, pageId),
            (snap) => next(snap.exists() ? (snap.data() as PublishedPageText) : null),
            (error) => {
                console.error(`[PageText] Could not follow the published text of ${pageId}:`, error);
                next(null);
            },
        ));
    }

    /** A page's draft as it is now, or null when there is none (the More Pages list, VE-D48). */
    async draft(pageId: string): Promise<PageTextDraft | null> {
        if (!PAGE_TEXT_ID.test(pageId)) return null;
        const firestore = this.injector.get(Firestore);
        const snap = await runInInjectionContext(this.injector, () => getDoc(doc(firestore, PAGE_TEXT_DRAFTS, pageId)));
        return snap.exists() ? (snap.data() as PageTextDraft) : null;
    }

    /** Every publish of a page, newest first (VE-D51), for Restore. */
    async history(pageId: string, count = 30): Promise<PageTextVersion[]> {
        if (!PAGE_TEXT_ID.test(pageId)) return [];
        const firestore = this.injector.get(Firestore);
        const snap = await runInInjectionContext(this.injector, () => getDocs(query(
            collection(firestore, PAGE_TEXT_PUBLISHED, pageId, 'History'), orderBy('publishedAt', 'desc'), limit(count),
        )));
        return snap.docs.map((version) => ({ id: version.id, ...(version.data() as Omit<PageTextVersion, 'id'>) }));
    }

    /** An editing session on a page's draft. Close it when the editor closes. */
    session(pageId: string): PageTextSession {
        if (!PAGE_TEXT_ID.test(pageId)) throw new Error(`Not a page: ${pageId}`);
        return new PageTextSession(pageId, this.injector);
    }
}

/**
 * The editors' draft of one page: every field saves on its own, as a field-path
 * update. One person holds the page's words at a time (VE-D76): a save by anyone
 * else is refused, here and by the rules. Their saves arrive live in `draft`.
 */
export class PageTextSession {
    /** The draft as last read, live; null before the first read or when there is none. */
    readonly draft = signal<PageTextDraft | null>(null);
    /** Whether the first read came back. */
    readonly loaded = signal(false);
    /** Why the draft could not be read, if it could not. */
    readonly error = signal<string | null>(null);

    /** What is published, as the editor follows it (undefined until it is read); tells whose hold counts and when to let go. */
    published: () => PublishedPageText | null | undefined = () => null;

    private unsubscribe: (() => void) | null = null;

    constructor(readonly pageId: string, private injector: Injector) {}

    private run<T>(fn: () => T): T {
        return runInInjectionContext(this.injector, fn);
    }

    private get ref() {
        return this.run(() => doc(this.injector.get(Firestore), PAGE_TEXT_DRAFTS, this.pageId));
    }

    private uid(): string {
        const uid = this.injector.get(Auth).currentUser?.uid;
        if (!uid) throw new Error('Sign in to change the page.');
        return uid;
    }

    /** Starts following the draft. */
    open(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = this.run(() => onSnapshot(
            this.ref,
            (snap) => {
                this.draft.set(snap.exists() ? (snap.data() as PageTextDraft) : null);
                this.error.set(null);
                this.loaded.set(true);
            },
            (error) => {
                console.error(`[PageText] Could not read the draft of ${this.pageId}:`, error);
                this.error.set(error?.message || String(error));
                this.loaded.set(true);
            },
        ));
    }

    /** Stops following the draft. */
    close(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private get holds(): HoldService {
        return this.injector.get(HoldService);
    }

    /** The draft's path, as a hold names it. */
    get path(): string {
        return `${PAGE_TEXT_DRAFTS}/${this.pageId}`;
    }

    /** Who else holds the page, or null. */
    heldBy(): EditingHold | null {
        const published = this.published();
        // Not read yet: a hold from before a publish must not stop a save; the rules decide, and throwIfHeld says who.
        if (published === undefined) return null;
        return pageHeldByOther(this.draft(), published, this.injector.get(Auth).currentUser?.uid);
    }

    /** What every save stamps: when, by whom, and the hold. Refused while someone else holds the page. */
    private stamp(): Record<string, unknown> {
        const hold = this.heldBy();
        if (hold) throw new HeldError(hold);
        const uid = this.uid();
        const me = this.holds.me() ?? { uid, name: '' };
        // A hold left from before a publish is over: this one starts now.
        const published = this.published();
        const before = published !== undefined && savedSincePublished(this.draft(), published) ? this.draft() : null;
        return { updatedAt: serverTimestamp(), updatedBy: uid, ...this.holds.stamp(me, before as Record<string, any> | null, false) };
    }

    /** A save refused: someone else took the page a moment ago, before this screen heard. */
    private async throwIfHeld(): Promise<void> {
        const service = this.injector.get(PageTextService);
        const [stored, published] = await Promise.all([service.draft(this.pageId).catch(() => null), service.published(this.pageId)]);
        const hold = pageHeldByOther(stored, published, this.injector.get(Auth).currentUser?.uid);
        if (hold) throw new HeldError(hold);
    }

    /** Everything is as it is live again: the page is let go (VE-D76). */
    private async letGo(): Promise<void> {
        const draft = this.draft();
        const published = this.published();
        if (!draft?.editing || published === undefined) return;
        // A published copy that names no draft did not go live: its words still wait. A page never published has its file's.
        if ((published && !published.draftUpdatedAt) || pageChanges(draft, published).length) return;
        const uid = this.uid();
        await this.run(() => updateDoc(this.ref, { editing: deleteField(), updatedAt: serverTimestamp(), updatedBy: uid }));
    }

    /** One value, with what it was saved against and who saved it. */
    private entry(value: string, context: PageTextSaveContext): Record<string, unknown> {
        const entry: Record<string, unknown> = { value, by: this.uid(), at: serverTimestamp() };
        if (context.fileText !== undefined) entry['fileText'] = context.fileText;
        if (context.sourceText !== undefined) entry['sourceText'] = context.sourceText;
        return entry;
    }

    /**
     * Writes one field (a path below the draft) and the draft's own stamp, as a
     * field-path update, so a save touches nothing else. The page's first save
     * creates the draft; a removal from a page with no draft has nothing to do.
     */
    private async write(path: string[], value: unknown, removal = false): Promise<void> {
        for (const part of path) if (!/^[A-Za-z0-9_-]{1,100}$/.test(part)) throw new Error(`Not a field: ${path.join('.')}`);
        const stamp = this.stamp();
        try {
            await this.run(() => updateDoc(this.ref, { [path.join('.')]: value, ...stamp }));
            await this.letGo();
        } catch (error: any) {
            if (error?.code === 'permission-denied') await this.throwIfHeld();
            if (error?.code !== 'not-found') throw error;
            if (removal) return;
            const nested = path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
            await this.run(() => setDoc(this.ref, { ...nested, ...stamp }, { merge: true }));
        }
    }

    /** Words of one area in one language: text, rich text, alt text, link text, a section title. */
    async saveText(lang: string, key: string, value: string, context: PageTextSaveContext = {}): Promise<void> {
        this.checkKey(key);
        return this.write(['text', lang, key], this.entry(value, context));
    }

    /** An area's address, the same in every language: a picture, a link, a background. */
    async saveUrl(key: string, value: string, context: PageTextSaveContext = {}): Promise<void> {
        this.checkKey(key);
        return this.write(['urls', key], this.entry(value, context));
    }

    /** The page's title or description in one language (the SEO tab). */
    async saveSeo(lang: string, field: 'title' | 'description', value: string, context: PageTextSaveContext = {}): Promise<void> {
        return this.write(['seo', lang, field], this.entry(value, context));
    }

    /** The picture shown when the page is shared. */
    async saveShareImage(value: string): Promise<void> {
        return this.write(['shareImage'], this.entry(value, {}));
    }

    /** Use the file's text (VE-D46): the saved words of one area in one language are removed. */
    async useFileText(lang: string, key: string): Promise<void> {
        this.checkKey(key);
        return this.write(['text', lang, key], deleteField(), true);
    }

    /** Use the file's address: the saved address of one area is removed. */
    async useFileUrl(key: string): Promise<void> {
        this.checkKey(key);
        return this.write(['urls', key], deleteField(), true);
    }

    /** The file's own title or description again. */
    async useFileSeo(lang: string, field: 'title' | 'description'): Promise<void> {
        return this.write(['seo', lang, field], deleteField(), true);
    }

    /** The file's own share picture again. */
    async useFileShareImage(): Promise<void> {
        return this.write(['shareImage'], deleteField(), true);
    }

    /**
     * A key the file no longer has (VE-D47): its words in every language and its
     * address are removed, in one write.
     */
    async removeKey(key: string): Promise<void> {
        this.checkKey(key);
        const draft = this.draft();
        if (!draft) return;
        const paths: Record<string, unknown> = {};
        for (const [lang, values] of Object.entries(draft.text || {})) {
            if (values && key in values) paths[`text.${lang}.${key}`] = deleteField();
        }
        if (draft.urls && key in draft.urls) paths[`urls.${key}`] = deleteField();
        if (!Object.keys(paths).length) return;
        const stamp = this.stamp();
        await this.run(() => updateDoc(this.ref, { ...paths, ...stamp }));
        await this.letGo();
    }

    /** Restore (VE-D51): a published version becomes the draft, which then needs Publish. */
    async restore(version: PageTextValues): Promise<void> {
        const stamp = this.stamp();
        const values: Record<string, unknown> = {};
        for (const field of ['text', 'urls', 'seo', 'shareImage'] as const) if (version[field]) values[field] = version[field];
        await this.run(() => setDoc(this.ref, { ...values, ...stamp }));
        await this.letGo();
    }

    /** What differs from what is live (VE-D80). */
    changes(): Change[] {
        return pageChanges(this.draft(), this.published() ?? null);
    }

    /**
     * The live values whole, with what each was saved against: the newest version in
     * History, since the published copy holds bare values. The bare ones when the
     * newest version is not what is live.
     */
    private async liveValues(): Promise<PageTextValues> {
        const published = this.published();
        const [newest] = await this.injector.get(PageTextService).history(this.pageId, 1).catch(() => [] as PageTextVersion[]);
        if (newest && !pageChanges(newest, published).length) return newest;
        return published ?? {};
    }

    /** Puts one change back to what is live (VE-D83). */
    async putBack(change: Change): Promise<void> {
        const live = await this.liveValues();
        const [kind, key] = change.field.split(/:(.*)/s);
        const write = (path: string[], value: unknown) => this.write(path, value ?? deleteField(), value === undefined);
        if (kind === 'text') return write(['text', change.lang, key], live.text?.[change.lang]?.[key]);
        if (kind === 'url') return write(['urls', key], live.urls?.[key]);
        if (kind === 'seo') return write(['seo', change.lang, key], live.seo?.[change.lang]?.[key as 'title' | 'description']);
        return write(['shareImage'], live.shareImage);
    }

    /** Discard changes (VE-D83): the draft is kept, then goes back to what is live. */
    async discard(): Promise<void> {
        const live = await this.liveValues();
        await this.holds.keep(this.path, 'discard');
        await this.restore(live);
    }

    /** Restores a kept draft (VE-D84); what is there now is kept first. */
    async restoreKept(values: PageTextValues): Promise<void> {
        await this.holds.keep(this.path, 'discard');
        await this.restore(values);
    }

    /** Take over (VE-D81) from the person shown. */
    takeOver(from: string): Promise<boolean> {
        return this.holds.takeOver(this.path, from);
    }

    /** Publishes the draft through the publish queue (VE-D57). */
    async publish(): Promise<void> {
        return this.injector.get(PublishQueueService).publishPageText(this.pageId);
    }

    private checkKey(key: string): void {
        if (!PAGE_TEXT_KEY.test(key)) throw new Error(`Not an area key: ${key}`);
    }
}

