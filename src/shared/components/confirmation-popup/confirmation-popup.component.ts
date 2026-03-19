import { CommonModule } from '@angular/common';
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
    imports: [MatButtonModule, MatDialogActions, MatDialogClose, MatDialogTitle, MatDialogContent, CommonModule],
    templateUrl: './confirmation-popup.component.html',
    styleUrl: './confirmation-popup.component.scss',
})
export class ConfirmationPopupComponent {
    readonly _DIALOG_DATA = inject<any>(MAT_DIALOG_DATA);
    readonly dialogRef = inject(MatDialogRef<ConfirmationPopupComponent>);

    confirm() {
        this.dialogRef.close(true);
    }
}
