import { CommonModule } from '@angular/common';
import { TranslocoService } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogRef,
    MatDialogTitle,
} from '@angular/material/dialog';

/**
 * What the confirmation dialog shows. Every field is optional so the callers
 * written before this type keep working unchanged.
 */
export interface ConfirmationDialogData {
    /**
     * The heading as plain text. Some callers also switch on it ('Delete',
     * 'Logout'), so it stays; `titleKey` wins when both are given.
     */
    dialogType?: string;
    /** The heading as a translation key. */
    titleKey?: string;
    /**
     * The body, rendered as HTML. Escape every name or title a person typed
     * (`escapeHtml` in src/shared/utils/escape-html.ts).
     */
    dialogMessage?: string;
    /** The confirm button's text. */
    btnText?: string;
    /** 'warn' makes the confirm button red. */
    panelType?: string;
    /** The cancel button's text. "Cancel", translated, when left out. */
    cancelText?: string;
}

/**
 * Arc CMS's question dialog, in place of the browser's `confirm()`.
 *
 * It closes with `true` on the confirm button and with nothing on Cancel,
 * Escape or a click outside. Focus starts on Cancel, so pressing Enter by
 * reflex never deletes anything.
 *
 * Open it through `ConfirmService.ask()` (confirm.service.ts), or directly with
 * `MatDialog.open(ConfirmationPopupComponent, { data })`.
 */
@Component({
    selector: 'arc-confirmation-popup',
    standalone: true,
    imports: [MatButtonModule, MatDialogActions, MatDialogClose, MatDialogTitle, MatDialogContent, CommonModule],
    templateUrl: './confirmation-popup.component.html',
    styleUrl: './confirmation-popup.component.scss',
})
export class ConfirmationPopupComponent {
    readonly _DIALOG_DATA = inject<ConfirmationDialogData>(MAT_DIALOG_DATA);
    readonly dialogRef = inject(MatDialogRef<ConfirmationPopupComponent>);
    private transloco = inject(TranslocoService);

    /**
     * The heading.
     *
     * `dialogType` is a discriminator callers switch on ('Delete', 'Logout')
     * that also happened to be shown as the title, so it cannot simply be
     * translated in place. Callers pass `titleKey` for the heading; the old
     * field remains the fallback, which keeps every existing caller working
     * and reading in English until it is swept.
     */
    get title(): string {
        const key = this._DIALOG_DATA?.titleKey;
        return key ? this.transloco.translate(key) : (this._DIALOG_DATA?.dialogType ?? '');
    }

    /** The cancel button's text: the caller's, else "Cancel" in the admin's language. */
    get cancelText(): string {
        return this._DIALOG_DATA?.cancelText || this.transloco.translate('common.actions.cancel');
    }

    confirm() {
        this.dialogRef.close(true);
    }
}
