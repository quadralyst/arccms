import { ContentTypeField, ContentTypeFieldType, CollectionReferenceConfig } from './content-types.model';
import { ContentTypesStore } from './content-types.store';
import { AbstractControl, FormArray, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';

/** System fields always available on any content type */
const SYSTEM_FIELDS: ContentTypeField[] = [
    { key: 'id', label: 'ID', type: 'text', required: false, order: -4 },
    { key: 'title', label: 'Title', type: 'text', required: false, order: -3 },
    { key: 'urlSlug', label: 'URL Slug', type: 'text', required: false, order: -2 },
    { key: 'coverImage', label: 'Cover Image', type: 'text', required: false, order: -1 },
];

/**
 * Get all fields (system + custom) for a given collection slug.
 * Used by both Add and Edit content type forms.
 */
export function getCollectionFields(collectionSlug: string, contentTypesStore: ContentTypesStore): ContentTypeField[] {
    const ct = contentTypesStore.items().find((c) => c.slug === collectionSlug);
    const customFields = ct?.fields || [];
    const filteredCustomFields = customFields.filter(f => !SYSTEM_FIELDS.some(sf => sf.key === f.key));
    return [...SYSTEM_FIELDS, ...filteredCustomFields];
}

/**
 * Check if a sync field is selected for a given field index.
 */
export function isSyncFieldSelected(fieldGroup: FormGroup, fieldKey: string): boolean {
    const syncFields = fieldGroup.get('collectionRefSyncFields')?.value || [];
    return syncFields.includes(fieldKey);
}

/**
 * Toggle a sync field on/off for a given field index.
 */
export function toggleSyncField(fieldGroup: FormGroup, fieldKey: string, checked: boolean): void {
    const control = fieldGroup.get('collectionRefSyncFields');
    const current: string[] = control?.value || [];
    if (checked) {
        control?.setValue([...current, fieldKey]);
    } else {
        control?.setValue(current.filter((k: string) => k !== fieldKey));
    }
}

/**
 * Validate collection reference configuration for a form field.
 * Returns an array of error messages (empty if valid).
 */
export function validateCollectionRefField(field: any): string[] {
    const errors: string[] = [];
    if (field.useCollectionRef) {
        if (!field.collectionRefSlug) {
            errors.push(`Field "${field.label || field.key}": Source collection is required when using collection reference.`);
        }
        if (!field.collectionRefDisplayField) {
            errors.push(`Field "${field.label || field.key}": Display field is required when using collection reference.`);
        }
    }
    return errors;
}

/**
 * Map a form field value into a ContentTypeField with collectionRef configuration.
 * Used by both Add and Edit content type onSubmit methods.
 */
export function mapFieldWithCollectionRef(
    field: any,
    index: number,
    contentTypesStore: ContentTypesStore
): any {
    const fieldData: any = {
        key: field.key || '',
        label: field.label || '',
        type: field.type || 'text',
        required: field.required || false,
        order: index,
        options: field.options || '',
        useCollectionRef: field.useCollectionRef || false,
    };

    if (field.useCollectionRef && field.collectionRefSlug) {
        const refCt = contentTypesStore.items().find((c) => c.slug === field.collectionRefSlug);

        const syncFields = new Set<string>(field.collectionRefSyncFields || []);
        syncFields.add('id');
        if (field.collectionRefDisplayField) {
            syncFields.add(field.collectionRefDisplayField);
        }

        fieldData.collectionRef = {
            collectionSlug: field.collectionRefSlug,
            collectionName: refCt?.name || field.collectionRefSlug,
            displayField: field.collectionRefDisplayField || 'title',
            valueField: 'id',
            syncFields: Array.from(syncFields),
        } as CollectionReferenceConfig;
        fieldData.options = '';
    } else {
        fieldData.useCollectionRef = false;
    }
    return fieldData;
}

/**
 * FormArray validator that checks for duplicate field keys (case-insensitive).
 * Empty keys are ignored.
 */
export function duplicateFieldKeyValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
        const formArray = control as FormArray;
        const keys = formArray.controls
            .map(c => (c as FormGroup).get('key')?.value?.trim()?.toLowerCase())
            .filter((k: string) => k);

        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const key of keys) {
            if (seen.has(key)) {
                if (!duplicates.includes(key)) {
                    duplicates.push(key);
                }
            }
            seen.add(key);
        }

        return duplicates.length > 0 ? { duplicateKeys: duplicates } : null;
    };
}
