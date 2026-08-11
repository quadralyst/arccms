import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { OverlayContainer } from '@angular/cdk/overlay';
import { HashtagAutocompleteDirective } from './hashtag-autocomplete.directive';

@Component({
    standalone: true,
    imports: [FormsModule, HashtagAutocompleteDirective],
    template: `<input [arcHashtagAutocomplete]="tags" [(ngModel)]="value" />`,
})
class HostComponent {
    tags = ['##NAME##', '##EMAIL##', '##OTP##'];
    value = '';
}

describe('HashtagAutocompleteDirective', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;
    let input: HTMLInputElement;
    let overlayContainer: OverlayContainer;
    let overlayEl: HTMLElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        fixture.detectChanges();
        input = fixture.nativeElement.querySelector('input');
        overlayContainer = TestBed.inject(OverlayContainer);
        overlayEl = overlayContainer.getContainerElement();
    });

    afterEach(() => {
        overlayContainer.ngOnDestroy();
    });

    /** Simulate typing `value` with the caret at `caret` (defaults to end). */
    function type(value: string, caret = value.length): void {
        input.value = value;
        input.focus();
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        fixture.detectChanges();
    }

    function key(name: string): void {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
        fixture.detectChanges();
    }

    function renderedTags(): string[] {
        return Array.from(overlayEl.querySelectorAll('.arc-tag-suggestions__item')).map((el) =>
            (el.textContent ?? '').trim(),
        );
    }

    it('opens the full tag list when the user types #', () => {
        type('Hi #');
        expect(renderedTags()).toEqual(['##NAME##', '##EMAIL##', '##OTP##']);
    });

    it('filters the list as the query is typed', () => {
        type('Hi #na');
        expect(renderedTags()).toEqual(['##NAME##']);
    });

    it('does not open when there is no active # token', () => {
        type('Hi # ');
        expect(renderedTags()).toEqual([]);
    });

    it('inserts the full ##TAG## token on click, replacing the typed #query', () => {
        type('Hi #na');
        const item = overlayEl.querySelector('.arc-tag-suggestions__item') as HTMLElement;
        item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        fixture.detectChanges();

        expect(input.value).toBe('Hi ##NAME## ');
        expect(host.value).toBe('Hi ##NAME## ');
        // Popup closes after selection.
        expect(renderedTags()).toEqual([]);
    });

    it('supports arrow-key navigation + Enter to pick', () => {
        type('#');
        key('ArrowDown'); // move from ##NAME## to ##EMAIL##
        key('Enter');

        expect(input.value).toBe('##EMAIL## ');
    });

    it('closes on Escape', () => {
        type('Hi #');
        expect(renderedTags()).toHaveLength(3);
        key('Escape');
        expect(renderedTags()).toEqual([]);
    });

    it('shows nothing when the input has no tags configured', () => {
        host.tags = [];
        fixture.detectChanges();
        type('Hi #');
        expect(renderedTags()).toEqual([]);
    });
});
