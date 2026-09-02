import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, computed, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { FONT_AWESOME_ICONS } from '../../data/font-awesome-icons';
import { FaIndex } from '../../models/icon.model';
import { IconLibraryService } from '../../services/icon-library.service';

/** What the dropdown renders: a class list and the name beside it. */
interface PickerOption {
    name: string;
    class: string;
}

/** How many matches the dropdown shows. A 1,873-row list is not a menu. */
const MAX_OPTIONS = 60;

/**
 * Compact icon typeahead bound to a form control, yielding a class string.
 *
 * Used for a content type's own admin icon. For picking an icon that will be
 * published on a page, see `arc-icon-browser` — it returns a full token with
 * an inline-SVG fallback, which a bare class string cannot carry.
 *
 * The options come from the generated Font Awesome index (1,873 icons,
 * searchable by keyword and alias). `FONT_AWESOME_ICONS` remains as the
 * fallback: this component renders during the server-side pass of the
 * content-type pages, where there is no `fetch` to make, and a picker with
 * no icons at all would read as broken.
 */
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
export class IconPickerComponent implements ControlValueAccessor, OnInit, OnDestroy {
    @Input() placeholder = 'Search icons... (e.g., folder, file, image)';

    private icons = inject(IconLibraryService);

    /** The offline list, shown until (and if) the full index arrives. */
    allIcons = FONT_AWESOME_ICONS;
    iconSearchTerm = signal('');
    showIconDropdown = signal(false);
    selectedIconClass = signal('fa-solid fa-folder');

    /** Null until the index resolves, and permanently so if it cannot. */
    private readonly index = signal<FaIndex | null>(null);

    /**
     * The dropdown's rows.
     *
     * Depends on the index signal as well as the search term, so the list
     * upgrades from the offline 46 to the full library the moment the fetch
     * lands — without the open dropdown having to be reopened.
     */
    readonly filteredIcons = computed<PickerOption[]>(() => {
        const search = this.iconSearchTerm().toLowerCase();
        const index = this.index();

        if (!index) {
            const source = search
                ? this.allIcons.filter(icon =>
                    icon.name.toLowerCase().includes(search) ||
                    icon.class.toLowerCase().includes(search))
                : this.allIcons;
            return source.slice(0, MAX_OPTIONS);
        }

        return this.icons
            .search(index, search, 'all', MAX_OPTIONS)
            .map(result => ({ name: result.entry.n, class: result.classes }));
    });

    private blurTimeout: any;

    private onChange: (value: string) => void = () => { };
    private onTouched: () => void = () => { };

    async ngOnInit(): Promise<void> {
        this.index.set(await this.icons.loadIndex());
    }

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
