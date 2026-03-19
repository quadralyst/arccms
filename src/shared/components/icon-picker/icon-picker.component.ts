import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, signal, computed, forwardRef, WritableSignal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { FONT_AWESOME_ICONS } from '../../data/font-awesome-icons';

@Component({
    selector: 'arc-icon-picker',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './icon-picker.component.html',
    styleUrl: './icon-picker.component.scss',
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => IconPickerComponent),
            multi: true
        }
    ]
})
export class IconPickerComponent implements ControlValueAccessor {
    @Input() placeholder = 'Search icons... (e.g., folder, file, image)';

    allIcons = FONT_AWESOME_ICONS;
    iconSearchTerm: WritableSignal<string> = signal('');
    showIconDropdown = signal(false);
    selectedIconClass = signal('fa-solid fa-folder');

    private blurTimeout: any;

    filteredIcons = computed(() => {
        const search = this.iconSearchTerm().toLowerCase();
        if (!search) return this.allIcons;
        return this.allIcons.filter(icon =>
            icon.name.toLowerCase().includes(search) ||
            icon.class.toLowerCase().includes(search)
        );
    });

    // ControlValueAccessor implementation
    private onChange: (value: string) => void = () => { };
    private onTouched: () => void = () => { };

    writeValue(value: string): void {
        if (value) {
            this.selectedIconClass.set(value);
        }
    }

    registerOnChange(fn: (value: string) => void): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => void): void {
        this.onTouched = fn;
    }

    onIconInputChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.iconSearchTerm.set(input.value);
        this.showIconDropdown.set(true);
    }

    selectIcon(iconClass: string): void {
        this.selectedIconClass.set(iconClass);
        this.iconSearchTerm.set('');
        this.showIconDropdown.set(false);
        this.onChange(iconClass);
        this.onTouched();
    }

    onInputFocus(): void {
        if (this.blurTimeout) {
            clearTimeout(this.blurTimeout);
        }
        this.showIconDropdown.set(true);
    }

    onInputBlur(): void {
        // Delay closing dropdown to allow click on dropdown items
        this.blurTimeout = setTimeout(() => {
            this.showIconDropdown.set(false);
        }, 200);
    }

    ngOnDestroy(): void {
        if (this.blurTimeout) {
            clearTimeout(this.blurTimeout);
        }
    }
}
