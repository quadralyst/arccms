import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule, FormArray } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router, ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AddContentTypeComponent from './add.page';
import { ContentTypesStore } from '../content-types.store';
import { IconPickerComponent } from '../../../../../../shared/components/icon-picker/icon-picker.component';
import { ToastService } from '../../../../../../shared/services/toast.service';

describe('AddContentTypeComponent', () => {
    let component: AddContentTypeComponent;
    let fixture: ComponentFixture<AddContentTypeComponent>;
    let mockStore: any;
    let mockToastService: any;
    let mockRouter: any;

    beforeEach(async () => {
        mockStore = {
            add: vi.fn().mockReturnValue(of({})),
            isLoading: vi.fn().mockReturnValue(false),
            items: vi.fn().mockReturnValue([]),
            getAll: vi.fn(),
            checkExistingSlugUrl: vi.fn().mockResolvedValue({ exists: false, slug: '' }),
        };

        mockToastService = {
            openCustomSnackbar: vi.fn(),
        };

        mockRouter = {
            navigate: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                AddContentTypeComponent,
                ReactiveFormsModule,
                MatIconModule,
                MatSelectModule,
                IconPickerComponent,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: ContentTypesStore, useValue: mockStore },
                { provide: ToastService, useValue: mockToastService },
                { provide: Router, useValue: mockRouter },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { params: {} },
                        params: of({}),
                        queryParams: of({}),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AddContentTypeComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Form Initialization', () => {
        it('should initialize form with default values', () => {
            expect(component.addForm).toBeDefined();
            expect(component.addForm.get('name')?.value).toBe('');
            expect(component.addForm.get('description')?.value).toBe('');
            expect(component.addForm.get('slug')?.value).toBe('');
            expect(component.addForm.get('icon')?.value).toBe('fa-solid fa-folder');
            expect(component.addForm.get('order')?.value).toBe(0);
        });

        it('should initialize fields as empty FormArray', () => {
            const fields = component.addForm.get('fields') as FormArray;
            expect(fields).toBeDefined();
            expect(fields.length).toBe(0);
        });

        it('should have name as required field', () => {
            const nameControl = component.addForm.get('name');
            expect(nameControl?.hasError('required')).toBe(true);
        });

        it('should have minimum length validation for name', () => {
            const nameControl = component.addForm.get('name');
            nameControl?.setValue('ab');
            expect(nameControl?.hasError('minlength')).toBe(true);
        });

        it('should have slug as required field', () => {
            const slugControl = component.addForm.get('slug');
            slugControl?.setValue('');
            expect(slugControl?.hasError('required')).toBe(true);
        });

        it('should have pattern validation for slug', () => {
            const slugControl = component.addForm.get('slug');
            slugControl?.setValue('Invalid Slug');
            expect(slugControl?.hasError('pattern')).toBe(true);
            
            slugControl?.setValue('valid-slug-123');
            expect(slugControl?.hasError('pattern')).toBe(false);
        });
    });

    describe('Form Getters', () => {
        it('should return name control', () => {
            expect(component.name).toBe(component.addForm.get('name'));
        });

        it('should return description control', () => {
            expect(component.description).toBe(component.addForm.get('description'));
        });

        it('should return fields FormArray', () => {
            expect(component.fields).toBe(component.addForm.get('fields'));
        });
    });

    describe('ngOnInit', () => {
        it('should set domain from window location', () => {
            component.ngOnInit();
            expect(component.domain).toContain('://');
        });

        it('should clear error messages on form value change', () => {
            component.ngOnInit();
            component.errorMessages = ['Error 1', 'Error 2'];
            component.addForm.get('name')?.setValue('Test');
            expect(component.errorMessages).toEqual([]);
        });
    });

    describe('Field Management', () => {
        it('should add a new field to the form', () => {
            const initialLength = component.fields.length;
            component.addField();
            expect(component.fields.length).toBe(initialLength + 1);
        });

        it('should add field with required controls', () => {
            component.addField();
            const field = component.fields.at(0);
            expect(field.get('key')).toBeDefined();
            expect(field.get('label')).toBeDefined();
            expect(field.get('type')).toBeDefined();
            expect(field.get('required')).toBeDefined();
        });

        it('should add field with default type as text', () => {
            component.addField();
            const field = component.fields.at(0);
            expect(field.get('type')?.value).toBe('text');
        });

        it('should remove field at specified index', () => {
            component.addField();
            component.addField();
            component.addField();
            expect(component.fields.length).toBe(3);
            component.removeField(1);
            expect(component.fields.length).toBe(2);
        });

        it('should get field group at specified index', () => {
            component.addField();
            const fieldGroup = component.getFieldGroup(0);
            expect(fieldGroup).toBeDefined();
            expect(fieldGroup.get('key')).toBeDefined();
        });
    });

    describe('Slug Generation', () => {
        it('should create slug from name', async () => {
            component.addForm.get('name')?.setValue('Test Content Type');
            component.createSlug();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.addForm.get('slug')?.value).toBe('test-content-type');
        });

        it('should handle special characters in slug', async () => {
            component.addForm.get('name')?.setValue('Test @#$ Content!!!');
            component.createSlug();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.addForm.get('slug')?.value).toBe('test-content');
        });

        it('should handle multiple spaces in slug', async () => {
            component.addForm.get('name')?.setValue('Test    Multiple     Spaces');
            component.createSlug();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.addForm.get('slug')?.value).toBe('test-multiple-spaces');
        });

        it('should convert to lowercase', async () => {
            component.addForm.get('name')?.setValue('UPPERCASE TEXT');
            component.createSlug();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.addForm.get('slug')?.value).toBe('uppercase-text');
        });

        it('should trim leading/trailing hyphens', async () => {
            component.addForm.get('name')?.setValue('---Test---');
            component.createSlug();
            await new Promise(resolve => setTimeout(resolve, 0));
            const slug = component.addForm.get('slug')?.value;
            expect(slug).not.toMatch(/^-/);
            expect(slug).not.toMatch(/-$/);
        });

        it('should NOT update slug if manually edited', () => {
            component.slugManuallyEdited = true;
            component.addForm.get('name')?.setValue('New Name');

            // Should keep old slug
            component.createSlug();
            expect(component.addForm.get('slug')?.value).toBe('');

            // Set verify manual edit
            component.onSlugManualEdit();
            component.addForm.get('slug')?.setValue('manual-slug');
            component.createSlug(); // trigger
            expect(component.addForm.get('slug')?.value).toBe('manual-slug');
        });

        it('should call checkExistingSlugUrl on checkExist', async () => {
            mockStore.checkExistingSlugUrl.mockResolvedValue({ exists: false, slug: 'test-slug' });
            component.checkExist('test-slug');
            expect(mockStore.checkExistingSlugUrl).toHaveBeenCalledWith('test-slug');
            
            // Wait for promise
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.addForm.get('slug')?.value).toBe('test-slug');
        });

        it('should handle existing slug by incrementing', async () => {
            mockStore.checkExistingSlugUrl
                .mockResolvedValueOnce({ exists: true, slug: 'test-slug' })
                .mockResolvedValueOnce({ exists: false, slug: 'test-slug-1' });
            
            component.checkExist('test-slug');
            
            await new Promise(resolve => setTimeout(resolve, 10)); // Allow for two async calls
            
            expect(component.addForm.get('slug')?.value).toBe('test-slug-1');
        });

        it('should set errorSlug if slug exists and not auto-incrementing', async () => {
            mockStore.checkExistingSlugUrl.mockResolvedValue({ exists: true, slug: 'manual-slug' });
            component.onSlugManualEdit();
            component.checkExist('manual-slug');
            
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.errorSlug()).toBe(true);
        });
    });

    describe('Form Submission', () => {
        beforeEach(() => {
            component.addForm.patchValue({
                name: 'Test Type',
                slug: 'test-type',
                description: 'Test Description',
                icon: 'fa-solid fa-file',
                order: 1,
            });
        });

        it('should not submit when form is invalid', () => {
            component.addForm.get('name')?.setValue('');
            component.onSubmit();
            expect(mockStore.add).not.toHaveBeenCalled();
        });

        it('should submit when form is valid', () => {
            component.onSubmit();
            expect(mockStore.add).toHaveBeenCalled();
        });

        it('should submit with correct data structure', () => {
            component.onSubmit();
            const expectedData = {
                name: 'Test Type',
                singularName: '',
                slug: 'test-type',
                description: 'Test Description',
                icon: 'fa-solid fa-file',
                order: 1,
                hasPublicUrl: true,
                templateFolder: 'default',
                fields: [],
            };
            expect(mockStore.add).toHaveBeenCalledWith(expectedData);
        });

        it('should not include undefined values in the payload', () => {
            component.addField();
            component.fields.at(0).patchValue({
                key: 'title',
                label: 'Title',
                type: 'text',
                required: true,
                useCollectionRef: false
            });
            
            component.onSubmit();
            
            const callArgs = mockStore.add.mock.calls[0][0];
            
            // Helper function to check for undefined
            const hasUndefined = (obj: any): boolean => {
                if (obj === undefined) return true;
                if (obj === null) return false;
                if (typeof obj !== 'object') return false;
                
                return Object.values(obj).some(val => hasUndefined(val));
            };
            
            expect(hasUndefined(callArgs)).toBe(false);
        });

        it('should submit with fields data', () => {
            component.addField();
            const field = component.fields.at(0);
            field.patchValue({
                key: 'title',
                label: 'Title',
                type: 'text',
                required: true,
            });
            component.onSubmit();
            const callArgs = mockStore.add.mock.calls[0][0];
            expect(callArgs.fields).toHaveLength(1);
            expect(callArgs.fields[0].key).toBe('test-type_title');
        });

        it('should show success message on successful submission', async () => {
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Content type created successfully',
                'success',
                'check_circle'
            );
        });

        it('should reset form on successful submission', async () => {
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(component.addForm.get('name')?.value).toBeFalsy();
        });

        it('should emit close event on successful submission', async () => {
            const closeSpy = vi.fn();
            component.close.subscribe(closeSpy);
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(closeSpy).toHaveBeenCalled();
        });

        it('should show error message on submission failure', async () => {
            mockStore.add.mockReturnValue(throwError(() => new Error('Test Error')));
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Error creating content type',
                'error',
                'error'
            );
        });

        it('should focus first invalid field when form is invalid', () => {
            const focusSpy = vi.spyOn(component, 'focusFirstInvalidField');
            component.addForm.get('name')?.setValue('');
            component.onSubmit();
            expect(focusSpy).toHaveBeenCalledWith(component.addForm);
        });

        it('should populate error messages when form is invalid', () => {
            component.addForm.get('name')?.setValue('');
            component.onSubmit();
            expect(component.errorMessages.length).toBeGreaterThan(0);
        });
    });

    describe('closeAdd', () => {
        it('should reset form', () => {
            component.addForm.patchValue({
                name: 'Test',
                description: 'Test Description',
            });
            component.closeAdd();
            expect(component.addForm.get('name')?.value).toBeFalsy();
        });

        it('should emit close event', () => {
            const closeSpy = vi.fn();
            component.close.subscribe(closeSpy);
            component.closeAdd();
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe('trimUnwantedSpace', () => {
        it('should trim spaces from string values', () => {
            const control = component.addForm.get('name')!;
            control.setValue('  Test  ');
            const result = component.trimUnwantedSpace(control);
            expect(result).toBe('Test');
            expect(control.value).toBe('Test');
        });

        it('should return empty string for non-string values', () => {
            const control = component.addForm.get('order')!;
            control.setValue(123);
            const result = component.trimUnwantedSpace(control);
            expect(result).toBe('');
        });
    });

    describe('Field Types', () => {
        it('should have all required field types', () => {
            expect(component.fieldTypes).toContain('text');
            expect(component.fieldTypes).toContain('number');
            expect(component.fieldTypes).toContain('richtext');
            expect(component.fieldTypes).toContain('date');
            expect(component.fieldTypes).toContain('image');
            expect(component.fieldTypes).toContain('icon');
            expect(component.fieldTypes).toContain('infocard');
            expect(component.fieldTypes).toContain('boolean');
        });

        it('should have new field types for dropdown, checkbox, and radio', () => {
            expect(component.fieldTypes).toContain('dropdown');
            expect(component.fieldTypes).toContain('checkbox');
            expect(component.fieldTypes).toContain('radio');
        });

        it('should have 12 field types total', () => {
            expect(component.fieldTypes.length).toBe(12);
        });

        it('should include datetime field type', () => {
            expect(component.fieldTypes).toContain('datetime');
        });
    });

    describe('Field Options', () => {
        it('should add field with options FormControl', () => {
            component.addField();
            const field = component.fields.at(0);
            expect(field.get('options')).toBeDefined();
            expect(field.get('options')?.value).toBe('');
        });

        it('should save options with field data on submission', () => {
            component.addForm.patchValue({
                name: 'Test Type',
                slug: 'test-type',
            });

            component.addField();
            component.fields.at(0).patchValue({
                key: 'color',
                label: 'Color',
                type: 'dropdown',
                required: false,
                options: 'Red, Green, Blue',
            });
            component.onSubmit();
            const callArgs = mockStore.add.mock.calls[0][0];
            expect(callArgs.fields[0].options).toBe('Red, Green, Blue');
        });

        it('should save empty options for non-option field types', () => {
            component.addForm.patchValue({
                name: 'Test Type',
                slug: 'test-type',
            });

            component.addField();
            component.fields.at(0).patchValue({
                key: 'title',
                label: 'Title',
                type: 'text',
                required: false,
            });
            component.onSubmit();
            const callArgs = mockStore.add.mock.calls[0][0];
            expect(callArgs.fields[0].options).toBe('');
        });
    });

    describe('Field Order', () => {
        it('should assign order based on array index', () => {
            // Set required fields first
            component.addForm.patchValue({
                name: 'Test Type',
                slug: 'test-type',
            });

            component.addField();
            component.addField();
            component.fields.at(0).patchValue({
                key: 'field1',
                label: 'Field 1',
                type: 'text',
                required: false,
            });
            component.fields.at(1).patchValue({
                key: 'field2',
                label: 'Field 2',
                type: 'number',
                required: true,
            });
            component.onSubmit();
            const callArgs = mockStore.add.mock.calls[0][0];
            expect(callArgs.fields[0].order).toBe(0);
            expect(callArgs.fields[1].order).toBe(1);
        });
    });

    describe('Duplicate Field Key Validation', () => {
        it('should detect duplicate field keys', () => {
            component.addField();
            component.addField();
            component.fields.at(0).patchValue({ key: 'my_field', label: 'F1', type: 'text' });
            component.fields.at(1).patchValue({ key: 'my_field', label: 'F2', type: 'text' });

            expect(component.fields.errors).toBeTruthy();
            expect(component.fields.errors?.['duplicateKeys']).toContain('my_field');
        });

        it('should not flag unique field keys as duplicates', () => {
            component.addField();
            component.addField();
            component.fields.at(0).patchValue({ key: 'field_a', label: 'A', type: 'text' });
            component.fields.at(1).patchValue({ key: 'field_b', label: 'B', type: 'text' });

            expect(component.fields.errors).toBeNull();
        });

        it('should detect duplicates case-insensitively', () => {
            component.addField();
            component.addField();
            component.fields.at(0).patchValue({ key: 'MyField', label: 'F1', type: 'text' });
            component.fields.at(1).patchValue({ key: 'myfield', label: 'F2', type: 'text' });

            expect(component.fields.errors?.['duplicateKeys']).toBeTruthy();
        });

        it('should not submit form when duplicate keys exist', () => {
            component.addForm.patchValue({ name: 'Test Type', slug: 'test-type' });
            component.addField();
            component.addField();
            component.fields.at(0).patchValue({ key: 'dup', label: 'L1', type: 'text' });
            component.fields.at(1).patchValue({ key: 'dup', label: 'L2', type: 'text' });

            component.onSubmit();
            expect(mockStore.add).not.toHaveBeenCalled();
        });
    });

    describe('Slug Prepending to Field Keys', () => {
        it('should prepend slug to field keys on submit', () => {
            component.addForm.patchValue({
                name: 'Articles',
                slug: 'articles',
            });
            component.addField();
            component.fields.at(0).patchValue({
                key: 'author',
                label: 'Author',
                type: 'text',
                required: false,
            });

            component.onSubmit();
            const callArgs = mockStore.add.mock.calls[0][0];
            expect(callArgs.fields[0].key).toBe('articles_author');
        });

        it('should not double-prepend slug if already prefixed', () => {
            component.addForm.patchValue({
                name: 'Articles',
                slug: 'articles',
            });
            component.addField();
            component.fields.at(0).patchValue({
                key: 'articles_author',
                label: 'Author',
                type: 'text',
                required: false,
            });

            component.onSubmit();
            const callArgs = mockStore.add.mock.calls[0][0];
            expect(callArgs.fields[0].key).toBe('articles_author');
        });
    });
});
