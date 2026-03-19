import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ContentType } from '../../content-types/content-types.model';
import { GlobalService } from '../../../../../../shared/services/global.service';

@Component({
  selector: 'app-preview-content',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  providers: [DatePipe],
  templateUrl: './preview-content.component.html',
  styleUrl: './preview-content.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewContentComponent {
  @Output() close = new EventEmitter<void>();
  
  // Using input signals
  contentItem = input.required<any>();
  contentType = input.required<ContentType | null>();

  globalService = inject(GlobalService);

  closeView() {
    this.close.emit();
  }

  // Helper to get field label
  getFieldLabel(key: string): string {
    const type = this.contentType();
    if (!type || !type.fields) return key;
    const field = type.fields.find(f => f.key === key);
    return field ? field.label : key;
  }

  // Helper to format value based on field type
  formatValue(key: string, value: any): string {
    if (value === null || value === undefined) return '';
    
    const type = this.contentType();
    if (!type || !type.fields) return String(value);
    
    const field = type.fields.find(f => f.key === key);
    if (!field) return String(value);

    // Handle boolean
    if (field.type === 'boolean' || typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    // Handle date
    if (field.type === 'date') {
       // Reuse global service or date pipe logic if needed, 
       // but for now let's use globalService helper if available or simple string
       return this.globalService.convertMillisecondsToFormatDate(value, 'dd MMM yyyy, HH:mm') || String(value);
    }
    
    // Handle references is bit complex as we might only have ID or object.
    // The table logic handled this by looking at `customFields['_ref_' + key]`.
    // We should check if we have the expanded ref data in the item.
    if (field.useCollectionRef) {
       const refKey = `_ref_${key}`;
       // The parent component might pass whole row which includes _ref_ keys
       const refData = this.contentItem()?.customFields?.[refKey];
       const displayField = field.collectionRef?.displayField || 'title';
       
       if (Array.isArray(refData)) {
          return refData.map((item: any) => item[displayField] || item.id).join(', ');
        } else if (refData && typeof refData === 'object') {
          return refData[displayField] || refData.id || '';
        }
    }

    return String(value);
  }

  // Get only custom fields that are defined in content type
  getDisplayFields() {
    const type = this.contentType();
    if (!type || !type.fields) return [];
    return type.fields;
  }

  isRichText(type: string): boolean {
    return type === 'richtext' || (type as string) === 'rich-text';
  }
}
