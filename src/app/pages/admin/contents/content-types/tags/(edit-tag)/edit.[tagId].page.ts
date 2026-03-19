import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Input, Output, signal, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { TagsStore } from '../tags.store';
import { ITag } from '../tags.model';
import { ConstantVariables } from '../../../../../../../shared/constants/common-constants';

@Component({
    selector: 'arc-edit-tag',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatIconModule,
    ],
    templateUrl: './edit.html',
    styleUrl: './edit.scss',
})
export default class EditTagComponent implements OnInit {
    @Input() id: string = '';
    @Input() contentTypeSlug: string = '';
    @Output() close = new EventEmitter<void>();

    private fb = inject(FormBuilder);
    private tagsStore = inject(TagsStore);
    private constantVariables = inject(ConstantVariables);

    tagForm: FormGroup;
    isSubmitting = signal(false);
    isLoading = signal(true);
    errorMessage = signal('');
    currentTag = signal<ITag | null>(null);

    colorOptions = this.constantVariables.tagsColorOptions;
    selectedColor = signal<string>('');

    constructor() {
        this.tagForm = this.fb.group({
            label: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
        });
    }

    ngOnInit(): void {
        this.loadTag();
    }

    private loadTag(): void {
        if (!this.id) {
            this.isLoading.set(false);
            this.errorMessage.set('Invalid tag ID');
            return;
        }

        // Find tag in store
        const tag = this.tagsStore.items().find(t => t.id === this.id);
        if (tag) {
            this.currentTag.set(tag);
            this.tagForm.patchValue({ label: tag.label });
            this.selectedColor.set(tag.color);
            this.isLoading.set(false);
        } else {
            // Fetch from store - getById sets currentItem in state
            this.tagsStore.getById(this.id);
            // Watch for currentItem to be populated
            setTimeout(() => {
                const fetched = this.tagsStore.currentItem();
                if (fetched && fetched.id === this.id) {
                    this.currentTag.set(fetched as ITag);
                    this.tagForm.patchValue({ label: fetched.label });
                    this.selectedColor.set(fetched.color);
                } else {
                    this.errorMessage.set('Tag not found');
                }
                this.isLoading.set(false);
            }, 500);
        }
    }

    selectColor(color: string): void {
        this.selectedColor.set(color);
    }

    async onSubmit(): Promise<void> {
        if (this.tagForm.invalid) {
            this.tagForm.markAllAsTouched();
            return;
        }

        const label = this.tagForm.get('label')?.value?.trim();
        const currentTag = this.currentTag();

        // Check for duplicate (excluding current)
        const isDuplicate = await this.tagsStore.isDuplicateLabel(label, this.id);
        if (isDuplicate) {
            this.errorMessage.set('A tag with this label already exists.');
            return;
        }

        this.isSubmitting.set(true);
        this.errorMessage.set('');

        const updatedData: Partial<ITag> = {
            label,
            color: this.selectedColor(),
        };

        this.tagsStore.update(this.id, updatedData).subscribe({
            next: () => {
                this.isSubmitting.set(false);
                this.close.emit();
            },
            error: (error) => {
                this.isSubmitting.set(false);
                this.errorMessage.set('Failed to update tag. Please try again.');
                console.error('Error updating tag:', error);
            },
        });
    }

    onCancel(): void {
        this.close.emit();
    }
}
