/**
 * The live preview window's state (specs/visual-editing-spec.md, VE-D1 to VE-D9):
 * the editor's draft as last received, and what the page components read from it.
 *
 * Provided by ContentPreviewComponent as the page's DetailSource: the content
 * page draws the draft.
 */
import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DetailRoute, DetailSource, LiveDetail } from '../../page.parts/detail-source';

@Injectable()
export class PreviewSession extends DetailSource {
    private snapshot = inject(ActivatedRoute).snapshot;
    /** The content type in the address. */
    readonly type = this.snapshot.paramMap.get('type') || '';
    /** The entry's id, '' for an entry not saved yet (`new` in the address). */
    readonly id = ((id) => (id === 'new' ? '' : id))(this.snapshot.paramMap.get('id') || '');

    override readonly live = signal<LiveDetail | null>(null);
    override readonly markFields = true;

    route(): DetailRoute {
        return { typeSlug: this.type, urlSlug: '', preview: false, lang: this.live()?.lang || '' };
    }
}
