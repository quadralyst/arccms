/**
 * The admin header's search box.
 *
 * Wraps `arc-search-box` with the admin defaults: admin scope, every source
 * but published content, every language, Cmd+K, and Transloco strings. Renders nothing for
 * anyone who is not an admin. Its own component rather than markup inside
 * the page header so that the header injects nothing new: this one is
 * created inside an @if block, on change detection, like the bell.
 *
 * Spec: docs/search-spec.md, decision S-D17 and phase S4 item 3.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import { SearchBoxComponent } from '../search-box/search-box.component';
import { isOn } from '../../../app/core/features/features';

/** Whether any source has been rebuilt: one read per session, only for an app without content. */
let rebuiltSources: Promise<boolean> | null = null;

@Component({
    selector: 'arc-admin-search',
    standalone: true,
    imports: [SearchBoxComponent, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (auth.isAdmin() && available()) {
        <arc-search-box
            scope="admin"
            [except]="except"
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
    private firestore = inject(Firestore, { optional: true });

    /**
     * Every source an admin may read (docs/feature-flags-spec.md 6.4) except
     * published content: every draft has a published twin, which would show
     * up as a duplicate, and an admin searching from a header wants the thing
     * to edit.
     */
    readonly except = isOn('content') ? ['content'] : [];

    /** Shown when there is something to search: content's drafts, or a source rebuilt from Search settings. */
    readonly available = signal(isOn('content'));

    /** Every language: the editor is the same document whichever one matched. */
    readonly lang = 'all';

    constructor() {
        if (this.available() || !this.firestore) return;
        rebuiltSources ??= getDoc(doc(this.firestore, 'Settings', 'search_status'))
            .then((snap) => Object.keys((snap.data()?.['sources'] as object | undefined) ?? {}).length > 0)
            .catch(() => false);
        void rebuiltSources.then((has) => this.available.set(has));
    }
}
