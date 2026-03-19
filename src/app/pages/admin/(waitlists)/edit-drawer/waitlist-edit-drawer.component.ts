import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
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

    @Input() isOpen = false;
    @Input() action: 'add' | 'edit' = 'add';
    @Input() waitlist: WaitlistEditInput | null = null;

    @Output() closed = new EventEmitter<void>();
    @Output() saved = new EventEmitter<WaitlistFormData>();

    waitlistForm!: FormGroup;
    coverImage = signal('');
    availableTags = signal<IWaitlistUserTag[]>([]);
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
        });
    }

    private onDrawerOpen(): void {
        if (this.action === 'edit' && this.waitlist) {
            this.waitlistForm.patchValue({
                name: this.waitlist.name || '',
                slug: this.waitlist.slug || '',
                description: this.waitlist.description || '',
                coverImage: this.waitlist.coverImage || '',
                isActive: this.waitlist.isActive ?? true,
                disabledMessage: this.waitlist.disabledMessage || '',
                defaultTagId: this.waitlist.defaultTagId || '',
            });
            this.coverImage.set(this.waitlist.coverImage || '');
            this.originalSlug = this.waitlist.slug || '';
            this.isSlugEditable.set(false);
            this.loadTagsForWaitlist(this.waitlist.id);
        } else {
            this.waitlistForm.reset({ isActive: true, disabledMessage: 'This waitlist is currently full. Please check back later for updates.' });
            this.coverImage.set('');
            this.isSlugEditable.set(true);
            this.availableTags.set([]);
        }
    }

    async loadTagsForWaitlist(waitlistId: string): Promise<void> {
        try {
            const collName = getWaitlistUserTagsCollectionName(waitlistId);
            const tagsRef = collection(this.firestore, collName);
            const snapshot = await getDocs(tagsRef);
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
