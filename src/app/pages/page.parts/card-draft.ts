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
import { sortForDisplay, EntryOrder } from '../../core/utils/display-order';

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

/**
 * The block's cards in the type's order with the draft swapped in for its
 * published copy (or added, never published), cut to `count`. When the cut
 * would leave the draft out, it takes the last card's place (VE2.2).
 */
export function cardsWithDraft<T extends Record<string, any>>(
    published: readonly T[], draft: T | null, order: EntryOrder, count: number,
): CardsWithDraft<T> {
    if (!draft) return { cards: sortForDisplay(published, order).slice(0, count), draftIndex: -1, tookLastPlace: false };
    const others = published.filter((entry) => entry['id'] !== draft['id']);
    const sorted = sortForDisplay([...others, draft], order);
    const index = sorted.indexOf(draft);
    if (index < count) return { cards: sorted.slice(0, count), draftIndex: index, tookLastPlace: false };
    const cards = [...sorted.filter((entry) => entry !== draft).slice(0, count - 1), draft];
    return { cards, draftIndex: cards.length - 1, tookLastPlace: true };
}
