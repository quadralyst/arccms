import { Component, effect, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** The details of one image or file, as the panel edits them. */
export interface MediaDetailsValue {
    id: string;
    title?: string;
    notes?: string;
    alt?: string;
}

/** One saved change: only the fields that changed. */
export type MediaDetailsChange = Partial<Pick<MediaDetailsValue, 'title' | 'notes' | 'alt'>>;

/**
 * Title, notes and (images) alt text in the media library's side panel
 * (docs/features/media.html, Details; MF-D21). Each field saves when the
 * admin leaves it, if it changed: no Save button to forget. Nothing here is
 * required; an empty title goes back to the file's name.
 */
@Component({
    selector: 'arc-media-details',
    standalone: true,
    imports: [TranslocoPipe],
    template: `
        <div class="media-details">
            <label class="media-details-field">
                <span class="metadata-label">{{ 'admin.media.details.title' | transloco }}</span>
                <input type="text" class="form-control form-control-sm" maxlength="200"
                    [attr.aria-label]="'admin.media.details.title' | transloco"
                    [value]="title()" [placeholder]="fallbackTitle()"
                    (input)="title.set($any($event.target).value)" (blur)="commit('title')"
                    (keydown.enter)="$any($event.target).blur()">
            </label>
            @if (showAlt()) {
            <label class="media-details-field">
                <span class="metadata-label">{{ 'admin.media.details.alt' | transloco }}</span>
                <input type="text" class="form-control form-control-sm" maxlength="300"
                    [attr.aria-label]="'admin.media.details.alt' | transloco"
                    [value]="alt()" (input)="alt.set($any($event.target).value)" (blur)="commit('alt')"
                    (keydown.enter)="$any($event.target).blur()">
                <span class="media-details-hint">{{ 'admin.media.details.alt_hint' | transloco }}</span>
            </label>
            }
            <label class="media-details-field">
                <span class="metadata-label">{{ 'admin.media.details.notes' | transloco }}</span>
                <textarea class="form-control form-control-sm" rows="2" maxlength="2000"
                    [attr.aria-label]="'admin.media.details.notes' | transloco"
                    [value]="notes()" (input)="notes.set($any($event.target).value)" (blur)="commit('notes')"></textarea>
                <span class="media-details-hint">{{ 'admin.media.details.notes_hint' | transloco }}</span>
            </label>
        </div>
    `,
    styles: [`
        .media-details { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.75rem; }
        .media-details-field { display: flex; flex-direction: column; gap: 0.2rem; margin: 0; }
        .media-details-field .metadata-label { font-size: 0.78rem; }
        .media-details-hint { font-size: 0.72rem; color: #6c757d; line-height: 1.3; }
        textarea { resize: vertical; }
    `],
})
export class MediaDetailsComponent {
    readonly item = input.required<MediaDetailsValue>();
    /** Images only: files have no alt text. */
    readonly showAlt = input(false);
    /** Shown in an empty title, and used when the title is cleared. */
    readonly fallbackTitle = input('');

    readonly changed = output<MediaDetailsChange>();

    readonly title = signal('');
    readonly notes = signal('');
    readonly alt = signal('');

    /** The values last saved (or loaded), so an unchanged field saves nothing. */
    private saved: Required<MediaDetailsChange> = { title: '', notes: '', alt: '' };
    private itemId = '';

    constructor() {
        effect(() => {
            const item = this.item();
            // A new item resets the fields; the same item reloaded after a save keeps what is typed.
            if (item.id === this.itemId) return;
            this.itemId = item.id;
            this.saved = { title: item.title ?? '', notes: item.notes ?? '', alt: item.alt ?? '' };
            this.title.set(this.saved.title);
            this.notes.set(this.saved.notes);
            this.alt.set(this.saved.alt);
        });
    }

    commit(field: keyof MediaDetailsChange): void {
        const value = this[field]().trim();
        if (field === 'title' && !value) {
            // A title cannot be empty: it is the link text. Back to the file's name.
            this.title.set(this.fallbackTitle());
            if (this.saved.title === this.fallbackTitle()) return;
            this.saved.title = this.fallbackTitle();
            this.changed.emit({ title: this.fallbackTitle() });
            return;
        }
        if (value === this.saved[field]) return;
        this.saved[field] = value;
        this[field].set(value);
        this.changed.emit({ [field]: value });
    }
}
