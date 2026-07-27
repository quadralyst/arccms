import { CommonModule } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
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

@Component({
    selector: 'arc-confirmation-popup',
    standalone: true,
    imports: [MatButtonModule, MatDialogActions, MatDialogClose, MatDialogTitle, MatDialogContent, CommonModule, TranslocoPipe],
    templateUrl: './confirmation-popup.component.html',
    styleUrl: './confirmation-popup.component.scss',
})
export class ConfirmationPopupComponent {
    readonly _DIALOG_DATA = inject<any>(MAT_DIALOG_DATA);
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
        return key ? this.transloco.translate(key) : this._DIALOG_DATA?.dialogType;
    }

    confirm() {
        this.dialogRef.close(true);
    }
}
