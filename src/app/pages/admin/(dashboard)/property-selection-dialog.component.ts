import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';

interface PropertyOption {
  propertyId: string;
  displayName: string;
  accountName?: string;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Select GA4 Property</h2>
    <mat-dialog-content>
      <p class="text-muted mb-3">
        We couldn't auto-detect which property matches your site.
        Please select the GA4 property to connect:
      </p>
      <mat-radio-group [(ngModel)]="selectedPropertyId" class="d-flex flex-column gap-2">
        @for (prop of sortedProperties; track prop.propertyId) {
        <mat-radio-button [value]="prop.propertyId">
          <span class="fw-medium">{{ prop.displayName }}</span>
          <span class="text-muted ms-2">({{ prop.propertyId }})</span>
          @if (prop.accountName) {
          <br /><small class="text-muted">Account: {{ prop.accountName }}</small>
          }
        </mat-radio-button>
        }
      </mat-radio-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        color="primary"
        [mat-dialog-close]="getSelectedProperty()"
        [disabled]="!selectedPropertyId"
      >
        Connect
      </button>
    </mat-dialog-actions>
  `,
})
export class PropertySelectionDialogComponent {
  data: { properties: PropertyOption[] } = inject(MAT_DIALOG_DATA);
  sortedProperties = this.data.properties.slice().sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
  selectedPropertyId = '';

  getSelectedProperty(): PropertyOption | null {
    return this.data.properties.find((p) => p.propertyId === this.selectedPropertyId) || null;
  }
}
