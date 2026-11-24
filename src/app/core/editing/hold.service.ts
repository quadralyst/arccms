import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
    Firestore, collection, deleteField, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, type DocumentReference, type Transaction,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { draftQueueEntry } from '../../../shared/services/search-queue';
import { isTranslationEmpty, type IContentTranslation } from '../../pages/admin/contents/draft-content-store/content-translation.model';
import { AuthState } from '../../pages/(auth)/auth.store';
import { entryChanges, type Change } from './compare';
import { HeldError, heldByOther, holdOf, type EditorPerson } from './hold';

/** A draft kept before a take over or a Discard (VE-D84). */
export interface KeptDraft {
    id: string;
    /** Whose work it was. */
    name: string;
    by: string;
    /** What made it: someone took over, or the changes were discarded. */
    why: 'takeover' | 'discard';
    keptAt?: unknown;
    data: Record<string, any>;
}

/** How many kept drafts History offers. The function prunes the rest. */
const KEPT_SHOWN = 10;

/**
 * Holds in Firestore (specs/visual-editing-spec.md, VE-D76 to VE-D84): following a
 * draft's hold, taking over, and the drafts kept before work changes hands. A
 * draft is named by its path: `arc_{type}_drafts/{id}` or `SitePageTextDrafts/{pageId}`.
 */
@Injectable({ providedIn: 'root' })
export class HoldService {
    private injector = inject(Injector);

    private get firestore(): Firestore | null {
        return this.injector.get(Firestore, null);
    }

    private ref(path: string): DocumentReference {
        const firestore = this.firestore!;
        return runInInjectionContext(this.injector, () => doc(firestore, path));
    }

    /** The signed-in person, or null outside a session. */
    me(): EditorPerson | null {
        const uid = this.injector.get(Auth, null)?.currentUser?.uid;
        if (!uid) return null;
        // The name is only shown: without it the hold still says whose it is.
        let name = '';
        try {
            const user = this.injector.get(AuthState, null)?.currentUser?.();
            name = user?.name || user?.email || '';
        } catch {
            name = '';
        }
        return { uid, name };
    }

    /** Follows a document: its data now and each time it changes, null when there is none. Returns what stops it. */
    follow(path: string, next: (data: Record<string, any> | null, pending: boolean) => void): () => void {
        const firestore = this.firestore;
        if (!firestore) return () => undefined;
        try {
            return runInInjectionContext(this.injector, () => onSnapshot(
                doc(firestore, path),
                (snap) => next(snap.exists() ? (snap.data() as Record<string, any>) : null, snap.metadata.hasPendingWrites),
                (error) => console.error(`[Hold] Could not follow ${path}:`, error),
            ));
        } catch (error) {
            // Editing goes on: a save still checks who holds the draft.
            console.error(`[Hold] Could not follow ${path}:`, error);
            return () => undefined;
        }
    }

    /** An entry's translations, by language. */
    async translations(path: string): Promise<Record<string, Record<string, any>>> {
        const firestore = this.firestore;
        if (!firestore || !/^arc_/.test(path)) return {};
        const snap = await runInInjectionContext(this.injector, () => getDocs(collection(firestore, path, 'translations')));
        return Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as Record<string, any>]));
    }

    async read(path: string): Promise<Record<string, any> | null> {
        if (!this.firestore) return null;
        const snap = await runInInjectionContext(this.injector, () => getDoc(this.ref(path)));
        return snap.exists() ? (snap.data() as Record<string, any>) : null;
    }

    /**
     * Keeps a draft inside a transaction (VE-D84): the draft, and each translation in
     * a document of its own, so a long entry in many languages fits Firestore's limit.
     */
    private keepIn(
        tx: Transaction, firestore: Firestore, path: string, data: Record<string, any>,
        translations: Record<string, Record<string, any>>, who: { by: string; name: string; why: KeptDraft['why'] }, me: EditorPerson,
    ): string {
        const kept = doc(collection(firestore, path, 'Kept'));
        tx.set(kept, { ...who, keptBy: me.uid, keptByName: me.name.slice(0, 200), keptAt: serverTimestamp(), data });
        for (const [lang, words] of Object.entries(translations)) tx.set(doc(firestore, path, 'Kept', kept.id, 'translations', lang), { ...words, lang });
        return kept.id;
    }

    /** The translations as they are inside a transaction, so none saved meanwhile is missed or written over. */
    private async translationsIn(tx: Transaction, firestore: Firestore, path: string, langs: readonly string[]): Promise<Record<string, Record<string, any>>> {
        const snaps = await Promise.all(langs.map((lang) => tx.get(doc(firestore, path, 'translations', lang))));
        return Object.fromEntries(snaps.flatMap((snap, at) => (snap.exists() ? [[langs[at], snap.data() as Record<string, any>]] : [])));
    }

    /**
     * Take over (VE-D81): the other person's draft is kept and the hold changes
     * hands in one write, which changes the hold and nothing else. False when the
     * person shown (`from`) no longer holds it: what was reviewed is not what is there.
     */
    async takeOver(path: string, from: string): Promise<boolean> {
        const me = this.me();
        const firestore = this.firestore;
        if (!me || !firestore) return false;
        const langs = Object.keys(await this.translations(path));
        return runInInjectionContext(this.injector, () => runTransaction(firestore, async (tx) => {
            const ref = doc(firestore, path);
            const snap = await tx.get(ref);
            if (!snap.exists()) return false;
            const data = snap.data() as Record<string, any>;
            const hold = heldByOther(data, me.uid);
            if (!hold || hold.by !== from) return false;
            const translations = await this.translationsIn(tx, firestore, path, langs);
            const kept = this.keepIn(tx, firestore, path, data, translations, { by: hold.by, name: hold.name, why: 'takeover' }, me);
            tx.update(ref, { editing: { by: me.uid, name: me.name, since: serverTimestamp(), at: serverTimestamp(), kept } });
            return true;
        }));
    }

    /** Keeps the draft as it is, before a Discard or a Restore of another (VE-D84). */
    async keep(path: string, why: KeptDraft['why'] = 'discard'): Promise<void> {
        const me = this.me();
        const firestore = this.firestore;
        if (!me || !firestore) return;
        const langs = Object.keys(await this.translations(path));
        await runInInjectionContext(this.injector, () => runTransaction(firestore, async (tx) => {
            const snap = await tx.get(doc(firestore, path));
            if (!snap.exists()) return;
            const data = snap.data() as Record<string, any>;
            const translations = await this.translationsIn(tx, firestore, path, langs);
            const hold = holdOf(data);
            this.keepIn(tx, firestore, path, data, translations, { by: hold?.by ?? me.uid, name: hold?.name || me.name, why }, me);
        }));
    }

    /**
     * The draft is what is live again: this person lets go of it (VE-D76), and it says
     * Published as it did. Checked again inside the write. The draft's mark after it,
     * or null when it was not let go.
     */
    async letGo(type: string, id: string, fields: readonly { key: string; type?: string }[]): Promise<unknown> {
        const me = this.me();
        const firestore = this.firestore;
        if (!me || !firestore) return null;
        return runInInjectionContext(this.injector, () => runTransaction(firestore, async (tx) => {
            const ref = doc(firestore, `arc_${type}_drafts/${id}`);
            const [snap, live] = [await tx.get(ref), await tx.get(doc(firestore, `arc_${type}/${id}`))];
            if (!snap.exists() || !live.exists()) return null;
            const draft = snap.data() as Record<string, any>;
            const published = live.data() as Record<string, any>;
            if (holdOf(draft)?.by !== me.uid || draft['publishedStatus'] !== true || !published['modifiedAt']) return null;
            if (entryChanges({ draft, published, fields }).length) return null;
            tx.update(ref, { editing: deleteField(), changedOnPage: deleteField(), status: 'publish', modifiedAt: published['modifiedAt'] });
            this.queueSearch(tx, firestore, ref.path);
            return published['modifiedAt'];
        }));
    }

    /** The draft is queued for search with the write, as every draft save does. */
    private queueSearch(tx: Transaction, firestore: Firestore, path: string): void {
        const entry = draftQueueEntry(firestore, path);
        if (entry) tx.set(entry.ref, entry.data);
    }

    /** The drafts kept under a draft, newest first. */
    async kept(path: string): Promise<KeptDraft[]> {
        const firestore = this.firestore;
        if (!firestore) return [];
        const snap = await runInInjectionContext(this.injector, () => getDocs(query(
            collection(firestore, path, 'Kept'), orderBy('keptAt', 'desc'), limit(KEPT_SHOWN),
        )));
        return snap.docs.map((d) => ({ ...(d.data() as Omit<KeptDraft, 'id'>), id: d.id }));
    }

    /** Publish these (VE-D80): the draft says it is published; who holds it ends when the publish lands. */
    async markPublished(path: string): Promise<void> {
        const firestore = this.firestore;
        if (!firestore) return;
        await runInInjectionContext(this.injector, () => runTransaction(firestore, async (tx) => {
            const ref = doc(firestore, path);
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('This entry was deleted.');
            // Not `modifiedAt`: the other person's editor has nothing new to read.
            tx.update(ref, { status: 'publish', publishedStatus: true, publishedOn: snap.data()['publishedOn'] || new Date() });
        }));
    }

    /** What differs between an entry's stored draft and what is live, in every language (VE6.B1). */
    async entryChanges(type: string, id: string, fields: readonly { key: string; type?: string }[]): Promise<Change[]> {
        if (!this.firestore) return [];
        const [draft, published, translations] = await Promise.all([
            this.read(`arc_${type}_drafts/${id}`), this.read(`arc_${type}/${id}`), this.bothTranslations(type, id),
        ]);
        return entryChanges({ draft, published: published ?? null, fields, translations });
    }

    private async bothTranslations(type: string, id: string): Promise<Record<string, { draft: Record<string, any> | null; published: Record<string, any> | null }>> {
        const [draft, published] = await Promise.all([this.translations(`arc_${type}_drafts/${id}`), this.translations(`arc_${type}/${id}`)]);
        const langs = [...new Set([...Object.keys(draft), ...Object.keys(published)])];
        return Object.fromEntries(langs.map((lang) => [lang, { draft: draft[lang] ?? null, published: published[lang] ?? null }]));
    }

    /**
     * Puts one change of an entry back to what is live, or everything (VE-D83). When
     * nothing is left that differs, the entry is let go. An entry with nothing
     * published has nothing to go back to.
     */
    async restorePublished(type: string, id: string, fields: readonly { key: string; type?: string }[], only?: Change): Promise<void> {
        const me = this.me();
        const firestore = this.firestore;
        if (!me || !firestore) return;
        const published = await this.read(`arc_${type}/${id}`);
        if (!published) throw new Error('Nothing is published to go back to.');
        const both = await this.bothTranslations(type, id);
        const path = `arc_${type}_drafts/${id}`;
        await runInInjectionContext(this.injector, () => runTransaction(firestore, async (tx) => {
            const ref = doc(firestore, path);
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('This entry was deleted.');
            const draft = snap.data() as Record<string, any>;
            const hold = heldByOther(draft, me.uid);
            if (hold) throw new HeldError(hold);
            const stored = await this.translationsIn(tx, firestore, path, Object.keys(both));
            const translations = Object.fromEntries(Object.entries(both).map(([lang, pair]) => [lang, { ...pair, draft: stored[lang] ?? null }]));
            const todo = entryChanges({ draft, published, fields, translations }).filter((c) => !only || c.id === only.id);
            const next: Record<string, any> = { ...draft, customFields: { ...(draft['customFields'] ?? {}) } };
            const langs = new Map<string, Record<string, any> | null>();
            for (const change of todo) {
                const target = change.lang ? { ...(langs.get(change.lang) ?? translations[change.lang]?.draft ?? { lang: change.lang }) } : next;
                const source = change.lang ? translations[change.lang]?.published ?? {} : published;
                if (change.field.startsWith('cf:')) {
                    const key = change.field.slice(3);
                    const custom = { ...(target['customFields'] ?? {}) };
                    if (source['customFields']?.[key] === undefined) delete custom[key];
                    else custom[key] = source['customFields'][key];
                    // A chosen entry's copy goes with it.
                    const ref = `_ref_${key}`;
                    if (source['customFields']?.[ref] === undefined) delete custom[ref];
                    else custom[ref] = source['customFields'][ref];
                    target['customFields'] = custom;
                } else if (source[change.field] === undefined) delete target[change.field];
                else target[change.field] = source[change.field];
                if (change.lang) langs.set(change.lang, target);
            }
            const after = Object.fromEntries(Object.entries(translations).map(([lang, both]) => [lang, { ...both, draft: langs.get(lang) ?? both.draft }]));
            const release = entryChanges({ draft: next, published, fields, translations: after }).length === 0;
            const update: Record<string, unknown> = { modifiedAt: release ? published['modifiedAt'] ?? new Date() : new Date(), ...this.stamp(me, draft, release) };
            if (release) Object.assign(update, { status: 'publish', publishedStatus: true, changedOnPage: deleteField() });
            for (const change of todo) {
                if (change.lang) continue;
                const key = change.field.startsWith('cf:') ? 'customFields' : change.field;
                update[key] = next[key] === undefined ? deleteField() : next[key];
            }
            if (todo.some((c) => c.field === 'authorId')) update['authorName'] = published['authorName'] ?? deleteField();
            if (todo.some((c) => c.field === 'tags')) update['tagsWithColors'] = published['tagsWithColors'] ?? deleteField();
            tx.update(ref, update);
            for (const [lang, value] of langs) {
                const at = doc(firestore, path, 'translations', lang);
                // A language with no words of its own left was never published: it goes.
                if (value && (translations[lang]?.published || !isTranslationEmpty({ ...value, lang } as IContentTranslation))) tx.set(at, value);
                else tx.delete(at);
            }
            this.queueSearch(tx, firestore, ref.path);
        }));
    }

    /** A kept draft becomes the draft again (VE-D84); what was there is kept first. */
    async restoreKept(type: string, id: string, kept: KeptDraft): Promise<void> {
        const me = this.me();
        const firestore = this.firestore;
        if (!me || !firestore) return;
        const path = `arc_${type}_drafts/${id}`;
        const then = await this.translations(`${path}/Kept/${kept.id}`);
        await this.keep(path, 'discard');
        const now = await this.translations(path);
        await runInInjectionContext(this.injector, () => runTransaction(firestore, async (tx) => {
            const ref = doc(firestore, path);
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('This entry was deleted.');
            const draft = snap.data() as Record<string, any>;
            const hold = heldByOther(draft, me.uid);
            if (hold) throw new HeldError(hold);
            // Where the entry stands on the site, in its order and in the series is as it is now, not as it was then.
            const stays = ['publishedOn', 'lastPublishedAt', 'publishedStatus', 'sortOrder', 'isFeatured', 'nextContent', 'previousContent', 'createdAt', 'createdBy', 'id'];
            const values: Record<string, any> = { ...kept.data };
            for (const key of stays) {
                if (draft[key] === undefined) delete values[key];
                else values[key] = draft[key];
            }
            delete values['editing'];
            delete values['changedOnPage'];
            tx.set(ref, { ...values, status: 'draft', modifiedAt: new Date(), modifiedBy: me.uid, ...this.stamp(me, draft, false) });
            for (const lang of new Set([...Object.keys(now), ...Object.keys(then)])) {
                const at = doc(firestore, path, 'translations', lang);
                if (then[lang]) tx.set(at, then[lang]);
                else tx.delete(at);
            }
            this.queueSearch(tx, firestore, ref.path);
        }));
    }

    /** What a save writes into `editing`: the hold, or its removal when the draft is what is live again. */
    stamp(me: EditorPerson, before: Record<string, any> | null | undefined, release: boolean): Record<string, unknown> {
        if (release) return { editing: deleteField() };
        const was = holdOf(before);
        return { editing: { by: me.uid, name: me.name, since: was?.by === me.uid && was.since ? was.since : serverTimestamp(), at: serverTimestamp() } };
    }
}
