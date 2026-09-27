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
 * The separators a stored field key may use between the content-type slug
 * and the field's own name. Keys are written as `<slug>-<name>` now; older
 * types carry `<slug>_<name>` and are never rewritten (content refers to
 * them), so every reader accepts both.
 */
export const FIELD_KEY_SEPARATORS = ['-', '_'] as const;

/**
 * The key part a custom field gets from its name: lowercase, words joined by
 * hyphens, anything else dropped — "Field Color" → `field-color`. Admins
 * type only the name; the key is derived here and fixed once saved, so
 * content written under it is never orphaned by a rename.
 */
export function fieldKeyFromLabel(label: string | null | undefined): string {
    return (label || '')
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/** The stored form of a new field's key: `<slug>-<name>`. */
export function fullFieldKey(slug: string | null | undefined, bareKey: string): string {
    return slug && bareKey ? `${slug}-${bareKey}` : bareKey;
}

/** True when `key` already carries the content-type prefix, with either separator. */
export function hasSlugPrefix(key: string | null | undefined, slug: string | null | undefined): boolean {
    if (!key || !slug) return false;
    const value = key.toLowerCase();
    const base = slug.toLowerCase();
    return FIELD_KEY_SEPARATORS.some((sep) => value.startsWith(`${base}${sep}`) && value.length > base.length + 1);
}

/**
 * A field key without its content-type prefix. Stored keys carry the slug
 * (`awards-recognition-prize`, or `awards-recognition_prize` on older types);
 * a field still being typed does not yet. Both have to compare as the same
 * field.
 */
export function bareFieldKey(key: string | null | undefined, slug: string | null | undefined): string {
    const value = (key || '').trim().toLowerCase();
    if (!hasSlugPrefix(value, slug)) return value;
    return value.slice((slug as string).length + 1);
}

/**
 * FormArray validator that rejects two fields with the same key or the same
 * name (case-insensitive) within one content type. Keys are compared without
 * the slug prefix (see bareFieldKey) so a new "Prize" collides with a stored
 * `awards-recognition_prize`. Empty values are ignored.
 */
export function duplicateFieldKeyValidator(slug: () => string = () => ''): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
        const formArray = control as FormArray;
        const groups = formArray.controls as FormGroup[];
        const prefix = slug();

        const duplicateKeys = findDuplicates(groups.map(g => bareFieldKey(g.get('key')?.value, prefix)));
        const duplicateNames = findDuplicates(groups.map(g => (g.get('label')?.value || '').trim().toLowerCase()));

        const errors: ValidationErrors = {};
        if (duplicateKeys.length > 0) errors['duplicateKeys'] = duplicateKeys;
        if (duplicateNames.length > 0) errors['duplicateNames'] = duplicateNames;
        return Object.keys(errors).length > 0 ? errors : null;
    };
}

function findDuplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const value of values) {
        if (!value) continue;
        if (seen.has(value) && !duplicates.includes(value)) duplicates.push(value);
        seen.add(value);
    }
    return duplicates;
}
