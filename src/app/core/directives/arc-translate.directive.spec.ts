/**
 * Tests for the `data-arc-t` directive.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArcTranslateDirective } from './arc-translate.directive';
import { UiStringsService } from '../services/ui-strings.service';

@Component({
    standalone: true,
    imports: [ArcTranslateDirective],
    template: `<span data-arc-t="read_more">Read Article</span>`,
})
class HostComponent { }

describe('ArcTranslateDirective', () => {
    let strings: ReturnType<typeof signal<Record<string, string>>>;

    function render() {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        strings = signal<Record<string, string>>({});
        TestBed.configureTestingModule({
            providers: [{
                provide: UiStringsService,
                useValue: {
                    strings,
                    translate: (key: string, fallback: string) => {
                        const value = strings()[key];
                        return typeof value === 'string' && value.trim() ? value : fallback;
                    },
                },
            }],
        });
    });

    it('keeps the authored English when there is no translation', () => {
        const fixture = render();

        expect(fixture.nativeElement.textContent.trim()).toBe('Read Article');
    });

    it('replaces the text once a translation exists', () => {
        strings.set({ read_more: 'लेख पढ़ें' });
        const fixture = render();

        expect(fixture.nativeElement.textContent.trim()).toBe('लेख पढ़ें');
    });

    it('restores the English when strings are cleared', () => {
        strings.set({ read_more: 'लेख पढ़ें' });
        const fixture = render();
        expect(fixture.nativeElement.textContent.trim()).toBe('लेख पढ़ें');

        // Switching back to the default language must not leave the last
        // translation on screen.
        strings.set({});
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent.trim()).toBe('Read Article');
    });

    it('follows a language change without re-rendering', () => {
        const fixture = render();

        strings.set({ read_more: 'लेख पढ़ें' });
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent.trim()).toBe('लेख पढ़ें');
    });
});
