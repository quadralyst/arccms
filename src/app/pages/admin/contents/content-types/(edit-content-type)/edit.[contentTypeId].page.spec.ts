import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule, FormArray } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router, ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import EditContentTypeComponent from './edit.[contentTypeId].page';
import { ContentTypesStore } from '../content-types.store';
import { IconPickerComponent } from '../../../../../../shared/components/icon-picker/icon-picker.component';
import { ToastService } from '../../../../../../shared/services/toast.service';
import { ContentType } from '../content-types.model';

describe('EditContentTypeComponent', () => {
    let component: EditContentTypeComponent;
    let fixture: ComponentFixture<EditContentTypeComponent>;
    let mockStore: any;
    let mockToastService: any;
    let mockRouter: any;

    const mockContentType: ContentType = {
        id: 'test-id',
        name: 'Test Type',
        slug: 'test-type',
        description: 'Test Description',
        icon: 'fa-solid fa-file',
        order: 1,
        fields: [
            {
                key: 'title',
                label: 'Title',
                type: 'text',
                required: true,
                order: 0,
            },
        ],
        createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
        modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
    };

    beforeEach(async () => {
        mockStore = {
            getById: vi.fn(),
            update: vi.fn().mockReturnValue(of({})),
            currentItem: vi.fn().mockReturnValue(mockContentType),
            isLoading: vi.fn().mockReturnValue(false),
            items: vi.fn().mockReturnValue([mockContentType]),
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
                EditContentTypeComponent,
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
                    useValue: { snapshot: { params: { contentTypeId: 'test-id' } } },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EditContentTypeComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Form Initialization', () => {
        it('should initialize form with default values', () => {
            expect(component.editForm).toBeDefined();
            expect(component.editForm.get('name')?.value).toBe('');
            expect(component.editForm.get('description')?.value).toBe('');
            expect(component.editForm.get('slug')?.value).toBe('');
            expect(component.editForm.get('icon')?.value).toBe('fa-solid fa-folder');
            expect(component.editForm.get('order')?.value).toBe(0);
        });

        it('should have name as required field', () => {
            const nameControl = component.editForm.get('name');
            expect(nameControl?.hasError('required')).toBe(true);
        });

        it('should have minimum length validation for name', () => {
            const nameControl = component.editForm.get('name');
            nameControl?.setValue('ab');
            expect(nameControl?.hasError('minlength')).toBe(true);
        });

        it('should have slug as required field', () => {
            const slugControl = component.editForm.get('slug');
            slugControl?.setValue('');
            expect(slugControl?.hasError('required')).toBe(true);
        });

        it('should have pattern validation for slug', () => {
            const slugControl = component.editForm.get('slug');
            slugControl?.setValue('Invalid Slug');
            expect(slugControl?.hasError('pattern')).toBe(true);
            
            slugControl?.setValue('valid-slug-123');
            expect(slugControl?.hasError('pattern')).toBe(false);
        });
    });

    describe('Form Getters', () => {
        it('should return name control', () => {
            expect(component.name).toBe(component.editForm.get('name'));
        });

        it('should return description control', () => {
            expect(component.description).toBe(component.editForm.get('description'));
        });

        it('should return fields FormArray', () => {
            expect(component.fields).toBe(component.editForm.get('fields'));
        });
    });

    describe('ID Input Property', () => {
        it('should get and set id', () => {
            component.id = 'new-id';
            expect(component.id).toBe('new-id');
        });

        it('should call getById when id is set', () => {
            component.id = 'test-id-2';
            expect(mockStore.getById).toHaveBeenCalledWith('test-id-2');
        });

        it('should not call getById when id is empty', () => {
            mockStore.getById.mockClear();
            component.id = '';
            expect(mockStore.getById).not.toHaveBeenCalled();
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
            component.editForm.get('name')?.setValue('Test');
            expect(component.errorMessages).toEqual([]);
        });

        it('should NOT update slug when name changes (no auto-generation in edit)', () => {
            // Mock current data
            component.id = 'test-id';
            component['updateFormdata'](mockContentType);

            // Verify initial state
            expect(component.editForm.get('name')?.value).toBe('Test Type');
            expect(component.editForm.get('slug')?.value).toBe('test-type');

            // Change name
            component.editForm.get('name')?.setValue('Changed Name');

            // Slug should REMAIN 'test-type'
            expect(component.editForm.get('slug')?.value).toBe('test-type');
        });
    });

    describe('Slug Editing', () => {
        beforeEach(() => {
            component.id = mockContentType.id!;
            component['updateFormdata'](mockContentType);
        });

        it('should toggle slug editing mode', () => {
            expect(component.isEditingSlug()).toBe(false);
            component.toggleSlugEdit();
            expect(component.isEditingSlug()).toBe(true);
            component.toggleSlugEdit();
            expect(component.isEditingSlug()).toBe(false);
        });

        it('should revert slug value when canceling edit', () => {
            const originalSlug = component.editForm.get('slug')?.value;
            component.toggleSlugEdit();
            component.editForm.get('slug')?.setValue('changed-slug');
            component.toggleSlugEdit(); // Cancel
            expect(component.editForm.get('slug')?.value).toBe(originalSlug);
        });

        it('should call checkExistingSlugUrl on saveSlug', async () => {
            mockStore.checkExistingSlugUrl.mockResolvedValue({ exists: false, slug: 'new-slug' });
            component.toggleSlugEdit();
            component.editForm.get('slug')?.setValue('new-slug');
            component.saveSlug();
            
            expect(mockStore.checkExistingSlugUrl).toHaveBeenCalledWith('new-slug');
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.isEditingSlug()).toBe(false);
        });

        it('should handle duplicate slug on checkExist', async () => {
            mockStore.checkExistingSlugUrl.mockResolvedValue({ exists: true, slug: 'existing-slug' });
            component.toggleSlugEdit();
            component.editForm.get('slug')?.setValue('existing-slug');
            component.checkExist('existing-slug');
            
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.errorSlug()).toBe(true);
            expect(component.isEditingSlug()).toBe(true);
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                expect.stringContaining('already exists'),
                'error',
                'error'
            );
        });

        it('should allow current slug even if it exists in checkExist', async () => {
            // This can happen if the checkExist is called with the original slug
            mockStore.checkExistingSlugUrl.mockResolvedValue({ exists: true, slug: 'test-type' });
            component.toggleSlugEdit(); // originalSlug is 'test-type'
            component.checkExist('test-type');
            
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(component.errorSlug()).toBe(false);
            expect(component.isEditingSlug()).toBe(false);
        });
    });

    describe('Form Population from Current Item', () => {
        it('should populate form with current item data', () => {
            component.id = mockContentType.id!;
            const item = mockStore.currentItem();
            component['updateFormdata'](item);

            expect(component.editForm.get('name')?.value).toBe(mockContentType.name);
            expect(component.editForm.get('slug')?.value).toBe(mockContentType.slug);
            expect(component.editForm.get('description')?.value).toBe(mockContentType.description);
            expect(component.editForm.get('icon')?.value).toBe(mockContentType.icon);
            expect(component.editForm.get('order')?.value).toBe(mockContentType.order);
        });

        it('should populate fields from current item', () => {
            component.id = mockContentType.id!;
            const item = mockStore.currentItem();
            component['updateFormdata'](item);

            expect(component.fields.length).toBe(1);
            expect(component.fields.at(0).get('key')?.value).toBe('title');
            expect(component.fields.at(0).get('label')?.value).toBe('Title');
        });

        it('should have no fields when current item has no fields', () => {
            const itemWithoutFields = { ...mockContentType, fields: [] };
            component['updateFormdata'](itemWithoutFields);
            expect(component.fields.length).toBe(0);
        });

        it('should clear existing fields before populating', () => {
            component.addField();
            component.addField();
            expect(component.fields.length).toBe(2);

            component['updateFormdata'](mockContentType);
            expect(component.fields.length).toBe(1);
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

    describe('Form Submission', () => {
        beforeEach(() => {
            component.id = mockContentType.id!;
            component.editForm.patchValue({
                name: 'Updated Type',
                slug: 'updated-type',
                description: 'Updated Description',
                icon: 'fa-solid fa-star',
                order: 2,
            });
        });

        it('should not submit when form is invalid', () => {
            component.editForm.get('name')?.setValue('');
            component.onSubmit();
            expect(mockStore.update).not.toHaveBeenCalled();
        });

        it('should submit when form is valid', () => {
            component.onSubmit();
            expect(mockStore.update).toHaveBeenCalled();
        });

        it('should submit with correct id and data', () => {
            // Ensure slug is also set (form patchValue clears fields, slug needs to be re-set)
            component.editForm.patchValue({
                name: 'Updated Type',
                slug: 'updated-type',
                description: 'Updated Description',
                icon: 'fa-solid fa-star',
                order: 2,
            });
            component.onSubmit();
            const callArgs = mockStore.update.mock.calls[0][1];
            expect(callArgs.name).toBe('Updated Type');
            expect(callArgs.description).toBe('Updated Description');
            expect(callArgs.icon).toBe('fa-solid fa-star');
            expect(callArgs.order).toBe(2);
        });

        it('should submit with fields data', () => {
            component.addField();
            const field = component.fields.at(0);
            field.patchValue({
                key: 'content',
                label: 'Content',
                type: 'richtext',
                required: false,
            });
            component.onSubmit();
            const callArgs = mockStore.update.mock.calls[0][1];
            expect(callArgs.fields).toHaveLength(1);
            expect(callArgs.fields[0].key).toBe('updated-type_content');
        });

        it('should show success message on successful submission', async () => {
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Content type updated successfully',
                'success',
                'check_circle'
            );
        });

        it('should reset form on successful submission', async () => {
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(component.editForm.get('name')?.value).toBeFalsy();
        });

        it('should emit close event on successful submission', async () => {
            const closeSpy = vi.fn();
            component.close.subscribe(closeSpy);
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(closeSpy).toHaveBeenCalled();
        });

        it('should show error message on submission failure', async () => {
            mockStore.update.mockReturnValue(throwError(() => new Error('Test Error')));
            component.onSubmit();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Error updating content type',
                'error',
                'error'
            );
        });

        it('should focus first invalid field when form is invalid', () => {
            const focusSpy = vi.spyOn(component, 'focusFirstInvalidField');
            component.editForm.get('name')?.setValue('');
            component.onSubmit();
            expect(focusSpy).toHaveBeenCalledWith(component.editForm);
        });

        it('should populate error messages when form is invalid', () => {
            component.editForm.get('name')?.setValue('');
            component.onSubmit();
            expect(component.errorMessages.length).toBeGreaterThan(0);
        });
    });

    describe('closeEdit', () => {
        it('should reset form', () => {
            component.editForm.patchValue({
                name: 'Test',
                description: 'Test Description',
            });
            component.closeEdit();
            expect(component.editForm.get('name')?.value).toBeFalsy();
        });

        it('should emit close event', () => {
            const closeSpy = vi.fn();
            component.close.subscribe(closeSpy);
            component.closeEdit();
            expect(closeSpy).toHaveBeenCalled();
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
            expect(component.fieldTypes).toContain('gallery');
            expect(component.fieldTypes).toContain('labelvalue');
            expect(component.fieldTypes).toContain('boolean');
        });

        it('should have new field types for dropdown, checkbox, and radio', () => {
            expect(component.fieldTypes).toContain('dropdown');
            expect(component.fieldTypes).toContain('checkbox');
            expect(component.fieldTypes).toContain('radio');
        });

        it('should have 14 field types total', () => {
            expect(component.fieldTypes.length).toBe(14);
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

        it('should pre-populate options from content type data', () => {
            const contentTypeWithOptions: ContentType = {
                ...mockContentType,
                fields: [
                    {
                        key: 'color',
                        label: 'Color',
                        type: 'dropdown',
                        required: true,
                        order: 0,
                        options: 'Red, Green, Blue',
                    },
                ],
            };

            component['updateFormdata'](contentTypeWithOptions);
            expect(component.fields.at(0).get('options')?.value).toBe('Red, Green, Blue');
        });

        it('should save options with field data on submission', () => {
            component.id = 'test-id';
            component.editForm.patchValue({
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
            const callArgs = mockStore.update.mock.calls[0][1];
            expect(callArgs.fields[0].options).toBe('Red, Green, Blue');
        });

        it('should handle empty options for non-option field types', () => {
            const contentTypeWithTextFields: ContentType = {
                ...mockContentType,
                fields: [
                    {
                        key: 'title',
                        label: 'Title',
                        type: 'text',
                        required: true,
                        order: 0,
                    },
                ],
            };

            component['updateFormdata'](contentTypeWithTextFields);
            expect(component.fields.at(0).get('options')?.value).toBe('');
        });
    });

    describe('Field Order', () => {
        it('should assign order based on array index', () => {
            component.id = 'test-id';
            component.editForm.patchValue({
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
            const callArgs = mockStore.update.mock.calls[0][1];
            expect(callArgs.fields[0].order).toBe(0);
            expect(callArgs.fields[1].order).toBe(1);
        });
    });

    describe('Template Folder', () => {
        it('should have templateFolder form control', () => {
            expect(component.editForm.get('templateFolder')).toBeDefined();
        });

        it('should initialize templateFolder with default value', () => {
            expect(component.editForm.get('templateFolder')?.value).toBe('default');
        });

        it('should populate templateFolder from content type data', () => {
            const contentTypeWithTemplate: ContentType = {
                ...mockContentType,
                templateFolder: 'articles',
            };
            component['updateFormdata'](contentTypeWithTemplate);
            expect(component.editForm.get('templateFolder')?.value).toBe('articles');
        });

        it('should submit with templateFolder value', () => {
            component.id = 'test-id';
            component.editForm.patchValue({
                name: 'Test Type',
                slug: 'test-type',
                templateFolder: 'custom-templates',
            });
            component.onSubmit();
            const callArgs = mockStore.update.mock.calls[0][1];
            expect(callArgs.templateFolder).toBe('custom-templates');
        });

        it('should have templateFolders signal', () => {
            expect(component.templateFolders).toBeDefined();
            expect(typeof component.templateFolders).toBe('function'); // It's a signal
        });

        it('should use default when templateFolder is undefined in content type', () => {
            const { templateFolder, ...contentTypeWithoutTemplate } = mockContentType;
            component['updateFormdata'](contentTypeWithoutTemplate as ContentType);
            expect(component.editForm.get('templateFolder')?.value).toBe('default');
        });
    });

    describe('Field Key Disabled for Existing Fields', () => {
        it('should disable key control for existing fields loaded from DB', () => {
            component['updateFormdata'](mockContentType);
            expect(component.fields.at(0).get('key')?.disabled).toBe(true);
        });

        it('should keep key value accessible despite being disabled', () => {
            component['updateFormdata'](mockContentType);
            expect(component.fields.at(0).get('key')?.value).toBe('title');
        });

        it('should have editable key for newly added fields', () => {
            component.addField();
            const lastIndex = component.fields.length - 1;
            expect(component.fields.at(lastIndex).get('key')?.disabled).toBe(false);
        });

        it('should include disabled key values in submission via getRawValue', () => {
            component.id = 'test-id';
            component['updateFormdata'](mockContentType);
            component.editForm.patchValue({
                name: 'Test Type',
                slug: 'test-type',
            });

            component.onSubmit();
            const callArgs = mockStore.update.mock.calls[0][1];
            // Key 'title' gets slug prepended to 'test-type_title'
            expect(callArgs.fields[0].key).toBe('test-type_title');
        });
    });

    describe('Duplicate Field Key Validation', () => {
        it('should detect duplicate field keys in newly added fields', () => {
            component.addField();
            component.addField();
            component.fields.at(0).patchValue({ key: 'dup_field', label: 'F1', type: 'text' });
            component.fields.at(1).patchValue({ key: 'dup_field', label: 'F2', type: 'text' });

            expect(component.fields.errors?.['duplicateKeys']).toBeTruthy();
        });

        it('should allow unique field keys', () => {
            component.addField();
            component.addField();
            component.fields.at(0).patchValue({ key: 'field_a', label: 'A', type: 'text' });
            component.fields.at(1).patchValue({ key: 'field_b', label: 'B', type: 'text' });

            expect(component.fields.errors).toBeNull();
        });
    });

    describe('Slug Prepending to Field Keys', () => {
        it('should prepend slug to field keys on submit', () => {
            component.id = 'test-id';
            component.editForm.patchValue({
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
            const callArgs = mockStore.update.mock.calls[0][1];
            expect(callArgs.fields[0].key).toBe('articles_author');
        });

        it('should not double-prepend slug if already prefixed', () => {
            component.id = 'test-id';
            component.editForm.patchValue({
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
            const callArgs = mockStore.update.mock.calls[0][1];
            expect(callArgs.fields[0].key).toBe('articles_author');
        });
    });
});
