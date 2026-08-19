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
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import MediaManagerComponent, { MediaSelection } from '../../../app/pages/admin/(media)/media.page';
import { ArcIcon, isArcIcon } from '../../models/icon.model';
import {
    cloneRepeaterRows,
    newRepeaterRow,
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
    imports: [FormsModule, TranslocoPipe, LowerCasePipe],
    templateUrl: './field-repeater.component.html',
    styleUrl: './field-repeater.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldRepeaterComponent {
    private dialog = inject(MatDialog);

    readonly schema = input.required<RepeaterSchema>();
    readonly rows = input<RepeaterRow[]>([]);
    /** Locked while translating — structure belongs to the default language. */
    readonly disabled = input(false);

    readonly rowsChange = output<RepeaterRow[]>();

    addRow(): void {
        const next = [...this.rows(), newRepeaterRow(this.schema(), this.nextPosition())];
        this.emit(next);
    }

    removeRow(id: string): void {
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
        if (this.disabled()) return;

        const allowImages = sub.allowImages !== false;
        const allowIcons = sub.allowIcons === true;

        const dialogRef = this.dialog.open(MediaManagerComponent, {
            enterAnimationDuration: '450ms',
            exitAnimationDuration: '300ms',
            minWidth: '134vh',
            maxHeight: '90vh',
            panelClass: 'common-dialog-box',
            disableClose: true,
            data: {
                isDialogOpen: true,
                allowImages,
                allowIcons,
                // Only meaningful when both are on; ignored otherwise.
                initialTab: allowImages ? undefined : 'icons',
            },
        });

        dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
            if (result?.type !== 'submit') return;

            // An image and an icon are alternatives, not a pair — picking one
            // clears the other, or a row would carry both and the template's
            // data-arc-if would render two visuals.
            if (result.kind === 'icon' && result.icon) {
                this.emit(this.rows().map((r) =>
                    r.id === row.id ? { ...r, [sub.key]: '', [sub.iconKey]: result.icon } : r,
                ));
            } else if (result.mediaUrl) {
                this.emit(this.rows().map((r) =>
                    r.id === row.id ? { ...r, [sub.key]: result.mediaUrl, [sub.iconKey]: null } : r,
                ));
            }
        });
    }

    clearMedia(row: RepeaterRow, sub: RepeaterMediaSubField): void {
        this.emit(this.rows().map((r) =>
            r.id === row.id ? { ...r, [sub.key]: '', [sub.iconKey]: null } : r,
        ));
    }

    // ── Template helpers ────────────────────────────────────────────────────

    /** The image URL on a row, or '' when it holds an icon or nothing. */
    imageUrl(row: RepeaterRow, sub: RepeaterMediaSubField): string {
        const value = row[sub.key];
        return typeof value === 'string' ? value : '';
    }

    /** The icon token on a row, or null. */
    icon(row: RepeaterRow, sub: RepeaterMediaSubField): ArcIcon | null {
        const value = row[sub.iconKey];
        return isArcIcon(value) ? value : null;
    }

    hasMedia(row: RepeaterRow, sub: RepeaterMediaSubField): boolean {
        return !!this.imageUrl(row, sub) || !!this.icon(row, sub);
    }

    /** String value of a text or textarea sub-field. */
    text(row: RepeaterRow, sub: RepeaterSubField): string {
        const value = row[sub.key];
        return typeof value === 'string' ? value : '';
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
