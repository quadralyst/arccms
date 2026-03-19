import { Injectable, inject, signal, computed, WritableSignal } from '@angular/core';
import { createGenericStore } from '../../../../../../shared/services/generic-store.service';
import { ITag } from './tags.model';
import { TagsService } from './tags.service';
import { ConstantVariables } from '../../../../../../shared/constants/common-constants';

const TagsStoreBase = createGenericStore<ITag>(TagsService);

/**
 * Tags store using the generic store factory pattern
 * Provides state management for tags with color auto-assignment
 */
@Injectable({ providedIn: 'root' })
export class TagsStore extends TagsStoreBase {
    private tagsService = inject(TagsService);
    private constantVariables = inject(ConstantVariables);

    // Track used colors for auto-assignment
    private usedColors = signal<Set<string>>(new Set());

    // Current content type slug
    currentContentTypeSlug: WritableSignal<string> = signal('');

    /**
     * Set content type slug and reload tags for that content type
     */
    setContentTypeSlug(slug: string): void {
        if (this.currentContentTypeSlug() !== slug) {
            this.currentContentTypeSlug.set(slug);
            this.tagsService.setContentTypeSlug(slug);
            // Clear current items and reload
            this.usedColors.set(new Set());
        }
    }

    /**
     * Get the current content type slug
     */
    getContentTypeSlug(): string {
        return this.currentContentTypeSlug();
    }

    /**
     * Get the next available color from the palette
     * Cycles through colors if all are used
     */
    getNextAvailableColor(): string {
        const palette = this.constantVariables.tagsColorOptions;
        const used = this.usedColors();

        // Find first unused color
        for (const colorOption of palette) {
            if (!used.has(colorOption.color)) {
                return colorOption.color;
            }
        }

        // All colors used, cycle: pick the one used least recently
        // For simplicity, just return the first color
        return palette[0].color;
    }

    /**
     * Update the used colors set based on current items
     */
    updateUsedColors(): void {
        const items = this.items();
        const colors = new Set<string>();
        items.forEach((tag: ITag) => {
            if (tag.color) {
                colors.add(tag.color);
            }
        });
        this.usedColors.set(colors);
    }

    /**
     * Add a tag and mark its color as used
     */
    addTagWithAutoColor(label: string): { label: string; color: string } {
        const color = this.getNextAvailableColor();
        this.usedColors.update(colors => {
            const newColors = new Set(colors);
            newColors.add(color);
            return newColors;
        });
        return { label, color };
    }

    /**
     * Check if a label is a duplicate
     */
    async isDuplicateLabel(label: string, excludeId?: string): Promise<boolean> {
        return this.tagsService.checkDuplicateLabel(label, excludeId);
    }

    /**
     * Get tag by label (case-insensitive)
     */
    getTagByLabel(label: string): ITag | undefined {
        return this.items().find(
            (tag: ITag) => tag.label.toLowerCase() === label.toLowerCase()
        );
    }

    /**
     * Get tags matching a search term (for autocomplete)
     */
    filterTags(searchTerm: string): ITag[] {
        if (!searchTerm) return this.items();
        const term = searchTerm.toLowerCase();
        return this.items().filter((tag: ITag) =>
            tag.label.toLowerCase().includes(term)
        );
    }
}
