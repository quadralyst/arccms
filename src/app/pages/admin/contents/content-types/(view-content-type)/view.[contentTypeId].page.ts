import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, inject, Input, input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { BaseComponent } from '../../../../../../shared/components/base/base.component';
import { ContentType } from '../content-types.model';
import { ContentTypesStore } from '../content-types.store';
import { roleGuard } from '../../../../../guards/role.guard';

export interface TemplateAttr {
    key: string;
    label: string;
    syntax: string;
    note?: string;
}

export const routeMeta: RouteMeta = {
    title: 'View Content Type | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
    providers: [],
};

@Component({
    selector: 'arc-view-content-type',
    standalone: true,
    imports: [CommonModule, MatIconModule],
    templateUrl: './view-content-type.html',
    styleUrl: './view-content-type.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewContentTypeComponent extends BaseComponent {
    @Output() close = new EventEmitter();
    contentTypesStore = inject(ContentTypesStore);
    action = input('action');
    currentItem: ContentType | null = null;

    #id = '';
    @Input()
    get id(): string {
        return this.#id;
    }
    set id(newValue: string) {
        this.#id = newValue;

        if (this.id) {
            this.currentItem = this.contentTypesStore.get(this.id);
        }
    }

    closeView() {
        this.close.emit();
    }

    /** Copy a template attribute syntax to the clipboard */
    copiedKey: string | null = null;
    private cdr = inject(ChangeDetectorRef);
    copyToClipboard(syntax: string, key: string) {
        navigator.clipboard.writeText(syntax).then(() => {
            this.copiedKey = key;
            this.cdr.markForCheck();
            setTimeout(() => {
                this.copiedKey = null;
                this.cdr.markForCheck();
            }, 1500);
        });
    }

    // ── Template Reference Data ──────────────────────────────────

    /** Loop container attributes */
    loopAttributes: TemplateAttr[] = [
        { key: 'items', label: 'Content items', syntax: 'data-arc-loop="items"', note: 'List & partials templates' },
        { key: 'tags', label: 'Tags', syntax: 'data-arc-loop="tags"', note: 'Detail template' },
        { key: 'limit', label: 'Limit items', syntax: 'data-limit="N"', note: 'Add to loop element' },
    ];

    /** Built-in content fields available inside the items loop (list/partials) and on detail pages */
    builtInContentFields: TemplateAttr[] = [
        { key: 'title', label: 'Title', syntax: '{{ title }}' },
        { key: 'url', label: 'URL path', syntax: '{{ url }}', note: 'Computed: /{type}/{slug}' },
        { key: 'urlSlug', label: 'URL slug', syntax: '{{ urlSlug }}' },
        { key: 'coverImage', label: 'Cover image', syntax: '{{ coverImage }}' },
        { key: 'content', label: 'Content (HTML)', syntax: '[innerHTML]="content"' },
        { key: 'excerpt', label: 'Excerpt', syntax: '{{ excerpt }}', note: 'Auto-generated from content' },
        { key: 'summary', label: 'Summary', syntax: '{{ summary }}' },
        { key: 'publishedOn', label: 'Published date', syntax: '{{ publishedOn }}', note: 'Formatted' },
        { key: 'readTime', label: 'Read time (min)', syntax: '{{ readTime }}' },
        { key: 'tags', label: 'Tags array', syntax: 'data-arc-loop="tags"', note: 'Use as loop' },
        { key: 'tagsHtml', label: 'Tags (HTML pills)', syntax: '[innerHTML]="tagsHtml"' },
        { key: 'tagsDisplay', label: 'Tags (comma list)', syntax: '{{ tagsDisplay }}' },
        { key: 'isFeatured', label: 'Featured flag', syntax: 'data-arc-if="isFeatured"' },
        { key: 'id', label: 'Document ID', syntax: '{{ id }}' },
    ];

    /** Page-level fields available outside loops */
    pageFields: TemplateAttr[] = [
        { key: 'contentType', label: 'Content type name', syntax: '{{ contentType }}' },
        { key: 'contentTypeSlug', label: 'Content type slug', syntax: '{{ contentTypeSlug }}' },
        { key: 'contentTypeDescription', label: 'Description', syntax: '{{ contentTypeDescription }}' },
        { key: 'sectionTitle', label: 'Section title', syntax: '{{ sectionTitle }}', note: 'Partials only' },
    ];

    /** Fields only available on the detail template */
    detailOnlyFields: TemplateAttr[] = [
        { key: 'date', label: 'Published date (alias)', syntax: '{{ date }}' },
        { key: 'readingTime', label: 'Read time (formatted)', syntax: '{{ readingTime }}', note: 'e.g. "5 min read"' },
        { key: 'share.facebook', label: 'Share: Facebook', syntax: '{{ share.facebook }}' },
        { key: 'share.twitter', label: 'Share: Twitter', syntax: '{{ share.twitter }}' },
        { key: 'share.linkedin', label: 'Share: LinkedIn', syntax: '{{ share.linkedin }}' },
        { key: 'share.whatsapp', label: 'Share: WhatsApp', syntax: '{{ share.whatsapp }}' },
        { key: 'share.email', label: 'Share: Email', syntax: '{{ share.email }}' },
        { key: 'previousContent.title', label: 'Previous: title', syntax: '{{ previousContent.title }}' },
        { key: 'previousContent.url', label: 'Previous: URL', syntax: '{{ previousContent.url }}' },
        { key: 'nextContent.title', label: 'Next: title', syntax: '{{ nextContent.title }}' },
        { key: 'nextContent.url', label: 'Next: URL', syntax: '{{ nextContent.url }}' },
    ];

    /** Fields available inside data-arc-loop="tags" */
    tagLoopFields: TemplateAttr[] = [
        { key: 'name', label: 'Tag name', syntax: '{{ name }}' },
        { key: 'color', label: 'Tag color', syntax: '{{ color }}' },
    ];

    /** Template directives */
    directives: TemplateAttr[] = [
        { key: 'data-arc-bind', label: 'Smart bind', syntax: 'data-arc-bind="field"', note: 'Auto-detects element type' },
        { key: 'data-arc-if', label: 'Conditional', syntax: 'data-arc-if="field"', note: 'Removes element if falsy' },
        { key: 'innerHTML', label: 'HTML content', syntax: '[innerHTML]="field"' },
        { key: 'data-arc-style-background', label: 'Background color', syntax: 'data-arc-style-background="field"' },
    ];

    /** Custom fields mapped from the content type definition */
    get customFieldEntries(): TemplateAttr[] {
        if (!this.currentItem?.fields) return [];
        return this.currentItem.fields.map(f => ({
            key: f.key,
            label: f.label,
            syntax: `{{ ${f.key} }}`,
            note: f.type,
        }));
    }
}
