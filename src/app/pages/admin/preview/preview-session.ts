/**
 * The live preview window's state (specs/visual-editing-spec.md, VE-D1 to VE-D10):
 * the editor's draft as last received, and what the page components read from it.
 *
 * Provided by ContentPreviewComponent as the page's DetailSource (the content
 * page draws the draft) and CardDraft (card blocks of the draft's type draw it
 * among their cards).
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DetailRoute, DetailSource, LiveDetail } from '../../page.parts/detail-source';
import { CardDraft, CardDraftEntry, UNSAVED_DRAFT_ID } from '../../page.parts/card-draft';
import { mergeTranslation } from '../contents/draft-content-store/content-translation.model';

/** The draft as a card: published-looking, merged with its translation, never without an id or a date. */
export function draftAsCard(live: LiveDetail, now: Date = new Date()): Record<string, any> {
    const content = live.translation ? mergeTranslation(live.content, live.translation) : live.content;
    return {
        ...content,
        id: content['id'] || UNSAVED_DRAFT_ID,
        publishedStatus: true,
        // A draft never published sorts as the newest, where a publish now would put it.
        publishedOn: content['publishedOn'] || content['createdAt'] || now.toISOString(),
    };
}

@Injectable()
export class PreviewSession extends DetailSource implements CardDraft {
    private snapshot = inject(ActivatedRoute).snapshot;
    /** The content type in the address. */
    readonly type = this.snapshot.paramMap.get('type') || '';
    /** The entry's id, '' for an entry not saved yet (`new` in the address). */
    readonly id = ((id) => (id === 'new' ? '' : id))(this.snapshot.paramMap.get('id') || '');

    override readonly live = signal<LiveDetail | null>(null);
    override readonly markFields = true;
    /** The Visual Editor loads this page with ?edit=1. */
    override readonly editing = this.snapshot.queryParamMap?.get('edit') === '1';

    route(): DetailRoute {
        return { typeSlug: this.type, urlSlug: '', preview: false, lang: this.live()?.lang || '' };
    }

    readonly entry = computed<CardDraftEntry | null>(() => {
        const live = this.live();
        return live ? { type: this.type, content: draftAsCard(live) } : null;
    });
}
