/**
 * Editor for a repeating custom field — the rows of an Info Card, a gallery,
 * a label/value list.
 *
 * Schema-driven rather than one component per field type: the row shape comes
 * from `REPEATER_SCHEMAS`, so a new repeating field type is a data entry, not
 * another editor to build and keep in step.
 *
 * Lives in `shared/` beside the other field controls, and reaches into the
 * Media Manager page for its picker the same way `arc-tiptap-editor` does.
 */

import { LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import MediaManagerComponent, { MediaSelection } from '../../../app/pages/admin/(media)/media.page';
import { ArcIcon, isArcIcon } from '../../models/icon.model';
import { isYouTubeUrl, youTubeVideo } from '../../utils/youtube';
import { MapPickerComponent, PickedLocation } from '../map-picker/map-picker.component';
import {
    cloneRepeaterRows,
    mediaRowKeys,
    newRepeaterRow,
    RepeaterLocationSubField,
    RepeaterMediaSubField,
    RepeaterRow,
    RepeaterSchema,
    RepeaterSubField,
    renumberRepeaterRows,
    sortRepeaterRows,
} from '../../models/repeater.model';

@Component({
    selector: 'arc-field-repeater',
    standalone: true,
    imports: [FormsModule, TranslocoPipe, LowerCasePipe, MapPickerComponent],
    templateUrl: './field-repeater.component.html',
    styleUrl: './field-repeater.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldRepeaterComponent {
    private dialog = inject(MatDialog);

    readonly schema = input.required<RepeaterSchema>();
    readonly rows = input<RepeaterRow[]>([]);
    /** Fully read-only. */
    readonly disabled = input(false);

    /**
     * Translating: the structure belongs to the default language, the words do
     * not.
     *
     * Rows cannot be added, removed or reordered and media cannot be changed,
     * but any sub-field the schema marks `translatable` stays editable. This
     * is what keeps every language's card list identical and lets a row be
     * deleted without stranding a translation on the wrong one.
     */
    readonly translating = input(false);

    /** Default-language values per row id, shown as ghost placeholders. */
    readonly basePlaceholders = input<Record<string, Record<string, unknown>>>({});

    /** Default-language heading, shown as a ghost placeholder. */
    readonly baseHeading = input('');

    /** The block's heading, when the schema declares one. */
    readonly heading = input('');

    readonly rowsChange = output<RepeaterRow[]>();
    readonly headingChange = output<string>();

    /** Rows whose video box currently holds something that is not a YouTube link. */
    private readonly videoErrors = signal<Record<string, boolean>>({});

    setHeading(value: string): void {
        this.headingChange.emit(value);
    }

    addRow(): void {
        if (this.isLocked()) return;
        const next = [...this.rows(), newRepeaterRow(this.schema(), this.nextPosition())];
        this.emit(next);
    }

    removeRow(id: string): void {
        if (this.isLocked()) return;
        // Renumbered so the remaining positions stay 1..n rather than leaving
        // a hole that reads as a missing card.
        this.emit(renumberRepeaterRows(this.rows().filter((row) => row.id !== id)));
    }

    /** Updates one sub-field of one row. */
    setValue(id: string, key: string, value: unknown): void {
        this.emit(this.rows().map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    }

    /**
     * Stages a new position without reordering.
     *
     * Re-sorting on every keystroke slides the row out from under the cursor
     * on the way from "1" to "10". The list settles on blur instead.
     */
    setPosition(id: string, raw: string): void {
        if (this.isLocked()) return;
        const parsed = Number.parseInt(raw, 10);
        if (Number.isNaN(parsed)) return;
        this.setValue(id, 'position', parsed);
    }

    /**
     * Applies the staged positions. Called on blur of a position input.
     *
     * Renumbers afterwards so the editor always shows a clean 1..n — someone
     * typing "0" to mean "put this first" sees it settle at 1, which is the
     * feedback that the reorder took effect.
     */
    commitPositions(): void {
        this.emit(renumberRepeaterRows(sortRepeaterRows(cloneRepeaterRows(this.rows()))));
    }

    /** Opens the Media Manager for a media sub-field, scoped to one row. */
    pickMedia(row: RepeaterRow, sub: RepeaterMediaSubField): void {
        if (this.isLocked()) return;

        this.openPicker(sub, false).subscribe((result: MediaSelection | null) => {
            if (result?.type !== 'submit') return;

            if (result.kind === 'icon' && result.icon && sub.iconKey) {
                this.setMedia(row.id, sub, { [sub.iconKey]: result.icon });
            } else if (result.mediaUrl) {
                this.setMedia(row.id, sub, { [sub.key]: result.mediaUrl });
            }
        });
    }

    /**
     * Picks several images at once and appends a row for each.
     *
     * Field-level rather than per-row: the point is to turn twelve clicks into
     * one, which only works if the picker creates the rows itself.
     */
    addFromLibrary(sub: RepeaterMediaSubField): void {
        if (this.isLocked()) return;

        this.openPicker(sub, true).subscribe((result: MediaSelection | null) => {
            if (result?.type !== 'submit') return;

            const urls = result.mediaUrls?.length
                ? result.mediaUrls
                : result.mediaUrl ? [result.mediaUrl] : [];
            if (!urls.length) return;

            let next = this.nextPosition();
            const added = urls.map((url) => {
                const created = newRepeaterRow(this.schema(), next++);
                created[sub.key] = url;
                return created;
            });

            this.emit([...this.rows(), ...added]);
        });
    }

    /** Stores a pasted YouTube URL, or clears the slot when the box is emptied. */
    setVideo(row: RepeaterRow, sub: RepeaterMediaSubField, raw: string): void {
        if (!sub.videoKey || this.isLocked()) return;

        const trimmed = raw.trim();
        if (!trimmed) {
            this.setMedia(row.id, sub, {});
            return;
        }

        // Rejected at entry rather than stored: an unparseable URL would
        // publish as a blank frame with nothing to explain it.
        if (!isYouTubeUrl(trimmed)) {
            this.videoErrors.update((errors) => ({ ...errors, [row.id]: true }));
            return;
        }

        this.videoErrors.update(({ [row.id]: _dropped, ...rest }) => rest);
        this.setMedia(row.id, sub, { [sub.videoKey]: trimmed });
    }

    clearMedia(row: RepeaterRow, sub: RepeaterMediaSubField): void {
        if (this.isLocked()) return;
        this.videoErrors.update(({ [row.id]: _dropped, ...rest }) => rest);
        this.setMedia(row.id, sub, {});
    }

    /** Stores a point placed in the map picker. */
    setLocation(row: RepeaterRow, sub: RepeaterLocationSubField, picked: PickedLocation): void {
        if (this.isLocked() && !this.canEdit(sub)) return;

        this.emit(this.rows().map((r) => (r.id === row.id ? {
            ...r,
            [sub.key]: picked.address,
            [sub.latKey]: picked.lat,
            [sub.lngKey]: picked.lng,
            [sub.zoomKey]: picked.zoom,
        } : r)));
    }

    clearLocation(row: RepeaterRow, sub: RepeaterLocationSubField): void {
        if (this.isLocked()) return;

        const cleared: Record<string, unknown> = { [sub.key]: '' };
        for (const key of [sub.latKey, sub.lngKey, sub.zoomKey]) cleared[key] = null;

        this.emit(this.rows().map((r) => (r.id === row.id ? { ...r, ...cleared } : r)));
    }

    /** Narrowing helper — the template cannot discriminate a union on its own. */
    asLocation(sub: RepeaterSubField): RepeaterLocationSubField {
        return sub as RepeaterLocationSubField;
    }

    /** A row's stored coordinate, or null when no point is placed. */
    coordinate(row: RepeaterRow, key: string): number | null {
        const value = row[key];
        return typeof value === 'number' ? value : null;
    }

    /**
     * Writes one alternative onto a row and blanks the others.
     *
     * An image, an icon and a video are alternatives, not a set — a row
     * carrying two would render two visuals through the template's
     * `data-arc-if` pair.
     */
    private setMedia(rowId: string, sub: RepeaterMediaSubField, chosen: Record<string, unknown>): void {
        const cleared: Record<string, unknown> = {};
        for (const key of mediaRowKeys(sub)) {
            cleared[key] = key === sub.iconKey ? null : '';
        }

        this.emit(this.rows().map((r) =>
            r.id === rowId ? { ...r, ...cleared, ...chosen } : r,
        ));
    }

    private openPicker(sub: RepeaterMediaSubField, multiple: boolean) {
        const allowImages = sub.allowImages !== false;
        const allowIcons = sub.allowIcons === true;

        return this.dialog.open(MediaManagerComponent, {
            enterAnimationDuration: '450ms',
            exitAnimationDuration: '300ms',
            minWidth: '134vh',
            maxHeight: '90vh',
            panelClass: 'common-dialog-box',
            disableClose: true,
            data: {
                isDialogOpen: true,
                allowImages,
                allowIcons: multiple ? false : allowIcons,
                multiple,
                // Only meaningful when both are on; ignored otherwise.
                initialTab: allowImages ? undefined : 'icons',
            },
        }).afterClosed();
    }

    // ── Template helpers ────────────────────────────────────────────────────

    /** The image URL on a row, or '' when it holds an icon or nothing. */
    imageUrl(row: RepeaterRow, sub: RepeaterMediaSubField): string {
        const value = row[sub.key];
        return typeof value === 'string' ? value : '';
    }

    /** The icon token on a row, or null. */
    icon(row: RepeaterRow, sub: RepeaterMediaSubField): ArcIcon | null {
        const value = sub.iconKey ? row[sub.iconKey] : null;
        return isArcIcon(value) ? value : null;
    }

    /** The stored YouTube URL on a row, or ''. */
    videoUrl(row: RepeaterRow, sub: RepeaterMediaSubField): string {
        const value = sub.videoKey ? row[sub.videoKey] : '';
        return typeof value === 'string' ? value : '';
    }

    /** Poster image for a row's video, for the editor preview. */
    videoThumb(row: RepeaterRow, sub: RepeaterMediaSubField): string {
        return youTubeVideo(this.videoUrl(row, sub))?.thumb ?? '';
    }

    hasMedia(row: RepeaterRow, sub: RepeaterMediaSubField): boolean {
        return !!this.imageUrl(row, sub) || !!this.icon(row, sub) || !!this.videoUrl(row, sub);
    }

    /** True when the last paste into this row's video box was not a YouTube link. */
    hasVideoError(row: RepeaterRow): boolean {
        return !!this.videoErrors()[row.id];
    }

    /** The media sub-field offering bulk add, if the schema has one. */
    bulkAddField(): RepeaterMediaSubField | null {
        const sub = this.schema().subFields.find(
            (s): s is RepeaterMediaSubField => s.type === 'media' && s.allowBulkAdd === true,
        );
        return sub ?? null;
    }

    /** String value of a text or textarea sub-field. */
    text(row: RepeaterRow, sub: RepeaterSubField): string {
        const value = row[sub.key];
        return typeof value === 'string' ? value : '';
    }

    /** No structural edits: fully disabled, or translating another language. */
    isLocked(): boolean {
        return this.disabled() || this.translating();
    }

    /** Whether this sub-field's box is editable right now. */
    canEdit(sub: RepeaterSubField): boolean {
        if (this.disabled()) return false;
        return this.translating() ? sub.translatable === true : true;
    }

    /** Whether the heading box is editable right now. */
    canEditHeading(): boolean {
        if (this.disabled()) return false;
        return this.translating() ? this.schema().heading?.translatable === true : true;
    }

    /** The default-language text for a box, shown when the translation is blank. */
    placeholderFor(row: RepeaterRow, sub: RepeaterSubField): string {
        if (!this.translating()) return sub.placeholder ?? '';
        const value = this.basePlaceholders()[row.id]?.[sub.key];
        return typeof value === 'string' ? value : '';
    }

    /** True when a row's sub-fields sit side by side rather than stacked. */
    isInline(): boolean {
        return this.schema().layout === 'inline';
    }

    /** Narrowing helper — the template cannot discriminate a union on its own. */
    asMedia(sub: RepeaterSubField): RepeaterMediaSubField {
        return sub as RepeaterMediaSubField;
    }

    trackRow = (_: number, row: RepeaterRow) => row.id;

    private nextPosition(): number {
        const positions = this.rows().map((row) => row.position).filter((p) => typeof p === 'number');
        return positions.length ? Math.max(...positions) + 1 : 1;
    }

    private emit(rows: RepeaterRow[]): void {
        this.rowsChange.emit(rows);
    }
}

