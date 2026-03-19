import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Input, Output, signal, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { TagsStore } from '../tags.store';
import { ITag } from '../tags.model';

@Component({
    selector: 'arc-view-tag',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
    ],
    templateUrl: './view.html',
    styleUrl: './view.scss',
})
export class ViewTagComponent implements OnInit {
    @Input() id: string = '';
    @Input() contentTypeSlug: string = '';
    @Output() close = new EventEmitter<void>();

    private tagsStore = inject(TagsStore);

    isLoading = signal(true);
    errorMessage = signal('');
    currentTag = signal<ITag | null>(null);

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
            this.isLoading.set(false);
        } else {
            // Fetch from store - getById sets currentItem in state
            this.tagsStore.getById(this.id);
            // Watch for currentItem to be populated
            setTimeout(() => {
                const fetched = this.tagsStore.currentItem();
                if (fetched && fetched.id === this.id) {
                    this.currentTag.set(fetched as ITag);
                } else {
                    this.errorMessage.set('Tag not found');
                }
                this.isLoading.set(false);
            }, 500);
        }
    }

    formatDate(date: any): string {
        if (!date) return '--';
        try {
            if (date?.seconds) {
                return new Date(date.seconds * 1000).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                });
            }
            return new Date(date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            });
        } catch {
            return '--';
        }
    }

    onClose(): void {
        this.close.emit();
    }
}
