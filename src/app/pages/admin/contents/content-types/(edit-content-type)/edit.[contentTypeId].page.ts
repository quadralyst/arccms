import { RouteMeta } from '@analogjs/router';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    EventEmitter,
    inject,
    Input,
    input,
    OnInit,
    Output,
    signal,
} from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { BaseComponent } from '../../../../../../shared/components/base/base.component';
import { IconPickerComponent } from '../../../../../../shared/components/icon-picker/icon-picker.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { OmitCommonFields } from '../../../../../../shared/models/base-model';
import { LocalizationService } from '../../../../../core/services/localization.service';
import { ContentTypeNames, TranslatableTypeText, pruneNameTranslations, pruneFieldLabelTranslations, ContentType, ContentTypeField, ContentTypeFieldType } from '../content-types.model';
import { ContentTypesStore } from '../content-types.store';
import { getCollectionFields, isSyncFieldSelected, toggleSyncField, mapFieldWithCollectionRef, validateCollectionRefField, duplicateFieldKeyValidator } from '../collection-ref-helpers';
import { roleGuard } from '../../../../../guards/role.guard';
import { TemplateFolderService, TemplateFolder } from '../../../../../core/services/template-folder.service';

export const routeMeta: RouteMeta = {
    title: 'Edit Content Type | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
    providers: [],
};

@Component({
    selector: 'arc-edit-content-type',
    imports: [ReactiveFormsModule, MatIconModule, MatSelectModule, IconPickerComponent, TranslocoPipe],
    templateUrl: './edit-content-type.html',
    styleUrls: ['./edit-content-type.scss', '../(add-content-type)/add.page.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class EditContentTypeComponent extends BaseComponent implements OnInit {
    @Output() close = new EventEmitter();
    contentTypesStore = inject(ContentTypesStore);
    templateFolderService = inject(TemplateFolderService);
    private localization = inject(LocalizationService);
    action = input('action');
    errorMessages: string[] = [];
    public domain: string = '';

    // Template folders signal
    templateFolders = signal<TemplateFolder[]>([]);
    templatesLoading = signal<boolean>(false);
    // Track when templates have finished loading
    private templatesLoaded = false;
    // Store pending templateFolder value to apply after templates load
    private pendingTemplateFolder = 'default';

    fieldTypes: ContentTypeFieldType[] = ['text', 'number', 'richtext', 'date', 'datetime', 'image', 'boolean', 'dropdown', 'checkbox', 'radio'];

    public isEditingSlug = signal(false);
    private originalSlug = '';
    public errorSlug = signal(false);
    public checkingSlug = signal(false);
    private count = 0;

    currentItem = computed(() => {
        return this.contentTypesStore.currentItem();
    });

    availableCollections = computed(() => {
        const allContentTypes = this.contentTypesStore.items();
        const currentItem = this.currentItem();
        return allContentTypes.filter((ct) => ct.slug !== currentItem?.slug);
    });

    private updateFormdata(currentItem: ContentType) {
        // Store the templateFolder value to apply after templates load (if not yet loaded)
        const templateFolderValue = currentItem.templateFolder || 'default';
        this.pendingTemplateFolder = templateFolderValue;
        // Clear and populate fields FIRST - before patchValue triggers icon-picker
        this.fields.clear();

        // Add current fields if any exist
        if (currentItem.fields && currentItem.fields.length > 0) {
            currentItem.fields.forEach((field) => {
                const fieldGroup = new FormGroup({
                    key: new FormControl({ value: field.key, disabled: true }, [Validators.required]),
                    label: new FormControl(field.label, [Validators.required]),
                    type: new FormControl<ContentTypeFieldType>(field.type, [Validators.required]),
                    required: new FormControl(field.required),
                    options: new FormControl(field.options || ''),
                    useCollectionRef: new FormControl(field.useCollectionRef || false),
                    collectionRefSlug: new FormControl(field.collectionRef?.collectionSlug || ''),
                    collectionRefDisplayField: new FormControl(field.collectionRef?.displayField || ''),
                    // collectionRefValueField removed
                    collectionRefSyncFields: new FormControl(field.collectionRef?.syncFields || []),
                });
                this.fields.push(fieldGroup);
            });
        }

        // Patch form values AFTER fields are populated
        // Note: patchValue can trigger icon-picker writeValue which may cause issues
        this.editForm.patchValue({
            name: currentItem.name || '',
            singularName: currentItem.singularName || '',
            nameTranslations: currentItem.nameTranslations || {},
            fieldLabelTranslations: currentItem.fieldLabelTranslations || {},
            description: currentItem.description || '',
            hasPublicUrl: currentItem.hasPublicUrl !== false,
            slug: currentItem.slug || '',
            icon: currentItem.icon || 'fa-solid fa-folder',
            order: currentItem.order || 0,
            templateFolder: currentItem.templateFolder || 'default',
        });

        // If templates have already loaded, re-apply templateFolder to ensure dropdown shows correct value
        if (this.templatesLoaded) {
            // Use setTimeout to ensure this runs after Angular's change detection
            setTimeout(() => {
                this.editForm.patchValue({ templateFolder: templateFolderValue });
            }, 0);
        }
    }

    #id = '';
    @Input()
    get id(): string {
        return this.#id;
    }
    set id(newValue: string) {
        // Reset form fields when switching to a different item
        if (this.#id !== newValue) {
            this.fields.clear();
            this.editForm.reset({
                name: '',
                singularName: '',
                nameTranslations: {},
                fieldLabelTranslations: {},
                description: '',
                hasPublicUrl: true,
                slug: '',
                icon: 'fa-solid fa-folder',
                order: 0,
                templateFolder: 'default',
            });
        }

        this.#id = newValue;
        if (this.id) {
            this.contentTypesStore.getById(this.id);
        }
    }

    constructor() {
        super();
        // The per-language tabs only appear on a multilingual site.
        this.localization.load().then(settings => {
            if (!this.activeLang()) this.activeLang.set(settings.defaultLanguage);
        });
        // Use effect for side effects (form updates) - signals can be written inside effects
        effect(() => {
            const item = this.currentItem();
            if (item && this.#id) {
                this.updateFormdata(item as ContentType);
            }
        });
    }

    editForm = new FormGroup({
        name: new FormControl('', [Validators.required, Validators.minLength(3)]),
        singularName: new FormControl(''),
        // Per-language display names, keyed by code (M-D19). Held as a plain
        // value rather than nested controls so adding a language needs no
        // form surgery.
        nameTranslations: new FormControl<Record<string, ContentTypeNames>>({}),
        // lang -> fieldKey -> label. Derived from the live field list below,
        // so adding or removing a field updates the translation tabs at once.
        fieldLabelTranslations: new FormControl<Record<string, Record<string, string>>>({}),
        description: new FormControl(''),
        hasPublicUrl: new FormControl(true),
        slug: new FormControl('', [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)]),
        icon: new FormControl('fa-solid fa-folder'),
        order: new FormControl(0),
        templateFolder: new FormControl('default'),
        fields: new FormArray([], [duplicateFieldKeyValidator()]),
    });

    /**
     * Language tab currently shown in the drawer. The default language shows
     * the whole form; any other shows only what can be translated.
     */
    activeLang = signal<string>('');
    isTranslating = computed(() => {
        const active = this.activeLang();
        return !!active && active !== this.localization.defaultLanguage();
    });
    enabledLanguages = computed(() => this.localization.enabledLanguages());
    defaultLang = computed(() => this.localization.defaultLanguage());

    /**
     * The fields available to translate, read straight from the live form —
     * which is what keeps the translation tabs in step with the field list.
     *
     * A method rather than a computed: the form is populated by an effect that
     * can run before any subscription is in place, so a signal-based cache can
     * latch an empty list and never invalidate. Re-reading each change
     * detection cycle is cheap here and always correct.
     */
    translatableFields(): Array<{ key: string; label: string }> {
        // Read the controls rather than the FormArray's value: `value` omits
        // disabled controls, and the controls are the same source the
        // default-language tab renders from.
        const array = this.editForm.get('fields') as FormArray | null;
        return (array?.controls ?? [])
            .map(control => ({
                key: (control.get('key')?.value as string) || '',
                label: (control.get('label')?.value as string) || '',
            }))
            .filter(field => !!field.key)
            .map(field => ({ key: field.key, label: field.label || field.key }));
    }

    translatedFieldLabel(lang: string, fieldKey: string): string {
        const all = this.editForm.get('fieldLabelTranslations')?.value || {};
        return all[lang]?.[fieldKey] || '';
    }

    setTranslatedFieldLabel(lang: string, fieldKey: string, value: string): void {
        const control = this.editForm.get('fieldLabelTranslations');
        const all = { ...(control?.value || {}) };
        all[lang] = { ...(all[lang] || {}), [fieldKey]: value };
        control?.setValue(all);
        control?.markAsDirty();
    }

    /** Languages other than the default — the ones needing a translated name. */
    extraLanguages = computed(() => this.localization.extraLanguages());

    /** Current translated text for a language, for the template's two-way bind. */
    translatedName(lang: string, key: TranslatableTypeText): string {
        const all = this.editForm.get('nameTranslations')?.value || {};
        return all[lang]?.[key] || '';
    }

    setTranslatedName(lang: string, key: TranslatableTypeText, value: string): void {
        const control = this.editForm.get('nameTranslations');
        const all = { ...(control?.value || {}) };
        all[lang] = { ...(all[lang] || {}), [key]: value };
        control?.setValue(all);
        control?.markAsDirty();
    }

    get name() {
        return this.editForm.get('name')!;
    }
    get slug() {
        return this.editForm.get('slug')!;
    }
    get description() {
        return this.editForm.get('description')!;
    }
    get fields() {
        return this.editForm.get('fields')! as FormArray;
    }

    ngOnInit(): void {
        if (typeof window !== 'undefined') {
            this.domain = window.location.origin + '/';
        }
        this.editForm.valueChanges.subscribe(() => {
            this.clearErrorMessages(this.editForm);
            this.errorMessages = [];
        });

        // Load available template folders
        this.loadTemplateFolders();
    }

    /**
     * Loads available template folders from the service
     */
    private loadTemplateFolders(): void {
        this.templatesLoading.set(true);
        this.templateFolderService.loadAndValidateTemplates().subscribe({
            next: (folders) => {
                this.templateFolders.set(folders);
                this.templatesLoading.set(false);
                this.templatesLoaded = true;

                // Re-apply pending templateFolder value now that options are available
                const pending = this.pendingTemplateFolder;
                if (pending) {
                    this.editForm.patchValue({ templateFolder: pending });
                }
            },
            error: (error) => {
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

    closeEdit() {
        this.editForm.reset();
        this.close.emit();
    }

    onSubmit() {
        if (this.editForm.invalid) {
            console.warn('[EditContentType] Form is invalid:', this.getFormErrors(this.editForm));
            this.focusFirstInvalidField(this.editForm);
            this.errorMessages = this.getFormErrors(this.editForm);
            return;
        }

        if (this.errorSlug()) {
            this.errorMessages = [this.transloco.translate('admin.contents.types.fix_slug')];
            return;
        }

        // Use getRawValue() to include disabled field keys
        const formValue = this.editForm.getRawValue();

        // Validate collection reference fields
        const refErrors = (formValue.fields || []).flatMap((f: any) => validateCollectionRefField(f));
        if (refErrors.length > 0) {
            this.errorMessages = refErrors;
            return;
        }

        const slug = formValue.slug || '';

        const updatedContentType: Partial<ContentType> = {
            name: formValue.name || '',
            singularName: formValue.singularName || '',
            nameTranslations: pruneNameTranslations(formValue.nameTranslations),
            fieldLabelTranslations: pruneFieldLabelTranslations(
                formValue.fieldLabelTranslations,
                // Prefixed keys, matching what is written to `fields` below.
                (formValue.fields || []).map((field: any) =>
                    field.key && !field.key.startsWith(slug + '_') ? slug + '_' + field.key : field.key,
                ),
            ),
            slug: slug,
            description: formValue.description || '',
            icon: formValue.icon || 'fa-solid fa-folder',
            order: formValue.order || 0,
            hasPublicUrl: formValue.hasPublicUrl !== false,
            templateFolder: formValue.templateFolder || 'default',
            fields: (formValue.fields || []).map((field: any, index: number) => {
                const mapped = mapFieldWithCollectionRef(field, index, this.contentTypesStore);
                if (mapped.key && !mapped.key.startsWith(slug + '_')) {
                    mapped.key = slug + '_' + mapped.key;
                }
                return mapped;
            }),
        };

        this.contentTypesStore.update(this.id, updatedContentType).subscribe({
            next: () => {
                this.notify.success('admin.contents.types.updated');
                this.editForm.reset();
                this.close.emit();
            },
            error: (error) => {
                this.notify.error('admin.contents.types.update_failed');
                console.error('Error updating content type:', error);
            },
        });
    }

    public toggleSlugEdit(): void {
        if (this.isEditingSlug()) {
            // Cancel edit - revert to original value
            this.editForm.get('slug')?.setValue(this.originalSlug);
            this.isEditingSlug.set(false);
            this.errorSlug.set(false);
        } else {
            // Start edit
            this.originalSlug = this.editForm.get('slug')?.value || '';
            this.isEditingSlug.set(true);
        }
    }

    public saveSlug(): void {
        const currentSlug = this.editForm.get('slug')?.value;
        if (currentSlug) {
            this.checkExist(currentSlug);
        }
    }

    public checkExist(newSlug?: string): void {
        const newGeneratedSlug = newSlug || this.editForm.get('slug')?.value || '';
        this.errorSlug.set(false);
        this.checkingSlug.set(true);

        this.contentTypesStore.checkExistingSlugUrl(newGeneratedSlug).then(
            (res) => {
                this.checkingSlug.set(false);
                if (res && res.exists && newGeneratedSlug !== this.originalSlug) {
                    this.errorSlug.set(true);
                    this.notify.error('admin.contents.types.slug_exists', { slug: newGeneratedSlug });
                } else {
                    this.editForm.get('slug')?.setValue(newGeneratedSlug);
                    this.isEditingSlug.set(false);
                    this.errorSlug.set(false);
                }
            },
            (error) => {
                this.checkingSlug.set(false);
                console.error('Error checking slug existence:', error);
            }
        );
    }

    addField(): void {
        const fieldGroup = new FormGroup({
            key: new FormControl('', [Validators.required]),
            label: new FormControl('', [Validators.required]),
            type: new FormControl<ContentTypeFieldType>('text', [Validators.required]),
            required: new FormControl(false),
            options: new FormControl(''),
            useCollectionRef: new FormControl(false),
            collectionRefSlug: new FormControl(''),
            collectionRefDisplayField: new FormControl(''),
            // collectionRefValueField removed - always 'id'
            collectionRefSyncFields: new FormControl([]),
        });
        this.fields.push(fieldGroup);
    }

    removeField(index: number): void {
        this.fields.removeAt(index);
    }

    getFieldGroup(index: number): FormGroup {
        return this.fields.at(index) as FormGroup;
    }

    getCollectionFields(collectionSlug: string): ContentTypeField[] {
        return getCollectionFields(collectionSlug, this.contentTypesStore);
    }

    isSyncFieldSelected(fieldIndex: number, fieldKey: string): boolean {
        return isSyncFieldSelected(this.getFieldGroup(fieldIndex), fieldKey);
    }

    toggleSyncField(fieldIndex: number, fieldKey: string, checked: boolean): void {
        toggleSyncField(this.getFieldGroup(fieldIndex), fieldKey, checked);
    }
}
