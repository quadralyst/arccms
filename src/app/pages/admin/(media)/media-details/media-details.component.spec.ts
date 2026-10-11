import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { MediaDetailsChange, MediaDetailsComponent, MediaDetailsValue } from './media-details.component';

@Component({
    standalone: true,
    imports: [MediaDetailsComponent],
    template: `<arc-media-details [item]="item()" [showAlt]="showAlt" fallbackTitle="photo.webp" (changed)="changes.push($event)" />`,
})
class HostComponent {
    item = signal<MediaDetailsValue>({ id: 'a', title: 'Shop', notes: '', alt: '' });
    showAlt = true;
    changes: MediaDetailsChange[] = [];
}

function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const [title, alt] = Array.from(el.querySelectorAll('input'));
    const notes = el.querySelector('textarea')!;
    const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('blur'));
        fixture.detectChanges();
    };
    return { fixture, host: fixture.componentInstance, title, alt, notes, type, el };
}

describe('MediaDetailsComponent (MF-D21)', () => {
    it('saves a field when it is left, only if it changed', () => {
        const { host, alt, notes, type } = setup();
        type(alt, '  A red door ');
        type(alt, 'A red door');
        type(notes, 'Diwali shoot');
        expect(host.changes).toEqual([{ alt: 'A red door' }, { notes: 'Diwali shoot' }]);
    });

    it('puts the file name back when the title is cleared', () => {
        const { host, title, type } = setup();
        type(title, '   ');
        expect(host.changes).toEqual([{ title: 'photo.webp' }]);
        expect(title.value).toBe('photo.webp');
    });

    it('loads another item\'s values when the selection changes', () => {
        const { fixture, host, title } = setup();
        host.item.set({ id: 'b', title: 'Menu', notes: 'n' });
        fixture.detectChanges();
        expect(title.value).toBe('Menu');
    });

    it('has no alt text for files', () => {
        TestBed.configureTestingModule({ imports: [HostComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })] });
        const fixture = TestBed.createComponent(HostComponent);
        fixture.componentInstance.showAlt = false;
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('input')).toHaveLength(1);
    });
});
