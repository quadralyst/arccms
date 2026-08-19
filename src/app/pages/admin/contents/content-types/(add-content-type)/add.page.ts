import { RouteMeta } from '@analogjs/router';
import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    inject,
    Output,
    OnInit,
    input,
    signal,
    computed
} from '@angular/core';
import { FormControl, FormGroup, FormArray, ReactiveFormsModule, Validators, AbstractControl } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { BaseComponent } from '../../../../../../shared/components/base/base.component';
import { IconPickerComponent } from '../../../../../../shared/components/icon-picker/icon-picker.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { roleGuard } from '../../../../../guards/role.guard';
import { ContentTypesStore } from '../content-types.store';
import { ContentType, ContentTypeField, CollectionReferenceConfig } from '../content-types.model';
import { OmitCommonFields } from '../../../../../../shared/models/base-model';
import { TemplateFolderService, TemplateFolder } from '../../../../../core/services/template-folder.service';
import { ToastService } from '../../../../../../shared/services/toast.service';
import { duplicateFieldKeyValidator } from '../collection-ref-helpers';

export const routeMeta: RouteMeta = {
    title: 'Add Content Type | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
    providers: [],
};

@Component({
    selector: 'arc-add-content-type',
    imports: [ReactiveFormsModule, MatIconModule, MatSelectModule, IconPickerComponent, TranslocoPipe],
    templateUrl: './add.page.html',
    styleUrl: './add.page.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class AddContentTypeComponent extends BaseComponent {
    @Output() close = new EventEmitter();
    contentTypesStore = inject(ContentTypesStore);
    templateFolderService = inject(TemplateFolderService);
    // toastService is already injected in BaseComponent
    action = input('action');
    
    // Template folders signal
    templateFolders = signal<TemplateFolder[]>([]);
    templatesLoading = signal<boolean>(false);
    
    // Collection Reference Signals
    // Exclude current content type (not created yet, so effectively all)
    // Collection Reference Signals
    // Exclude current content type (not created yet, so effectively all)
    availableCollections = computed(() => this.contentTypesStore.items());

    public errorMessages: string[] = [];
    public domain: string = '';
    public errorSlug = signal(false);
    public checkingSlug = signal(false);
    private count = 0;
    public slugManuallyEdited = false;

    public fieldTypes = [
        'text',
        'number',
        'richtext',
        'date',
        'datetime',
        'image',
        'icon',
        'boolean',
        'dropdown',
        'checkbox',
        'radio',
        'infocard',
        'gallery',
        'labelvalue'
    ];

    addForm = new FormGroup({
        name: new FormControl('', [Validators.required, Validators.minLength(3)]),
        singularName: new FormControl(''),
        description: new FormControl(''),
        hasPublicUrl: new FormControl(true),
        slug: new FormControl('', [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)]),
        templateFolder: new FormControl('default'),
        icon: new FormControl('fa-solid fa-folder'),
        order: new FormControl(0),
        fields: new FormArray([], [duplicateFieldKeyValidator()]),
    });

    get name() {
        return this.addForm.get('name');
    }
    get singularName() {
        return this.addForm.get('singularName');
    }
    get description() {
        return this.addForm.get('description');
    }
    get slug() {
        return this.addForm.get('slug');
    }

    get fields() {
        return this.addForm.get('fields') as FormArray;
    }

    addField() {
        this.fields.push(this.createFieldGroup());
    }

    removeField(index: number) {
        this.fields.removeAt(index);
    }

    getFieldGroup(index: number): FormGroup {
        return this.fields.at(index) as FormGroup;
    }

    private createFieldGroup() {
        return new FormGroup({
            key: new FormControl('', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]),
            label: new FormControl('', Validators.required),
            type: new FormControl('text', Validators.required),
            required: new FormControl(false),
            options: new FormControl(''),
            // Collection Reference Fields
            useCollectionRef: new FormControl(false),
            collectionRefSlug: new FormControl(''),
            collectionRefDisplayField: new FormControl(''),
            denormalizedFields: new FormControl([]) // Stores array of field keys
        });
    }

    // Existing methods below
    ngOnInit(): void {
        if (typeof window !== 'undefined') {
            this.domain = window.location.origin + '/';
        }
        
        this.addForm.valueChanges.subscribe(() => {
            if (typeof (this as any).clearErrorMessages === 'function') {
                 (this as any).clearErrorMessages(this.addForm);
            }
            this.errorMessages = [];
        });

        this.loadTemplateFolders();
        this.contentTypesStore.getAll();
    }

    // Removed loadAvailableCollections as we use computed directly.

    // System fields always available
    private readonly SYSTEM_FIELDS: ContentTypeField[] = [
        { key: 'id', label: 'ID', type: 'text', required: false, order: -4 },
        { key: 'title', label: 'Title', type: 'text', required: false, order: -3 },
        { key: 'urlSlug', label: 'URL Slug', type: 'text', required: false, order: -2 },
        { key: 'coverImage', label: 'Cover Image', type: 'text', required: false, order: -1 },
    ];

    public getCollectionFields(collectionSlug: string) {
        if (!collectionSlug) return [];
        const collection = this.contentTypesStore.items().find(c => c.slug === collectionSlug);
        const customFields = collection?.fields || [];
        // Filter out any custom fields that might conflict with system fields (though unlikely in this context)
        const filteredCustomFields = customFields.filter(f => !this.SYSTEM_FIELDS.some(sf => sf.key === f.key));
        return [...this.SYSTEM_FIELDS, ...filteredCustomFields];
    }

    public isSyncFieldSelected(fieldIndex: number, fieldKey: string): boolean {
        const fieldGroup = this.fields.at(fieldIndex) as FormGroup;
        const denormalizedFields = fieldGroup.get('denormalizedFields')?.value as string[] || [];
        return denormalizedFields.includes(fieldKey);
    }

    public toggleSyncField(fieldIndex: number, fieldKey: string, isChecked: boolean): void {
        const fieldGroup = this.fields.at(fieldIndex) as FormGroup;
        const current = fieldGroup.get('denormalizedFields')?.value as string[] || [];
        
        let updated: string[];
        if (isChecked) {
            updated = [...current, fieldKey];
        } else {
            updated = current.filter(k => k !== fieldKey);
        }
        
        fieldGroup.get('denormalizedFields')?.setValue(updated);
    }
    
    /* 
       Updated loadAvailableCollections to simple call loadAll
       and I will update availableCollections to be a computed property in the next step
       or just use store.entities() 
    */

    private loadTemplateFolders(): void {
        this.templatesLoading.set(true);
        this.templateFolderService.loadAndValidateTemplates().subscribe({
            next: (folders) => {
                // Filter out default since it's hardcoded in the HTML
                const filteredFolders = folders.filter(f => f.name !== 'default');
                this.templateFolders.set(filteredFolders);
                this.templatesLoading.set(false);
            },
            error: (error: any) => {
                console.error('Error loading template folders:', error);
                this.templatesLoading.set(false);
                // Set default as fallback
                this.templateFolders.set([{
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true,
                }]);
            },
        });
    }

    override trimUnwantedSpace(control: AbstractControl<any, any>): string {
        const value = control.value;
        if (typeof value === 'string') {
            const trimmedValue = value.trim();
            control.setValue(trimmedValue);
            return trimmedValue;
        }
        return '';
    }

    public createSlug(): void {
        if (this.slugManuallyEdited) {
            return;
        }

        const slugify = (str: string) =>
            str
                .toLowerCase()
                .trim()
                .replace(/[^\w\s-]/g, '')
                .replace(/[\s_-]+/g, '-')
                .replace(/^-+|-+$/g, '');
        
        const nameVal = this.addForm.get('name')?.value || '';
        const newSlug = slugify(nameVal);
        this.checkExist(newSlug);
    }

    public checkExist(newSlug?: string): void {
        const newGeneratedSlug = newSlug || this.addForm.get('slug')?.value || '';
        this.errorSlug.set(false);
        this.checkingSlug.set(true);
        this.count = 0;

        this.contentTypesStore.checkExistingSlugUrl(newGeneratedSlug).then(
            (res) => {
                this.checkingSlug.set(false);
                if (res && res.exists) {
                    if (!this.slugManuallyEdited) {
                        const baseSlug = this.getBaseSlug(newGeneratedSlug);
                        this.incrementAndCheck(baseSlug);
                    } else {
                        this.errorSlug.set(true);
                    }
                } else {
                    this.setSlugValue(newGeneratedSlug);
                }
            },
            (error: any) => {
                this.checkingSlug.set(false);
                console.error('Error checking slug existence:', error);
            }
        );
    }

    private getBaseSlug(slug: string): string {
        const match = slug.match(/(.*)-(\d+)$/);
        return match ? match[1] : slug;
    }

    private incrementAndCheck(baseSlug: string): void {
        this.count++;
        const newSlug = `${baseSlug}-${this.count}`;
        if (this.count < 10) {
            this.contentTypesStore.checkExistingSlugUrl(newSlug).then(
                (res) => {
                    if (res && res.exists) {
                        this.incrementAndCheck(baseSlug);
                    } else {
                        this.setSlugValue(newSlug);
                        this.checkingSlug.set(false);
                    }
                },
                (error: any) => {
                    this.checkingSlug.set(false);
                    console.error('Error checking slug existence:', error);
                }
            );
        } else {
            this.setSlugValue(baseSlug);
            this.checkingSlug.set(false);
            this.errorSlug.set(true);
        }
    }

    private setSlugValue(slug: string): void {
        this.addForm.get('slug')?.setValue(slug);
    }

    public onSlugManualEdit(): void {
        this.slugManuallyEdited = true;
        this.errorSlug.set(false);
    }

    // Existing methods below
    closeAdd() {
        this.addForm.reset();
        this.close.emit();
    }

    onSubmit() {
        if (this.addForm.invalid) {
            this.focusFirstInvalidField(this.addForm);
            this.errorMessages = this.getFormErrors(this.addForm);
            return;
        }
        
        if (this.errorSlug()) {
            this.errorMessages = [this.transloco.translate('admin.contents.types.fix_slug')];
            return;
        }

        const formValue = this.addForm.value;

        // Validate collection reference fields
        const refErrors = (formValue.fields || []).flatMap((f: any) => this.validateCollectionRefField(f));
        if (refErrors.length > 0) {
            this.errorMessages = refErrors;
            return;
        }

        const slug = formValue.slug || '';

        const newContentType: OmitCommonFields<ContentType> = {
            name: formValue.name || '',
            singularName: formValue.singularName || '',
            slug: slug,
            description: formValue.description || '',
            icon: formValue.icon || 'fa-solid fa-folder',
            order: formValue.order || 0,
            hasPublicUrl: formValue.hasPublicUrl !== false,
            templateFolder: formValue.templateFolder || 'default',
            fields: (formValue.fields || []).map((field: any, index: number) => {
                const mapped = this.mapFieldWithCollectionRef(field, index);
                // Prefix key with slug if not already (standard practice in this app?)
                // Checking backup... yes: if (mapped.key && !mapped.key.startsWith(slug + '_'))
                if (mapped.key && !mapped.key.startsWith(slug + '_')) {
                    mapped.key = slug + '_' + mapped.key;
                }
                return mapped;
            }),
        };

        this.contentTypesStore.add(newContentType).subscribe({
            next: () => {
                this.notify.success('admin.contents.types.created');
                this.closeAdd();
            },
            error: (error: any) => {
                this.notify.error('admin.contents.types.create_failed');
                console.error('Error creating content type:', error);
            },
        });
    }

    private validateCollectionRefField(field: any): string[] {
        const errors: string[] = [];
        if (field.useCollectionRef) {
            if (!field.collectionRefSlug) {
                errors.push(`Field "${field.label || field.key}": Source collection is required.`);
            }
            if (!field.collectionRefDisplayField) {
                errors.push(`Field "${field.label || field.key}": Display field is required.`);
            }
        }
        return errors;
    }

    private mapFieldWithCollectionRef(field: any, index: number): any {
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
            const refCt = this.contentTypesStore.items().find((c) => c.slug === field.collectionRefSlug);
    
            const syncFields = new Set<string>(field.denormalizedFields || []);
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
}
