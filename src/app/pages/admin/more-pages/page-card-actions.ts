import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Firestore, deleteField, doc, getDoc, runTransaction, updateDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import type { ContentType } from '../contents/content-types/content-types.model';
import { DraftContentsStore } from '../contents/draft-content-store/draft-contents.store';
import { isEmptyFieldValue } from '../contents/draft-content-store/entry-draft-session';
import { EntryOrderService } from '../contents/entry-order/entry-order.service';
import { PublishQueueService } from '../contents/publish-queue/publish-queue.service';
import { hasReplacePrompt } from '../contents/standard-pages/standard-pages';
import { isPageChange } from './page-cards';

/** A card on the page: its entry. */
export interface CardRef {
    type: string;
    id: string;
}

/** Why a card cannot be published yet: the field to open it on. */
export interface CardProblem {
    field: string;
    /** `required` (a required field is empty) or `address` (a type with pages has no address). */
    kind: 'required' | 'address';
}

/**
 * The checks Publish runs on a card, as the entry editor runs them
 * (EntryDraftSession.validateForPublish): the title, every required field, and an
 * address for a type with pages. Null when it may be published.
 */
export function cardProblem(draft: Record<string, any>, type: ContentType): CardProblem | null {
    if (!String(draft['title'] ?? '').trim()) return { field: 'title', kind: 'required' };
    for (const field of (type.fields || []).filter((f) => f.required)) {
        if (isEmptyFieldValue(draft['customFields']?.[field.key])) return { field: field.key, kind: 'required' };
    }
    if (type.hasPublicUrl !== false && !String(draft['urlSlug'] ?? '').trim()) return { field: 'urlSlug', kind: 'address' };
    return null;
}

/** Text still to replace (`[Replace: ...]`), as the entry editor asks about before a publish. */
export function cardHasReplace(draft: Record<string, any>): boolean {
    const { id: _id, ...values } = draft;
    return hasReplacePrompt(values);
}

/**
 * A sortOrder right after `after` in a type's own order (entries in that order):
 * halfway to the next entry's, or one more when it is last. Last of all when
 * `after` is not there. Nothing else is renumbered, so no page is republished.
 */
export function placeAfter(entries: readonly { id: string; sortOrder?: number }[], after?: string): number {
    const last = entries.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0) + 1;
    const at = after ? entries.findIndex((entry) => entry.id === after) : -1;
    const own = at >= 0 ? entries[at].sortOrder : undefined;
    if (own === undefined) return last;
    const next = entries.slice(at + 1).find((entry) => typeof entry.sortOrder === 'number')?.sortOrder;
    return next !== undefined && next > own ? (own + next) / 2 : own + 1;
}

/** Two stored times (Timestamp, Date, millis or nothing) are the same moment. */
export function sameTime(a: unknown, b: unknown): boolean {
    const ms = (t: any): number | null => (t == null ? null : typeof t === 'number' ? t
        : typeof t.toMillis === 'function' ? t.toMillis() : t instanceof Date ? t.getTime() : null);
    return ms(a) === ms(b);
}

/**
 * The ids of a type's entries with one moved beside another (VE-D54): before
 * `neighbour` when `after` is false, else after it. The list is the whole type in
 * its own order (EntryOrderService.load), so entries not on the page keep theirs.
 */
export function movedBeside(ids: readonly string[], id: string, neighbour: string, after: boolean): string[] {
    if (id === neighbour || !ids.includes(id) || !ids.includes(neighbour)) return [...ids];
    const rest = ids.filter((each) => each !== id);
    const at = rest.indexOf(neighbour) + (after ? 1 : 0);
    return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * What the page's Visual Editor does to its cards (specs/visual-editing-spec.md,
 * VE-D53, VE-D54): add a draft of a type, take a card off the page (never a
 * delete), move it in a type's own order as Arrange does, and publish it.
 */
@Injectable({ providedIn: 'root' })
export class PageCardActions {
    private firestore = inject(Firestore);
    private injector = inject(EnvironmentInjector);
    private drafts = inject(DraftContentsStore);
    private queue = inject(PublishQueueService);
    private order = inject(EntryOrderService);

    private ref(card: CardRef) {
        return runInInjectionContext(this.injector, () => doc(this.firestore, `arc_${card.type}_drafts`, card.id));
    }

    /** The card's draft as stored, or null. */
    async read(card: CardRef): Promise<Record<string, any> | null> {
        const snap = await runInInjectionContext(this.injector, () => getDoc(this.ref(card)));
        return snap.exists() ? { ...snap.data(), id: snap.id } : null;
    }

    private update(card: CardRef, data: Record<string, unknown>): Promise<void> {
        return runInInjectionContext(this.injector, () => updateDoc(this.ref(card), data));
    }

    /**
     * Add: a new draft of the type, on this page until it is published or taken
     * off (`addedOnPage`), last in a type's own order. Its title asks to be
     * replaced, so Publish asks before it goes out unchanged. In a type's own
     * order it goes right after `after` (the card whose Add was pressed), so it
     * stays in view in a full block; else last.
     */
    async add(type: ContentType, pageId: string, title: string, after?: string): Promise<string> {
        let sortOrder: number | undefined;
        if (type.entryOrder === 'manual') {
            const entries = await this.order.load(type.slug);
            sortOrder = placeAfter(entries, after);
        }
        const stamp = new Date();
        return firstValueFrom(this.drafts.createDraft({
            title,
            type: type.slug,
            status: 'draft',
            publishedStatus: false,
            content: '',
            summary: '',
            customFields: {},
            tags: [],
            urlSlug: '',
            addedOnPage: pageId,
            createdAt: stamp,
            modifiedAt: stamp,
            updatedAt: stamp,
            ...(sortOrder !== undefined ? { sortOrder } : {}),
        }, type.slug));
    }

    /**
     * Remove: a published card is unpublished, as the entries list does it; a card
     * added here and never published only leaves the page. Never deleted: the
     * entry stays in its list.
     */
    async remove(card: CardRef): Promise<void> {
        const draft = await this.read(card);
        if (!draft) return;
        if (draft['publishedStatus'] === true) {
            await this.update(card, { status: 'draft', publishedStatus: false, addedOnPage: deleteField() });
            try {
                await this.queue.enqueue('unpublish', card.type, card.id);
            } catch (error) {
                // Not unpublished: the card stays as it was, on the page and on the site.
                await this.update(card, { status: draft['status'], publishedStatus: true, ...(draft['addedOnPage'] ? { addedOnPage: draft['addedOnPage'] } : {}) })
                    .catch((undo) => console.error('[PageCardActions] Could not put the card back:', undo));
                throw error;
            }
        } else {
            await this.update(card, { addedOnPage: deleteField() });
        }
    }

    /** Move: the card beside its neighbour on the page, saved and republished as Arrange does. */
    async move(card: CardRef, neighbour: string, after: boolean): Promise<void> {
        const ids = (await this.order.load(card.type)).map((entry) => entry.id);
        await this.order.save(card.type, movedBeside(ids, card.id, neighbour, after));
    }

    /**
     * Publishes a card's draft as the entry editor's Publish does. `checked` is the
     * draft as Publish checked it: the card is published only if it is still that
     * draft and still a change of this page (nobody saved or unpublished it since),
     * else false and nothing is written. When the publish cannot be queued, the
     * draft is put back as it was and the error thrown, so Publish can try again.
     */
    async publish(card: CardRef, checked: Record<string, any>, pageId: string): Promise<boolean> {
        const ref = this.ref(card);
        const stamp = new Date();
        const before = await runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (tx) => {
            const snap = await tx.get(ref);
            const now = snap.exists() ? (snap.data() as Record<string, any>) : null;
            if (!now || !isPageChange(now, pageId) || !sameTime(now['modifiedAt'], checked['modifiedAt'])) return null;
            tx.update(ref, {
                status: 'publish',
                publishedStatus: true,
                publishedOn: now['publishedOn'] || stamp,
                modifiedAt: stamp,
                updatedAt: stamp,
                addedOnPage: deleteField(),
            });
            return now;
        }));
        if (!before) return false;
        try {
            await this.queue.enqueue('publish', card.type, card.id);
        } catch (error) {
            const back = (key: string) => (before[key] !== undefined ? before[key] : deleteField());
            await this.update(card, {
                status: before['status'], publishedStatus: before['publishedStatus'], publishedOn: back('publishedOn'),
                modifiedAt: back('modifiedAt'), updatedAt: back('updatedAt'), addedOnPage: back('addedOnPage'),
            }).catch((undo) => console.error('[PageCardActions] Could not put the card back:', undo));
            throw error;
        }
        return true;
    }
}
