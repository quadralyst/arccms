import { DOCUMENT } from '@angular/common';
import { EnvironmentInjector, Injectable, OnDestroy, inject, runInInjectionContext, signal, untracked } from '@angular/core';
import { Firestore, collection, doc, getDocs, onSnapshot, query, where } from '@angular/fire/firestore';
import { PreviewChannel, previewSessionKey } from '../../../core/preview/preview-channel';
import { PageCardDrafts, type PageCardsOfType } from '../../page.parts/card-draft';
import { draftAsCard } from '../preview/preview-session';
import { mergeTranslation, type IContentTranslation } from '../contents/draft-content-store/content-translation.model';
import { timeOf } from '../../../core/utils/display-order';

/** The draft status a save writes; a publish writes `publish`. */
const DRAFT = 'draft';

/**
 * What the Visual Editor's screen tells its frame: the card being edited (or
 * none), a hold while words are typed on a card, so the cards are not drawn
 * again under the cursor, and a type whose order was just changed (a Move).
 */
export type PageCardsMessage =
    | { arcPageCards: 'focus'; focus: { type: string; id: string } | null }
    | { arcPageCards: 'hold'; on: boolean }
    | { arcPageCards: 'reorder'; type: string };

/** The message from the screen, checked; null for anything else. */
export function parsePageCardsMessage(data: unknown): PageCardsMessage | null {
    if (!data || typeof data !== 'object') return null;
    const message = data as Record<string, any>;
    if (message['arcPageCards'] === 'hold') return typeof message['on'] === 'boolean' ? { arcPageCards: 'hold', on: message['on'] } : null;
    if (message['arcPageCards'] === 'reorder') {
        const type = message['type'];
        return typeof type === 'string' && type && type.length <= 100 ? { arcPageCards: 'reorder', type } : null;
    }
    if (message['arcPageCards'] !== 'focus') return null;
    const focus = message['focus'];
    if (focus === null) return { arcPageCards: 'focus', focus: null };
    if (!focus || typeof focus.type !== 'string' || typeof focus.id !== 'string' || !focus.type || !focus.id) return null;
    if (focus.type.length > 100 || focus.id.length > 200) return null;
    return { arcPageCards: 'focus', focus: { type: focus.type, id: focus.id } };
}

/**
 * Whether a draft is a change the page's one Publish takes (VE-D53): status
 * `draft`, and either a published entry edited since, or a card added on this
 * page that was never published (`addedOnPage` alone is not enough: an entry
 * published elsewhere and later unpublished on purpose keeps it).
 */
export function isPageChange(draft: Record<string, any>, pageId: string): boolean {
    if (draft['status'] !== DRAFT) return false;
    if (draft['publishedStatus'] === true) return true;
    return draft['addedOnPage'] === pageId && !draft['lastPublishedAt'] && !draft['publishedOn'];
}

/**
 * Sorts a type's drafts for the page (VE-D53, VE-D54): the changes the page
 * shows (isPageChange), drawn published-looking; any other draft whose status is
 * `draft` and is off the site (Remove, unpublished elsewhere) is hidden. Every
 * draft's place in the type's own order is kept, so a Move shows at once.
 */
export function pageCardsOf(drafts: Record<string, any>[], pageId: string): Omit<PageCardsOfType<Record<string, any>>, 'focus'> {
    const changed: Record<string, any>[] = [];
    const hidden = new Set<string>();
    const sortOrder: Record<string, number> = {};
    for (const draft of drafts) {
        if (typeof draft['sortOrder'] === 'number') sortOrder[draft['id']] = draft['sortOrder'];
        if (draft['status'] !== DRAFT) continue;
        if (isPageChange(draft, pageId)) changed.push(draftAsCard({ content: draft, lang: '', translation: null }));
        else hidden.add(draft['id']);
    }
    return { changed, hidden, sortOrder };
}

/**
 * The page's cards in the Visual Editor's frame (specs/visual-editing-spec.md,
 * VE-D53, VE-D54). Provided by the page preview in edit mode. Each card block
 * asks to follow its type: its drafts with status `draft` are read live from
 * Firestore (only those: a type may hold thousands of entries), with their
 * translation into the page's language, and its whole order once more after a
 * Move. The card being edited follows its form as typed, over the entry's
 * preview channel (the form in the screen's panel opens it, as the entry Visual
 * Editor's does).
 */
@Injectable()
export class PageCardsSource extends PageCardDrafts implements OnDestroy {
    private firestore = inject(Firestore);
    private injector = inject(EnvironmentInjector);
    private document = inject(DOCUMENT);

    private readonly byType = signal<Record<string, Omit<PageCardsOfType<Record<string, any>>, 'focus'>>>({});
    /** Each type's order as last read in full, after a Move. */
    private readonly orders = signal<Record<string, Record<string, number>>>({});
    /** The changed drafts' translations, by `{type}/{id}/{lang}/{modified}`; null when there is none. */
    private readonly translations = signal<Record<string, IContentTranslation | null>>({});
    private readonly focus = signal<{ type: string; content: Record<string, any> | null } | null>(null);
    private readonly stops: (() => void)[] = [];
    private readonly watched = new Set<string>();
    /** The translations followed, by `{type}/{id}/{lang}`: each stops with the source. */
    private readonly translationStops = new Map<string, () => void>();
    private channel: PreviewChannel | null = null;
    private pageId = '';
    /** Changes that arrived while words were typed on a card, applied when the typing ends. */
    private held: (() => void)[] | null = null;

    /** Runs a change to the cards now, or after the hold. */
    private apply(change: () => void): void {
        if (this.held) this.held.push(change);
        else change();
    }

    private hold(on: boolean): void {
        if (on) {
            this.held ??= [];
            return;
        }
        const changes = this.held ?? [];
        this.held = null;
        for (const change of changes) change();
    }

    /** Starts listening to the screen; `pageId` is the page whose added cards count. */
    start(pageId: string): void {
        this.pageId = pageId;
        const win = this.document.defaultView;
        if (!win) return;
        const onMessage = (event: MessageEvent) => {
            if (event.source !== win.parent || event.origin !== win.location.origin) return;
            const message = parsePageCardsMessage(event.data);
            if (message?.arcPageCards === 'focus') this.apply(() => this.setFocus(message.focus));
            else if (message?.arcPageCards === 'hold') this.hold(message.on);
            else if (message?.arcPageCards === 'reorder') void this.readOrder(message.type);
        };
        win.addEventListener('message', onMessage);
        this.stops.push(() => win.removeEventListener('message', onMessage));
    }

    watch(type: string): void {
        if (!type || this.watched.has(type)) return;
        this.watched.add(type);
        const stop = runInInjectionContext(this.injector, () => onSnapshot(
            query(collection(this.firestore, `arc_${type}_drafts`), where('status', '==', DRAFT)),
            (snap) => {
                const drafts = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
                const cards = pageCardsOf(drafts, this.pageId);
                this.apply(() => this.byType.update((all) => ({ ...all, [type]: cards })));
            },
            (error) => console.error(`[PageCards] Could not read the drafts of ${type}:`, error),
        ));
        this.stops.push(stop);
    }

    /** A Move was saved: the type's whole order is read once, so the block follows it at once. */
    private async readOrder(type: string): Promise<void> {
        try {
            const snap = await runInInjectionContext(this.injector, () => getDocs(collection(this.firestore, `arc_${type}_drafts`)));
            const order: Record<string, number> = {};
            for (const d of snap.docs) {
                const place = d.data()['sortOrder'];
                if (typeof place === 'number') order[d.id] = place;
            }
            this.apply(() => this.orders.update((all) => ({ ...all, [type]: order })));
        } catch (error) {
            console.error(`[PageCards] Could not read the order of ${type}:`, error);
        }
    }

    cardsOf(type: string, lang = ''): PageCardsOfType<Record<string, any>> | null {
        const cards = this.byType()[type];
        if (!cards) return null;
        const focus = this.focus();
        const order = this.orders()[type];
        const changed = lang ? cards.changed.map((entry) => this.translated(type, entry, lang)) : cards.changed;
        return {
            ...cards,
            changed,
            sortOrder: order ? { ...order, ...cards.sortOrder } : cards.sortOrder,
            focus: focus?.type === type ? focus.content : null,
        };
    }

    /**
     * A changed card in the page's language: its draft's own translation, followed,
     * since the editor saves it after the draft itself (a read per save could catch
     * the old words).
     */
    private translated(type: string, entry: Record<string, any>, lang: string): Record<string, any> {
        const key = `${type}/${entry['id']}/${lang}`;
        const all = this.translations();
        if (!this.translationStops.has(key)) untracked(() => this.followTranslation(type, entry['id'], lang, key));
        return all[key] ? mergeTranslation(entry as any, all[key]!) as Record<string, any> : entry;
    }

    private followTranslation(type: string, id: string, lang: string, key: string): void {
        this.translationStops.set(key, () => undefined);
        const stop = runInInjectionContext(this.injector, () => onSnapshot(
            doc(this.firestore, `arc_${type}_drafts`, id, 'translations', lang),
            (snap: any) => {
                const translation = snap.exists() ? ({ ...snap.data(), lang } as IContentTranslation) : null;
                this.apply(() => this.translations.update((all) => ({ ...all, [key]: translation })));
            },
            (error: unknown) => console.error(`[PageCards] Could not read the ${lang} words of ${type}/${id}:`, error),
        ));
        this.translationStops.set(key, stop);
    }

    /** The card being edited: its form's state, as typed, draws it. */
    private setFocus(focus: { type: string; id: string } | null): void {
        this.channel?.close();
        this.channel = null;
        this.focus.set(focus ? { type: focus.type, content: null } : null);
        if (!focus) return;
        this.channel = new PreviewChannel(previewSessionKey(focus.type, focus.id), (message) => {
            if (message.kind === 'state' && message.draft['id'] === focus.id) {
                const content = draftAsCard({ content: message.draft, lang: message.lang, translation: message.translation });
                this.apply(() => this.focus.set({ type: focus.type, content }));
            } else if (message.kind === 'bye' && message.from === 'editor') {
                this.apply(() => this.focus.set({ type: focus.type, content: null }));
            }
        });
        this.channel.post({ kind: 'hello' });
    }

    ngOnDestroy(): void {
        this.channel?.close();
        for (const stop of this.stops) stop();
        for (const stop of this.translationStops.values()) stop();
    }
}
