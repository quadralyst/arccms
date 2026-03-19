import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { TagsStore } from '../tags.store';
import { ITag } from '../tags.model';
import { ConstantVariables } from '../../../../../../../shared/constants/common-constants';

@Component({
    selector: 'arc-add-tag',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatIconModule,
    ],
    templateUrl: './add.html',
    styleUrl: './add.scss',
})
export default class AddTagComponent {
    @Input() contentTypeSlug: string = '';
    @Output() close = new EventEmitter<void>();

    private fb = inject(FormBuilder);
    private tagsStore = inject(TagsStore);
    private constantVariables = inject(ConstantVariables);

    tagForm: FormGroup;
    isSubmitting = signal(false);
    errorMessage = signal('');

    // Color palette from constants
    colorOptions = this.constantVariables.tagsColorOptions;
    selectedColor = signal<string>('');

    constructor() {
        this.tagForm = this.fb.group({
            label: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
        });

        // Auto-assign first available color
        const autoColor = this.tagsStore.getNextAvailableColor();
        this.selectedColor.set(autoColor);
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

        // Check for duplicate
        const isDuplicate = await this.tagsStore.isDuplicateLabel(label);
        if (isDuplicate) {
            this.errorMessage.set('A tag with this label already exists.');
            return;
        }

        this.isSubmitting.set(true);
        this.errorMessage.set('');

        const newTag = {
            label,
            color: this.selectedColor(),
            contentTypeSlug: this.contentTypeSlug,
            usageCount: 0,
        } as ITag;

        this.tagsStore.add(newTag).subscribe({
            next: () => {
                this.isSubmitting.set(false);
                this.close.emit();
            },
            error: (error) => {
                this.isSubmitting.set(false);
                this.errorMessage.set('Failed to create tag. Please try again.');
                console.error('Error creating tag:', error);
            },
        });
    }

    onCancel(): void {
        this.close.emit();
    }
}
