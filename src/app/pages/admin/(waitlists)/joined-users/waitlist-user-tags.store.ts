import { Injectable, inject, signal, WritableSignal } from '@angular/core';
import { createGenericStore } from '../../../../../shared/services/generic-store.service';
import { IWaitlistUserTag } from './waitlist-user-tags.model';
import { WaitlistUserTagsService } from './waitlist-user-tags.service';
import { ConstantVariables } from '../../../../../shared/constants/common-constants';

const WaitlistUserTagsStoreBase = createGenericStore<IWaitlistUserTag>(WaitlistUserTagsService);

/**
 * Waitlist user tags store using the generic store factory pattern
 * Provides state management for tags with color auto-assignment
 */
@Injectable({ providedIn: 'root' })
export class WaitlistUserTagsStore extends WaitlistUserTagsStoreBase {
    private tagsService = inject(WaitlistUserTagsService);
    private constantVariables = inject(ConstantVariables);

    // Track used colors for auto-assignment
    private usedColors = signal<Set<string>>(new Set());

    // Current waitlist ID
    currentWaitlistId: WritableSignal<string> = signal('');

    /**
     * Set waitlist ID and reload tags for that waitlist
     */
    setWaitlistId(waitlistId: string): void {
        if (this.currentWaitlistId() !== waitlistId) {
            this.currentWaitlistId.set(waitlistId);
            this.tagsService.setWaitlistId(waitlistId);
            // Clear current items and reload
            this.usedColors.set(new Set());
        }
    }

    /**
     * Get the current waitlist ID
     */
    getWaitlistId(): string {
        return this.currentWaitlistId();
    }

    /**
     * Get the next available color from the palette
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

        // All colors used, cycle: return the first color
        return palette[0].color;
    }

    /**
     * Update the used colors set based on current items
     */
    updateUsedColors(): void {
        const items = this.items();
        const colors = new Set<string>();
        items.forEach((tag: IWaitlistUserTag) => {
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
    getTagByLabel(label: string): IWaitlistUserTag | undefined {
        return this.items().find(
            (tag: IWaitlistUserTag) => tag.label.toLowerCase() === label.toLowerCase()
        );
    }

    /**
     * Get tags matching a search term (for autocomplete)
     */
    filterTags(searchTerm: string): IWaitlistUserTag[] {
        if (!searchTerm) return this.items();
        const term = searchTerm.toLowerCase();
        return this.items().filter((tag: IWaitlistUserTag) =>
            tag.label.toLowerCase().includes(term)
        );
    }
}
