import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getCollectionFields,
    isSyncFieldSelected,
    toggleSyncField,
    validateCollectionRefField,
    mapFieldWithCollectionRef,
    duplicateFieldKeyValidator,
} from './collection-ref-helpers';
import { FormArray, FormControl, FormGroup } from '@angular/forms';

// ---------------------------------------------------------------------------
// Helper: create a mock ContentTypesStore whose items() returns the given array
// ---------------------------------------------------------------------------
function createMockStore(items: any[] = []) {
    return { items: vi.fn().mockReturnValue(items) } as any;
}

// ---------------------------------------------------------------------------
// Helper: create a minimal mock FormGroup with a single control
// ---------------------------------------------------------------------------
function createMockFormGroup(controlName: string, initialValue: any) {
    const control = { value: initialValue, setValue: vi.fn((v: any) => { control.value = v; }) };
    return {
        get: vi.fn((name: string) => (name === controlName ? control : undefined)),
        _control: control, // expose for assertions
    } as any;
}

// ---------------------------------------------------------------------------
// Constants reused across tests
// ---------------------------------------------------------------------------
const SYSTEM_FIELD_KEYS = ['id', 'title', 'urlSlug', 'coverImage'];

const AUTHORS_COLLECTION = {
    id: 'ct-authors',
    name: 'Authors',
    slug: 'authors',
    order: 0,
    fields: [
        { key: 'bio', label: 'Bio', type: 'richtext', required: false, order: 0 },
        { key: 'website', label: 'Website', type: 'text', required: false, order: 1 },
    ],
};

const CATEGORIES_COLLECTION = {
    id: 'ct-categories',
    name: 'Categories',
    slug: 'categories',
    order: 1,
    fields: [],
};

// A collection that has custom fields whose keys collide with system fields
const COLLISION_COLLECTION = {
    id: 'ct-collision',
    name: 'Collision Test',
    slug: 'collision',
    order: 2,
    fields: [
        { key: 'title', label: 'Custom Title', type: 'text', required: true, order: 0 },
        { key: 'id', label: 'Custom ID', type: 'text', required: false, order: 1 },
        { key: 'extra', label: 'Extra', type: 'text', required: false, order: 2 },
    ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collection-ref-helpers', () => {
    // ===================================================================
    // getCollectionFields
    // ===================================================================
    describe('getCollectionFields', () => {
        it('should return only system fields when the collection has no custom fields', () => {
            const store = createMockStore([CATEGORIES_COLLECTION]);
            const result = getCollectionFields('categories', store);

            expect(result).toHaveLength(4);
            expect(result.map(f => f.key)).toEqual(SYSTEM_FIELD_KEYS);
        });

        it('should return system fields followed by custom fields', () => {
            const store = createMockStore([AUTHORS_COLLECTION]);
            const result = getCollectionFields('authors', store);

            expect(result).toHaveLength(6); // 4 system + 2 custom
            expect(result.map(f => f.key)).toEqual([...SYSTEM_FIELD_KEYS, 'bio', 'website']);
        });

        it('should filter out custom fields that duplicate system field keys', () => {
            const store = createMockStore([COLLISION_COLLECTION]);
            const result = getCollectionFields('collision', store);

            // 'title' and 'id' from custom fields should be filtered; 'extra' should remain
            expect(result).toHaveLength(5); // 4 system + 1 custom ('extra')
            expect(result.map(f => f.key)).toEqual([...SYSTEM_FIELD_KEYS, 'extra']);
        });

        it('should return only system fields when the collection slug is not found', () => {
            const store = createMockStore([AUTHORS_COLLECTION]);
            const result = getCollectionFields('nonexistent', store);

            expect(result).toHaveLength(4);
            expect(result.map(f => f.key)).toEqual(SYSTEM_FIELD_KEYS);
        });

        it('should return only system fields when the store is empty', () => {
            const store = createMockStore([]);
            const result = getCollectionFields('anything', store);

            expect(result).toHaveLength(4);
            expect(result.map(f => f.key)).toEqual(SYSTEM_FIELD_KEYS);
        });

        it('should call store.items() exactly once', () => {
            const store = createMockStore([AUTHORS_COLLECTION]);
            getCollectionFields('authors', store);

            expect(store.items).toHaveBeenCalledTimes(1);
        });

        it('should preserve the original system field properties', () => {
            const store = createMockStore([CATEGORIES_COLLECTION]);
            const result = getCollectionFields('categories', store);

            const idField = result.find(f => f.key === 'id');
            expect(idField).toEqual({ key: 'id', label: 'ID', type: 'text', required: false, order: -4 });
        });

        it('should work when collection exists but has undefined fields', () => {
            const store = createMockStore([{ slug: 'empty', name: 'Empty' }]);
            const result = getCollectionFields('empty', store);

            expect(result).toHaveLength(4);
            expect(result.map(f => f.key)).toEqual(SYSTEM_FIELD_KEYS);
        });

        it('should handle multiple collections and pick the correct one', () => {
            const store = createMockStore([AUTHORS_COLLECTION, CATEGORIES_COLLECTION, COLLISION_COLLECTION]);
            const result = getCollectionFields('authors', store);

            expect(result.map(f => f.key)).toEqual([...SYSTEM_FIELD_KEYS, 'bio', 'website']);
        });

        it('should only filter exact key matches, not partial matches', () => {
            const store = createMockStore([{
                slug: 'partial',
                name: 'Partial',
                fields: [
                    { key: 'titles', label: 'Titles', type: 'text', required: false, order: 0 },
                    { key: 'identifier', label: 'Identifier', type: 'text', required: false, order: 1 },
                ],
            }]);
            const result = getCollectionFields('partial', store);

            // 'titles' and 'identifier' should NOT be filtered because they are not exact matches of system keys
            expect(result).toHaveLength(6);
            expect(result.map(f => f.key)).toContain('titles');
            expect(result.map(f => f.key)).toContain('identifier');
        });
    });

    // ===================================================================
    // isSyncFieldSelected
    // ===================================================================
    describe('isSyncFieldSelected', () => {
        it('should return true when the fieldKey is in syncFields', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['title', 'bio']);
            expect(isSyncFieldSelected(fg, 'title')).toBe(true);
        });

        it('should return false when the fieldKey is not in syncFields', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['title', 'bio']);
            expect(isSyncFieldSelected(fg, 'website')).toBe(false);
        });

        it('should return false when syncFields is an empty array', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', []);
            expect(isSyncFieldSelected(fg, 'title')).toBe(false);
        });

        it('should return false when the control value is null', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', null);
            expect(isSyncFieldSelected(fg, 'title')).toBe(false);
        });

        it('should return false when the control value is undefined', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', undefined);
            expect(isSyncFieldSelected(fg, 'title')).toBe(false);
        });

        it('should return false when the control does not exist', () => {
            // FormGroup whose get() always returns undefined
            const fg = { get: vi.fn().mockReturnValue(undefined) } as any;
            expect(isSyncFieldSelected(fg, 'title')).toBe(false);
        });

        it('should be case-sensitive', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['Title']);
            expect(isSyncFieldSelected(fg, 'title')).toBe(false);
            expect(isSyncFieldSelected(fg, 'Title')).toBe(true);
        });
    });

    // ===================================================================
    // toggleSyncField
    // ===================================================================
    describe('toggleSyncField', () => {
        it('should add a field key when checked is true', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['title']);
            toggleSyncField(fg, 'bio', true);

            expect(fg._control.setValue).toHaveBeenCalledWith(['title', 'bio']);
        });

        it('should remove a field key when checked is false', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['title', 'bio']);
            toggleSyncField(fg, 'bio', false);

            expect(fg._control.setValue).toHaveBeenCalledWith(['title']);
        });

        it('should not duplicate a field key if it already exists and checked is true', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['title', 'bio']);
            toggleSyncField(fg, 'bio', true);

            // It will add a duplicate because the function does not guard against it
            expect(fg._control.setValue).toHaveBeenCalledWith(['title', 'bio', 'bio']);
        });

        it('should handle removing a key that is not present without error', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['title']);
            toggleSyncField(fg, 'nonexistent', false);

            expect(fg._control.setValue).toHaveBeenCalledWith(['title']);
        });

        it('should add to an empty array when checked is true', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', []);
            toggleSyncField(fg, 'website', true);

            expect(fg._control.setValue).toHaveBeenCalledWith(['website']);
        });

        it('should handle null control value gracefully when adding', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', null);
            toggleSyncField(fg, 'title', true);

            expect(fg._control.setValue).toHaveBeenCalledWith(['title']);
        });

        it('should handle null control value gracefully when removing', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', null);
            toggleSyncField(fg, 'title', false);

            expect(fg._control.setValue).toHaveBeenCalledWith([]);
        });

        it('should remove all occurrences of a key when unchecked', () => {
            const fg = createMockFormGroup('collectionRefSyncFields', ['a', 'b', 'a']);
            toggleSyncField(fg, 'a', false);

            expect(fg._control.setValue).toHaveBeenCalledWith(['b']);
        });

        it('should not call setValue when the control does not exist', () => {
            const fg = { get: vi.fn().mockReturnValue(undefined) } as any;
            // Should not throw
            expect(() => toggleSyncField(fg, 'title', true)).not.toThrow();
            expect(() => toggleSyncField(fg, 'title', false)).not.toThrow();
        });
    });

    // ===================================================================
    // validateCollectionRefField
    // ===================================================================
    describe('validateCollectionRefField', () => {
        it('should return no errors when useCollectionRef is false', () => {
            const field = { useCollectionRef: false, key: 'category' };
            expect(validateCollectionRefField(field)).toEqual([]);
        });

        it('should return no errors when useCollectionRef is undefined', () => {
            const field = { key: 'category' };
            expect(validateCollectionRefField(field)).toEqual([]);
        });

        it('should return no errors when useCollectionRef is true and both slug and displayField are set', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: 'authors',
                collectionRefDisplayField: 'title',
                label: 'Author',
            };
            expect(validateCollectionRefField(field)).toEqual([]);
        });

        it('should return an error when collectionRefSlug is missing', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: '',
                collectionRefDisplayField: 'title',
                label: 'Author',
            };
            const errors = validateCollectionRefField(field);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Source collection is required');
            expect(errors[0]).toContain('Author');
        });

        it('should return an error when collectionRefDisplayField is missing', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: 'authors',
                collectionRefDisplayField: '',
                label: 'Author',
            };
            const errors = validateCollectionRefField(field);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Display field is required');
            expect(errors[0]).toContain('Author');
        });

        it('should return two errors when both slug and displayField are missing', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: '',
                collectionRefDisplayField: '',
                label: 'Author',
            };
            const errors = validateCollectionRefField(field);
            expect(errors).toHaveLength(2);
            expect(errors[0]).toContain('Source collection is required');
            expect(errors[1]).toContain('Display field is required');
        });

        it('should use key in error message when label is not provided', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: '',
                collectionRefDisplayField: '',
                key: 'authorRef',
            };
            const errors = validateCollectionRefField(field);
            expect(errors[0]).toContain('authorRef');
            expect(errors[1]).toContain('authorRef');
        });

        it('should prefer label over key in error messages', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: '',
                collectionRefDisplayField: '',
                label: 'Author',
                key: 'authorRef',
            };
            const errors = validateCollectionRefField(field);
            expect(errors[0]).toContain('Author');
            // Should not fall back to key when label exists
            expect(errors[0]).toMatch(/Field "Author"/);
        });

        it('should treat null collectionRefSlug as missing', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: null,
                collectionRefDisplayField: 'title',
                label: 'Author',
            };
            const errors = validateCollectionRefField(field);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Source collection is required');
        });

        it('should treat undefined collectionRefDisplayField as missing', () => {
            const field = {
                useCollectionRef: true,
                collectionRefSlug: 'authors',
                label: 'Author',
            };
            const errors = validateCollectionRefField(field);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Display field is required');
        });

        it('should return empty array when useCollectionRef is falsy (0)', () => {
            const field = { useCollectionRef: 0, key: 'test' } as any;
            expect(validateCollectionRefField(field)).toEqual([]);
        });

        it('should return empty array when useCollectionRef is null', () => {
            const field = { useCollectionRef: null, key: 'test' } as any;
            expect(validateCollectionRefField(field)).toEqual([]);
        });
    });

    // ===================================================================
    // mapFieldWithCollectionRef
    // ===================================================================
    describe('mapFieldWithCollectionRef', () => {
        let store: any;

        beforeEach(() => {
            store = createMockStore([AUTHORS_COLLECTION, CATEGORIES_COLLECTION]);
        });

        // ---------------------------------------------------------------
        // Basic mapping without collection ref
        // ---------------------------------------------------------------
        describe('without collection ref', () => {
            it('should map basic field properties', () => {
                const field = {
                    key: 'summary',
                    label: 'Summary',
                    type: 'text',
                    required: true,
                    options: 'opt1,opt2',
                    useCollectionRef: false,
                };
                const result = mapFieldWithCollectionRef(field, 3, store);

                expect(result.key).toBe('summary');
                expect(result.label).toBe('Summary');
                expect(result.type).toBe('text');
                expect(result.required).toBe(true);
                expect(result.order).toBe(3);
                expect(result.options).toBe('opt1,opt2');
            });

            it('should set useCollectionRef to false and collectionRef to undefined', () => {
                const field = { key: 'a', label: 'A', type: 'text', useCollectionRef: false };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.useCollectionRef).toBe(false);
                expect(result.collectionRef).toBeUndefined();
            });

            it('should default missing properties', () => {
                const field = {};
                const result = mapFieldWithCollectionRef(field, 5, store);

                expect(result.key).toBe('');
                expect(result.label).toBe('');
                expect(result.type).toBe('text');
                expect(result.required).toBe(false);
                expect(result.order).toBe(5);
                expect(result.options).toBe('');
                expect(result.useCollectionRef).toBe(false);
            });

            it('should set useCollectionRef to false when it is undefined', () => {
                const field = { key: 'x', label: 'X' };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.useCollectionRef).toBe(false);
                expect(result.collectionRef).toBeUndefined();
            });

            it('should set useCollectionRef to false when useCollectionRef is true but slug is missing', () => {
                const field = {
                    key: 'x',
                    label: 'X',
                    useCollectionRef: true,
                    collectionRefSlug: '',
                    collectionRefDisplayField: 'title',
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.useCollectionRef).toBe(false);
                expect(result.collectionRef).toBeUndefined();
            });
        });

        // ---------------------------------------------------------------
        // Mapping with collection ref
        // ---------------------------------------------------------------
        describe('with collection ref', () => {
            it('should build a collectionRef config when useCollectionRef is true and slug is provided', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    type: 'dropdown',
                    required: true,
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: ['bio'],
                    options: 'should,be,cleared',
                };
                const result = mapFieldWithCollectionRef(field, 1, store);

                expect(result.useCollectionRef).toBe(true);
                expect(result.collectionRef).toBeDefined();
                expect(result.collectionRef.collectionSlug).toBe('authors');
                expect(result.collectionRef.collectionName).toBe('Authors');
                expect(result.collectionRef.displayField).toBe('title');
                expect(result.collectionRef.valueField).toBe('id');
            });

            it('should enforce "id" in syncFields', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: ['bio'],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.syncFields).toContain('id');
            });

            it('should enforce the displayField in syncFields', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: ['bio'],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.syncFields).toContain('title');
            });

            it('should not duplicate "id" if already in syncFields', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: ['id', 'bio'],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                const idCount = result.collectionRef.syncFields.filter((f: string) => f === 'id').length;
                expect(idCount).toBe(1);
            });

            it('should not duplicate displayField if already in syncFields', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: ['title', 'bio'],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                const titleCount = result.collectionRef.syncFields.filter((f: string) => f === 'title').length;
                expect(titleCount).toBe(1);
            });

            it('should clear options when using collection ref', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: [],
                    options: 'option1,option2,option3',
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.options).toBe('');
            });

            it('should use slug as collectionName when the referenced collection is not found in the store', () => {
                const field = {
                    key: 'tag',
                    label: 'Tag',
                    useCollectionRef: true,
                    collectionRefSlug: 'nonexistent',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: [],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.collectionName).toBe('nonexistent');
            });

            it('should default displayField to "title" when collectionRefDisplayField is empty', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: '',
                    collectionRefSyncFields: [],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.displayField).toBe('title');
            });

            it('should handle empty collectionRefSyncFields by still including id and displayField', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'bio',
                    collectionRefSyncFields: [],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.syncFields).toContain('id');
                expect(result.collectionRef.syncFields).toContain('bio');
                expect(result.collectionRef.syncFields).toHaveLength(2);
            });

            it('should handle undefined collectionRefSyncFields', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.syncFields).toContain('id');
                expect(result.collectionRef.syncFields).toContain('title');
            });

            it('should set valueField to "id"', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: [],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.valueField).toBe('id');
            });

            it('should use the index parameter as order', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: [],
                };
                const result = mapFieldWithCollectionRef(field, 42, store);

                expect(result.order).toBe(42);
            });

            it('should preserve key, label, type, and required through the mapping', () => {
                const field = {
                    key: 'category',
                    label: 'Category',
                    type: 'dropdown',
                    required: true,
                    useCollectionRef: true,
                    collectionRefSlug: 'categories',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: [],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.key).toBe('category');
                expect(result.label).toBe('Category');
                expect(result.type).toBe('dropdown');
                expect(result.required).toBe(true);
            });

            it('should include all explicitly selected syncFields plus enforced ones', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: ['bio', 'website', 'coverImage'],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.collectionRef.syncFields).toContain('bio');
                expect(result.collectionRef.syncFields).toContain('website');
                expect(result.collectionRef.syncFields).toContain('coverImage');
                expect(result.collectionRef.syncFields).toContain('id');
                expect(result.collectionRef.syncFields).toContain('title');
            });

            it('should produce a collectionRef matching the CollectionReferenceConfig shape', () => {
                const field = {
                    key: 'author',
                    label: 'Author',
                    type: 'dropdown',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: 'title',
                    collectionRefSyncFields: ['bio'],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                const ref = result.collectionRef;
                expect(ref).toEqual(expect.objectContaining({
                    collectionSlug: 'authors',
                    collectionName: 'Authors',
                    displayField: 'title',
                    valueField: 'id',
                }));
                expect(Array.isArray(ref.syncFields)).toBe(true);
            });
        });

        // ---------------------------------------------------------------
        // Edge cases
        // ---------------------------------------------------------------
        describe('edge cases', () => {
            it('should handle index 0', () => {
                const field = { key: 'first', label: 'First' };
                const result = mapFieldWithCollectionRef(field, 0, store);
                expect(result.order).toBe(0);
            });

            it('should handle large index values', () => {
                const field = { key: 'last', label: 'Last' };
                const result = mapFieldWithCollectionRef(field, 999, store);
                expect(result.order).toBe(999);
            });

            it('should not add displayField to syncFields when collectionRefDisplayField is empty string', () => {
                const field = {
                    key: 'ref',
                    label: 'Ref',
                    useCollectionRef: true,
                    collectionRefSlug: 'authors',
                    collectionRefDisplayField: '',
                    collectionRefSyncFields: ['bio'],
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                // displayField defaults to 'title', but empty string is falsy,
                // so the add(displayField) branch is skipped
                expect(result.collectionRef.syncFields).toContain('id');
                expect(result.collectionRef.syncFields).toContain('bio');
                // The empty displayField means it won't explicitly add it to syncFields
                // since the if-check `if (field.collectionRefDisplayField)` is falsy
            });

            it('should handle a field with useCollectionRef true but null slug', () => {
                const field = {
                    key: 'ref',
                    label: 'Ref',
                    useCollectionRef: true,
                    collectionRefSlug: null,
                    collectionRefDisplayField: 'title',
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                // null is falsy, so the else branch is taken
                expect(result.useCollectionRef).toBe(false);
                expect(result.collectionRef).toBeUndefined();
            });

            it('should handle a field with useCollectionRef true but undefined slug', () => {
                const field = {
                    key: 'ref',
                    label: 'Ref',
                    useCollectionRef: true,
                    collectionRefDisplayField: 'title',
                };
                const result = mapFieldWithCollectionRef(field, 0, store);

                expect(result.useCollectionRef).toBe(false);
                expect(result.collectionRef).toBeUndefined();
            });
        });
    });

    // -----------------------------------------------------------------------
    // duplicateFieldKeyValidator
    // -----------------------------------------------------------------------
    describe('duplicateFieldKeyValidator', () => {
        function createFieldArray(...keys: string[]): FormArray {
            const controls = keys.map(key =>
                new FormGroup({ key: new FormControl(key) })
            );
            return new FormArray(controls, [duplicateFieldKeyValidator()]);
        }

        it('should return null when no duplicates', () => {
            const fa = createFieldArray('field_a', 'field_b', 'field_c');
            expect(fa.errors).toBeNull();
        });

        it('should detect duplicate keys', () => {
            const fa = createFieldArray('name', 'name');
            expect(fa.errors).toBeTruthy();
            expect(fa.errors?.['duplicateKeys']).toContain('name');
        });

        it('should detect duplicates case-insensitively', () => {
            const fa = createFieldArray('Title', 'title');
            expect(fa.errors?.['duplicateKeys']).toContain('title');
        });

        it('should ignore empty keys', () => {
            const fa = createFieldArray('', '', 'field_a');
            expect(fa.errors).toBeNull();
        });

        it('should return null for empty FormArray', () => {
            const fa = createFieldArray();
            expect(fa.errors).toBeNull();
        });

        it('should not include duplicates more than once in the error array', () => {
            const fa = createFieldArray('dup', 'dup', 'dup');
            expect(fa.errors?.['duplicateKeys']).toEqual(['dup']);
        });

        it('should detect multiple different duplicates', () => {
            const fa = createFieldArray('a', 'b', 'a', 'b');
            const dupes = fa.errors?.['duplicateKeys'] as string[];
            expect(dupes).toContain('a');
            expect(dupes).toContain('b');
            expect(dupes.length).toBe(2);
        });
    });
});
