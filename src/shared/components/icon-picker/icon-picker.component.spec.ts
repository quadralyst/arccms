import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { IconPickerComponent } from './icon-picker.component';
import { FONT_AWESOME_ICONS } from '../../data/font-awesome-icons';

describe('IconPickerComponent', () => {
    let component: IconPickerComponent;
    let fixture: ComponentFixture<IconPickerComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [IconPickerComponent, FormsModule, ReactiveFormsModule],
        }).compileComponents();

        fixture = TestBed.createComponent(IconPickerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Initialization', () => {
        it('should initialize with default placeholder', () => {
            expect(component.placeholder).toBe('Search icons... (e.g., folder, file, image)');
        });

        it('should initialize with all Font Awesome icons', () => {
            expect(component.allIcons).toEqual(FONT_AWESOME_ICONS);
        });

        it('should initialize with empty search term', () => {
            expect(component.iconSearchTerm()).toBe('');
        });

        it('should initialize with dropdown hidden', () => {
            expect(component.showIconDropdown()).toBe(false);
        });

        it('should initialize with default selected icon', () => {
            expect(component.selectedIconClass()).toBe('fa-solid fa-folder');
        });
    });

    describe('ControlValueAccessor', () => {
        it('should write value correctly', () => {
            const testValue = 'fa-solid fa-file';
            component.writeValue(testValue);
            expect(component.selectedIconClass()).toBe(testValue);
        });

        it('should not change value when null is written', () => {
            const initialValue = component.selectedIconClass();
            component.writeValue(null as any);
            expect(component.selectedIconClass()).toBe(initialValue);
        });

        it('should register onChange callback', () => {
            const fn = vi.fn();
            component.registerOnChange(fn);
            component.selectIcon('fa-solid fa-heart');
            expect(fn).toHaveBeenCalledWith('fa-solid fa-heart');
        });

        it('should register onTouched callback', () => {
            const fn = vi.fn();
            component.registerOnTouched(fn);
            component.selectIcon('fa-solid fa-star');
            expect(fn).toHaveBeenCalled();
        });
    });

    describe('Icon Filtering', () => {
        it('should return all icons when search term is empty', () => {
            component.iconSearchTerm.set('');
            expect(component.filteredIcons()).toEqual(FONT_AWESOME_ICONS);
        });

        it('should filter icons by name', () => {
            component.iconSearchTerm.set('folder');
            const filtered = component.filteredIcons();
            expect(filtered.length).toBeGreaterThan(0);
            expect(filtered.every(icon => icon.name.toLowerCase().includes('folder'))).toBe(true);
        });

        it('should filter icons by class', () => {
            component.iconSearchTerm.set('fa-file');
            const filtered = component.filteredIcons();
            expect(filtered.length).toBeGreaterThan(0);
            expect(filtered.every(icon => icon.class.toLowerCase().includes('fa-file'))).toBe(true);
        });

        it('should be case insensitive when filtering', () => {
            component.iconSearchTerm.set('FOLDER');
            const filtered = component.filteredIcons();
            expect(filtered.length).toBeGreaterThan(0);
        });

        it('should return empty array when no icons match', () => {
            component.iconSearchTerm.set('nonexistenticon123');
            expect(component.filteredIcons()).toEqual([]);
        });
    });

    describe('Icon Input Change', () => {
        it('should update search term on input change', () => {
            const event = {
                target: { value: 'heart' },
            } as any;
            component.onIconInputChange(event);
            expect(component.iconSearchTerm()).toBe('heart');
        });

        it('should show dropdown on input change', () => {
            const event = {
                target: { value: 'star' },
            } as any;
            component.showIconDropdown.set(false);
            component.onIconInputChange(event);
            expect(component.showIconDropdown()).toBe(true);
        });
    });

    describe('Icon Selection', () => {
        it('should set selected icon class', () => {
            component.selectIcon('fa-solid fa-star');
            expect(component.selectedIconClass()).toBe('fa-solid fa-star');
        });

        it('should clear search term', () => {
            component.iconSearchTerm.set('test');
            component.selectIcon('fa-solid fa-heart');
            expect(component.iconSearchTerm()).toBe('');
        });

        it('should hide dropdown', () => {
            component.showIconDropdown.set(true);
            component.selectIcon('fa-solid fa-bell');
            expect(component.showIconDropdown()).toBe(false);
        });

        it('should call onChange callback', () => {
            const fn = vi.fn();
            component.registerOnChange(fn);
            component.selectIcon('fa-solid fa-camera');
            expect(fn).toHaveBeenCalledWith('fa-solid fa-camera');
        });

        it('should call onTouched callback', () => {
            const fn = vi.fn();
            component.registerOnTouched(fn);
            component.selectIcon('fa-solid fa-user');
            expect(fn).toHaveBeenCalled();
        });
    });

    describe('Input Focus', () => {
        it('should show dropdown on input focus', () => {
            component.showIconDropdown.set(false);
            component.onInputFocus();
            expect(component.showIconDropdown()).toBe(true);
        });

        it('should clear blur timeout if it exists', () => {
            vi.useFakeTimers();
            component.onInputBlur();
            vi.advanceTimersByTime(100);
            component.onInputFocus();
            vi.advanceTimersByTime(200);
            expect(component.showIconDropdown()).toBe(true);
            vi.useRealTimers();
        });
    });

    describe('Input Blur', () => {
        it('should hide dropdown after delay', () => {
            vi.useFakeTimers();
            component.showIconDropdown.set(true);
            component.onInputBlur();
            expect(component.showIconDropdown()).toBe(true);
            vi.advanceTimersByTime(200);
            expect(component.showIconDropdown()).toBe(false);
            vi.useRealTimers();
        });

        it('should not hide dropdown immediately', () => {
            vi.useFakeTimers();
            component.showIconDropdown.set(true);
            component.onInputBlur();
            vi.advanceTimersByTime(100);
            expect(component.showIconDropdown()).toBe(true);
            vi.useRealTimers();
        });
    });

    describe('Component Destruction', () => {
        it('should clear blur timeout on destroy', () => {
            vi.useFakeTimers();
            component.onInputBlur();
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
            component.ngOnDestroy();
            expect(clearTimeoutSpy).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('should handle destroy when no timeout exists', () => {
            expect(() => component.ngOnDestroy()).not.toThrow();
        });
    });

    describe('Integration with FormControl', () => {
        it('should work with FormControl', () => {
            const control = new FormControl('fa-solid fa-folder');
            component.writeValue(control.value);
            expect(component.selectedIconClass()).toBe('fa-solid fa-folder');
        });

        it('should emit value changes to FormControl', () => {
            const onChange = vi.fn();
            component.registerOnChange(onChange);
            component.selectIcon('fa-solid fa-star');
            expect(onChange).toHaveBeenCalledWith('fa-solid fa-star');
        });
    });
});
