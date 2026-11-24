/**
 * A draft shown among a card block's cards (specs/visual-editing-spec.md, VE-D10).
 *
 * A type without pages is previewed on the page that shows its cards. The live
 * preview provides a CardDraft; every card block of that type on the page
 * (ContentPartialsComponent, the home page's or the header's and footer's) then
 * draws the draft in place of its published copy, or where the type's order puts
 * it for an entry never published. Elsewhere there is no CardDraft and the
 * blocks draw published entries only.
 */
import { Signal } from '@angular/core';
import { sortForDisplay, timeOf, EntryOrder } from '../../core/utils/display-order';

export interface CardDraftEntry {
    /** The draft's content type. */
    type: string;
    /** The draft, merged with the page language's translation, with its id ('' before its first save). */
    content: Record<string, any>;
}

export abstract class CardDraft {
    abstract readonly entry: Signal<CardDraftEntry | null>;
}

/** The id a draft never saved stands under among the cards. */
export const UNSAVED_DRAFT_ID = '__arc-draft__';

/** The cards a block shows, with the draft in: where the cards a block shows come from in the preview. */
export interface CardsWithDraft<T> {
    cards: T[];
    /** The draft's place among the cards, -1 when it is not one of them. */
    draftIndex: number;
    /** The block's count would have left the draft out: it took the last card's place. */
    tookLastPlace: boolean;
}

/** A draft drawn as a card has its live copy's date, which it keeps when published: it stays in its place. */
function withLiveDate<T extends Record<string, any>>(draft: T, published: readonly T[]): T {
    const date = published.find((entry) => entry['id'] === draft['id'])?.['publishedOn'];
    return date && timeOf(date) !== timeOf(draft['publishedOn']) ? { ...draft, publishedOn: date } : draft;
}

/**
 * The block's cards in the type's order with the draft swapped in for its
 * published copy (or added, never published), cut to `count`. When the cut
 * would leave the draft out, it takes the last card's place (VE2.2).
 */
export function cardsWithDraft<T extends Record<string, any>>(
    published: readonly T[], draft: T | null, order: EntryOrder, count: number,
): CardsWithDraft<T> {
    if (!draft) return { cards: sortForDisplay(published, order).slice(0, count), draftIndex: -1, tookLastPlace: false };
    draft = withLiveDate(draft, published);
    const others = published.filter((entry) => entry['id'] !== draft['id']);
    const sorted = sortForDisplay([...others, draft], order);
    const index = sorted.indexOf(draft);
    if (index < count) return { cards: sorted.slice(0, count), draftIndex: index, tookLastPlace: false };
    const cards = [...sorted.filter((entry) => entry !== draft).slice(0, count - 1), draft];
    return { cards, draftIndex: cards.length - 1, tookLastPlace: true };
}

/** Why a card on a page's Visual Editor is drawn as it is (specs/visual-editing-spec.md, VE-D72). */
export interface PageCardNote {
    /** Someone else is editing the entry: their name. */
    held?: string;
    /** The entry has unpublished changes made elsewhere. */
    elsewhere?: boolean;
    /** Drawn from the draft of the person whose page is being looked at. */
    theirs?: boolean;
}

/**
 * The cards of one type on the page's Visual Editor (specs/visual-editing-spec.md,
 * VE-D53, VE-D54): every card with unpublished changes is drawn from its draft,
 * every other card as published, so what is seen is what Publish makes.
 */
export interface PageCardsOfType<T> {
    /** Drafts with unpublished changes the page shows (published-looking, see draftAsCard). */
    changed: readonly T[];
    /** Drafts published from the page, drawn from the draft (the site may not have them yet), and no change any more. */
    publishing?: readonly T[];
    /** Entries taken off the page (Remove, or unpublished elsewhere): never drawn. */
    hidden: ReadonlySet<string>;
    /** Each entry's place in the type's own order as the drafts have it now (a Move saved). */
    sortOrder: Readonly<Record<string, number>>;
    /** Why a card is not this person's to publish here (VE-D72), by entry id. */
    notes?: Readonly<Record<string, PageCardNote>>;
    /** The card being edited, as typed in its form, or null. */
    focus: T | null;
}

/** The page's cards: provided in the Visual Editor's frame and in the page's Live Preview from it. */
export abstract class PageCardDrafts {
    /**
     * True in the Visual Editor's frame: the cards a full block would push out show
     * after the others, cards and their values are marked to be edited, and the page's
     * scripts stay off. False in Live Preview: the block as Publish leaves it, nothing
     * more, and the page runs as on the site.
     */
    editing = true;

    /** Starts following a type's drafts; card blocks call it for their type. */
    abstract watch(type: string): void;
    /**
     * A type's drafts on the page, once read; null before. With `lang` (a page in
     * another language) the changed drafts carry their own translation into it.
     */
    abstract cardsOf(type: string, lang?: string): PageCardsOfType<Record<string, any>> | null;
}

export interface CardsWithDrafts<T> {
    /** The block's cards after Publish, in the type's order, cut to its count. */
    cards: T[];
    /** Ids among `cards` drawn from a draft with unpublished changes. */
    changedIds: Set<string>;
    /** Cards on the live block now that Publish would push out, drawn faintly after the others. */
    leaving: T[];
    /** The card being edited would be cut: it took the last card's place, as in VE2. */
    tookLastPlace: boolean;
}

/**
 * The block's cards with every changed draft in (VE-D53), cut to `count`; the
 * card being edited takes the last place when the cut would leave it out, and
 * live cards a full block pushes out are returned as `leaving` (VE-D54).
 */
export function cardsWithDrafts<T extends Record<string, any>>(
    published: readonly T[], page: PageCardsOfType<T>, order: EntryOrder, count: number,
): CardsWithDrafts<T> {
    const reordered = (entry: T): T => {
        const place = page.sortOrder[entry['id']];
        return typeof place === 'number' && place !== entry['sortOrder'] ? { ...entry, sortOrder: place } : entry;
    };
    const live = published.filter((entry) => !page.hidden.has(entry['id'])).map(reordered);
    const changedIds = new Set(page.changed.map((entry) => entry['id'] as string));
    const replacements = new Map<string, T>();
    for (const entry of [...(page.publishing ?? []), ...page.changed, ...(page.focus ? [page.focus] : [])]) {
        replacements.set(entry['id'], reordered(withLiveDate(entry, published)));
    }
    const merged = [...live.filter((entry) => !replacements.has(entry['id'])), ...replacements.values()];
    const sorted = sortForDisplay(merged, order);
    const afterPublish = sorted.slice(0, count);
    let cards = afterPublish;
    let tookLastPlace = false;
    const focus = page.focus ? replacements.get(page.focus['id'])! : null;
    if (focus && !cards.includes(focus)) {
        cards = [...cards.slice(0, count - 1), focus];
        tookLastPlace = true;
    }
    // What Publish pushes out, not what the card being edited covers for now.
    const staying = new Set(afterPublish.map((entry) => entry['id']));
    const shownIds = new Set(cards.map((entry) => entry['id']));
    const leaving = sortForDisplay(live, order).slice(0, count).filter((entry) => !staying.has(entry['id']) && !shownIds.has(entry['id']));
    return { cards, changedIds: new Set([...changedIds].filter((id) => shownIds.has(id))), leaving, tookLastPlace };
}

/**
 * Marks each card a page's Visual Editor drew (VE-D54) with its entry
 * (`data-arc-card-id`, `data-arc-card-type`), a card with unpublished changes
 * (`data-arc-changed`), the card being edited when it took the last place
 * (`data-arc-draft="last"`, as VE2) and one Publish would push out
 * (`data-arc-leaving`), for the screen's card bar. The cards are `host`'s rows of
 * the `items` loop, in order: a card block's, or a list page's.
 */
export function markPageCards(
    host: ParentNode, type: string,
    shown: CardsWithDrafts<{ id: string }> & { notes: Readonly<Record<string, PageCardNote>> },
): void {
    const { cards, leaving, changedIds, tookLastPlace, notes } = shown;
    [...cards, ...leaving].forEach((entry, index) => {
        const card = host.querySelector(`[data-arc-field="items"][data-arc-row="${index}"]`);
        if (!card) return;
        card.setAttribute('data-arc-card-id', entry.id);
        card.setAttribute('data-arc-card-type', type);
        card.toggleAttribute('data-arc-leaving', index >= cards.length);
        const note = notes[entry.id];
        // Only this person's own changes on the page are Publish's to take (VE-D72).
        card.toggleAttribute('data-arc-changed', changedIds.has(entry.id) && !note);
        card.toggleAttribute('data-arc-theirs', !!note?.theirs);
        card.toggleAttribute('data-arc-elsewhere', !!note?.elsewhere);
        if (note?.held) card.setAttribute('data-arc-held', note.held);
        else card.removeAttribute('data-arc-held');
        if (tookLastPlace && index === cards.length - 1) card.setAttribute('data-arc-draft', 'last');
        else card.removeAttribute('data-arc-draft');
    });
}
