/**
 * The admin header's search box.
 *
 * Wraps `arc-search-box` with the admin defaults: admin scope, the drafts
 * source, every language, Cmd+K, and Transloco strings. Renders nothing for
 * anyone who is not an admin. Its own component rather than markup inside
 * the page header so that the header injects nothing new: this one is
 * created inside an @if block, on change detection, like the bell.
 *
 * Spec: docs/search-spec.md, decision S-D17 and phase S4 item 3.
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import { SearchBoxComponent } from '../search-box/search-box.component';

@Component({
    selector: 'arc-admin-search',
    standalone: true,
    imports: [SearchBoxComponent, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (auth.isAdmin()) {
        <arc-search-box
            scope="admin"
            [sources]="sources"
            [lang]="lang"
            resultsUrl="/admin/search"
            navigation="router"
            [hotkey]="true"
            [placeholder]="'common.search.placeholder' | transloco"
            [emptyText]="'common.search.empty' | transloco"
            [showingForText]="'common.search.showing_for' | transloco"
            [allResultsText]="'common.search.all_results' | transloco"></arc-search-box>
        }
    `,
    styles: [':host { display: block; }'],
})
export class AdminSearchComponent {
    readonly auth = inject(AuthState);

    /**
     * The drafts index only: an admin searching from a page header wants the
     * thing to edit, and every draft has a published twin in the other
     * source that would otherwise show up as a duplicate.
     */
    readonly sources = ['content-drafts'];

    /** Every language: the editor is the same document whichever one matched. */
    readonly lang = 'all';
}
