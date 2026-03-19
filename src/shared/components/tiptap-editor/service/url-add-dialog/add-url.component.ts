import { Component, inject, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-add-youtube',
  templateUrl: './add-url.component.html',
  styles: [
    `
      ::ng-deep .mat-mdc-dialog-surface {
        border-radius: 8px !important;
      }
    `,
  ],
  standalone: true,
  imports: [
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    MatButtonModule,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
  ],
})
export class UrlAddDialog {
  readonly dialogRef = inject(MatDialogRef<UrlAddDialog>);
  readonly data = inject<any>(MAT_DIALOG_DATA);
  readonly url = model(this.data.url);

  onNoClick(): void {
    this.dialogRef.close();
  }
}
