/**
 * A full list of search results, for the two results pages.
 *
 * Renders what the search box's dropdown renders, at page size: title with
 * matches highlighted, badge, snippet, and the fallback note. Navigation is
 * the caller's choice, the way it is for the search box.
 */

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SearchResult, highlightSegments } from '../../models/search.model';

@Component({
    selector: 'arc-search-results',
    standalone: true,
    imports: [RouterLink, NgTemplateOutlet],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (fallbackUsed) {
            <p class="arc-results__note">{{ showingForText.replace('{{term}}', fallbackUsed) }}</p>
        }
        @if (loading) {
            <p class="arc-results__state"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> {{ loadingText }}</p>
        } @else if (!results.length) {
            <p class="arc-results__state">{{ emptyText }}</p>
        } @else {
            <ol class="arc-results">
                @for (result of results; track result.source + result.docId + result.lang) {
                    <li class="arc-results__item">
                        @if (navigation === 'router') {
                            <a class="arc-results__title" [routerLink]="result.link" (click)="picked.emit(result)">
                                <ng-container *ngTemplateOutlet="title; context: { $implicit: result }"></ng-container>
                            </a>
                        } @else {
                            <a class="arc-results__title" [href]="result.link" (click)="picked.emit(result)">
                                <ng-container *ngTemplateOutlet="title; context: { $implicit: result }"></ng-container>
                            </a>
                        }
                        @if (result.badge) { <span class="arc-results__badge">{{ result.badge }}</span> }
                        @if (result.snippet) {
                            <p class="arc-results__snippet">@for (seg of segments(result.snippet, result.highlights?.snippet); track $index) {@if (seg.hit) {<mark>{{ seg.text }}</mark>} @else {{{ seg.text }}}}</p>
                        }
                    </li>
                }
            </ol>
        }

        <ng-template #title let-result>
            @for (seg of segments(result.title, result.highlights?.title); track $index) {@if (seg.hit) {<mark>{{ seg.text }}</mark>} @else {{{ seg.text }}}}
        </ng-template>
    `,
    styles: [`
        :host { display: block; }
        .arc-results { list-style: none; margin: 0; padding: 0; }
        .arc-results__item { padding: 14px 0; border-bottom: 1px solid #eef0f2; }
        .arc-results__item:last-child { border-bottom: 0; }
        .arc-results__title { font-size: 17px; font-weight: 600; color: #0066cc; text-decoration: none; }
        .arc-results__title:hover { text-decoration: underline; }
        .arc-results__badge {
            display: inline-block; margin-left: 8px; vertical-align: middle;
            font-size: 11px; font-weight: 600; color: #495057; background: #f1f3f5;
            border-radius: 999px; padding: 2px 8px; white-space: nowrap;
        }
        .arc-results__snippet { margin: 4px 0 0; color: #555; font-size: 14px; line-height: 1.5; }
        .arc-results mark { background: transparent; color: inherit; font-weight: 700; padding: 0; }
        .arc-results__title mark { color: #004a99; }
        .arc-results__note, .arc-results__state { color: #6e6e73; font-size: 14px; margin: 0 0 12px; }
    `],
})
export class SearchResultsComponent {
    @Input() results: SearchResult[] = [];
    @Input() loading = false;
    @Input() fallbackUsed?: string | null;
    @Input() navigation: 'router' | 'location' = 'router';
    @Input() loadingText = 'Searching...';
    @Input() emptyText = 'No results';
    @Input() showingForText = 'Showing results for "{{term}}"';
    @Output() picked = new EventEmitter<SearchResult>();

    segments(text: string, ranges?: [number, number][]) {
        return highlightSegments(text, ranges);
    }
}
