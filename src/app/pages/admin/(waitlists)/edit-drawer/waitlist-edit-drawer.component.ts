import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges, Injector, inject, runInInjectionContext, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Firestore, collection, doc, getDoc, getDocs } from '@angular/fire/firestore';
import { MatDialog } from '@angular/material/dialog';
import MediaManagerComponent from '../../(media)/media.page';
import { getWaitlistUserTagsCollectionName, IWaitlistUserTag } from '../joined-users/waitlist-user-tags.model';

export interface WaitlistFormData {
    name: string;
    slug: string;
    description: string;
    coverImage: string;
    isActive: boolean;
    disabledMessage: string;
    defaultTagId: string;
    gamificationEnabled: boolean;
    targetListIds: string[];
    /** form input name → contact field key (U4.5). */
    fieldMap: Record<string, string>;
}

export interface WaitlistEditInput {
    id: string;
    name: string;
    slug: string;
    description?: string;
    coverImage?: string;
    isActive: boolean;
    disabledMessage?: string;
    defaultTagId?: string;
    gamificationEnabled?: boolean;
    targetListIds?: string[];
    /** Parsed input names from the form's HTML, used to build the field mapping. */
    fields?: string[];
    fieldMap?: Record<string, string>;
}

@Component({
    selector: 'arc-waitlist-edit-drawer',
    templateUrl: './waitlist-edit-drawer.component.html',
    styleUrls: ['./waitlist-edit-drawer.component.scss'],
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
})
export class WaitlistEditDrawerComponent implements OnChanges {
    private fb = inject(FormBuilder);
    private firestore = inject(Firestore);
    private dialog = inject(MatDialog);
    private injector = inject(Injector);

    @Input() isOpen = false;
    @Input() action: 'add' | 'edit' = 'add';
    @Input() waitlist: WaitlistEditInput | null = null;

    @Output() closed = new EventEmitter<void>();
    @Output() saved = new EventEmitter<WaitlistFormData>();

    waitlistForm!: FormGroup;
    coverImage = signal('');
    availableTags = signal<IWaitlistUserTag[]>([]);
    /** Manual lists this form can additionally feed (own system list is implicit). */
    availableLists = signal<{ id: string; name: string }[]>([]);
    /** Contact fields an input can be mapped to (U4.5). */
    availableFields = signal<{ key: string; label: string }[]>([]);
    isSlugEditable = signal(false);
    private originalSlug = '';

    constructor() {
        this.initForm();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['isOpen'] && this.isOpen) {
            this.onDrawerOpen();
        }
    }

    private initForm(): void {
        this.waitlistForm = this.fb.group({
            name: ['', Validators.required],
            slug: ['', Validators.required],
            description: [''],
            coverImage: [''],
            isActive: [true],
            disabledMessage: ['This waitlist is currently full. Please check back later for updates.'],
            defaultTagId: [''],
            // Gamification on by default keeps existing waitlists behaving as before.
            gamificationEnabled: [true],
            // Manual lists this form additionally feeds; own system list is implicit.
            targetListIds: [[] as string[]],
            // form input name → contact field key (U4.5).
            fieldMap: [{} as Record<string, string>],
        });
    }

    private onDrawerOpen(): void {
        this.loadManualLists();
        void this.loadContactFields();
        if (this.action === 'edit' && this.waitlist) {
            // Stored targetListIds includes the own system list; the picker only
            // offers manual lists, so drop the own one from the initial value.
            const ownListId = `waitlist-${this.waitlist.id}`;
            const manualPicks = (this.waitlist.targetListIds || []).filter((id) => id !== ownListId);
            this.waitlistForm.patchValue({
                name: this.waitlist.name || '',
                slug: this.waitlist.slug || '',
                description: this.waitlist.description || '',
                coverImage: this.waitlist.coverImage || '',
                isActive: this.waitlist.isActive ?? true,
                disabledMessage: this.waitlist.disabledMessage || '',
                defaultTagId: this.waitlist.defaultTagId || '',
                gamificationEnabled: this.waitlist.gamificationEnabled ?? true,
                targetListIds: manualPicks,
                fieldMap: this.waitlist.fieldMap || {},
            });
            this.coverImage.set(this.waitlist.coverImage || '');
            this.originalSlug = this.waitlist.slug || '';
            this.isSlugEditable.set(false);
            this.loadTagsForWaitlist(this.waitlist.id);
        } else {
            this.waitlistForm.reset({
                isActive: true,
                disabledMessage: 'This waitlist is currently full. Please check back later for updates.',
                gamificationEnabled: true,
                targetListIds: [],
            });
            this.coverImage.set('');
            this.isSlugEditable.set(true);
            this.availableTags.set([]);
        }
    }

    /** Manual lists an admin can point this form at (system lists excluded). */
    async loadManualLists(): Promise<void> {
        try {
            const listsRef = runInInjectionContext(this.injector, () => collection(this.firestore, 'Lists'));
            const snap = await runInInjectionContext(this.injector, () => getDocs(listsRef));
            const lists = snap.docs
                .map((d) => ({ id: d.id, ...(d.data() as { name?: string; type?: string }) }))
                .filter((l) => l.type === 'manual')
                .map((l) => ({ id: l.id, name: l.name || l.id }));
            this.availableLists.set(lists);
        } catch {
            this.availableLists.set([]);
        }
    }

    /** Checkbox toggle for a manual list in the "Feeds lists" picker. */
    toggleTargetList(listId: string): void {
        const ctrl = this.waitlistForm.get('targetListIds');
        const current: string[] = ctrl?.value || [];
        ctrl?.setValue(
            current.includes(listId) ? current.filter((id) => id !== listId) : [...current, listId],
        );
    }

    isTargetListSelected(listId: string): boolean {
        return (this.waitlistForm.get('targetListIds')?.value || []).includes(listId);
    }

    /**
     * Contact fields available to map onto (U4.5). Read straight from the registry
     * doc so a field created a moment ago is offered immediately.
     */
    async loadContactFields(): Promise<void> {
        try {
            const ref = runInInjectionContext(this.injector, () => doc(this.firestore, 'Settings', 'contact_fields'));
            const snap = await runInInjectionContext(this.injector, () => getDoc(ref));
            const registry = (snap.data()?.['fields'] as Record<string, { key: string; label: string }>) || {};
            this.availableFields.set(Object.values(registry).map((f) => ({ key: f.key, label: f.label })));
        } catch {
            this.availableFields.set([]);
        }
    }

    /** The form's own input names, which are what a mapping maps *from*. */
    formInputNames(): string[] {
        return (this.waitlist?.fields || []).filter((f) => !!f && f !== 'email');
    }

    mappedFieldFor(inputName: string): string {
        return (this.waitlistForm.get('fieldMap')?.value || {})[inputName] || '';
    }

    setFieldMapping(inputName: string, fieldKey: string): void {
        const ctrl = this.waitlistForm.get('fieldMap');
        const next = { ...(ctrl?.value || {}) };
        if (fieldKey) next[inputName] = fieldKey;
        else delete next[inputName];
        ctrl?.setValue(next);
    }

    async loadTagsForWaitlist(waitlistId: string): Promise<void> {
        try {
            const collName = getWaitlistUserTagsCollectionName(waitlistId);
            const tagsRef = runInInjectionContext(this.injector, () => collection(this.firestore, collName));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(tagsRef));
            const tags = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as IWaitlistUserTag));
            this.availableTags.set(tags);
        } catch {
            this.availableTags.set([]);
        }
    }

    onSave(): void {
        if (this.waitlistForm.invalid) return;
        this.saved.emit(this.waitlistForm.value as WaitlistFormData);
    }

    onClose(): void {
        this.availableTags.set([]);
        this.closed.emit();
    }

    generateSlug(): void {
        if (this.action === 'edit') return;
        const name = this.waitlistForm.get('name')?.value;
        if (name && !this.waitlistForm.get('slug')?.value) {
            const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            this.waitlistForm.patchValue({ slug });
        }
    }

    toggleSlugEdit(): void {
        const isEditable = this.isSlugEditable();
        if (isEditable) {
            this.waitlistForm.get('slug')?.setValue(this.originalSlug);
        } else {
            if (this.action === 'add') {
                this.originalSlug = this.waitlistForm.get('slug')?.value || '';
            }
        }
        this.isSlugEditable.update(val => !val);
    }

    openMediaManager(): void {
        const dialogRef = this.dialog.open(MediaManagerComponent, {
            enterAnimationDuration: '450ms',
            exitAnimationDuration: '300ms',
            minWidth: '134vh',
            maxHeight: '90vh',
            panelClass: 'common-dialog-box',
            disableClose: true,
            data: { isDialogOpen: true },
        });
        dialogRef.afterClosed().subscribe((result: { mediaUrl: string; type: string } | null) => {
            if (result?.type === 'submit' && result?.mediaUrl) {
                this.coverImage.set(result.mediaUrl);
                this.waitlistForm.get('coverImage')?.setValue(result.mediaUrl);
            }
        });
    }

    removeCoverImage(): void {
        this.coverImage.set('');
        this.waitlistForm.get('coverImage')?.setValue('');
    }
}
