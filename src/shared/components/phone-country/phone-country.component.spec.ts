import { describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PhoneCountryComponent } from './phone-country.component';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

@Component({
    standalone: true,
    imports: [PhoneCountryComponent],
    template: `<arc-phone-country [countries]="countries()" [(value)]="country" (chosen)="chosen.set($event)" /><input id="number" />`,
})
class Host {
    countries = signal<string[]>(['IN']);
    country = signal('IN');
    chosen = signal('');
}

async function render(countries: string[], value = countries[0], lang = 'en') {
    TestBed.configureTestingModule({ imports: [Host, translocoTestingModule({ lang })] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.countries.set(countries);
    fixture.componentInstance.country.set(value);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tick = async () => { fixture.detectChanges(); await new Promise((r) => setTimeout(r)); fixture.detectChanges(); };
    const key = async (target: Element, k: string) => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await tick(); };
    const options = () => [...el.querySelectorAll('[role="option"]')].map((li) => li.getAttribute('data-iso'));
    return { fixture, el, tick, key, options };
}

describe('PhoneCountryComponent', () => {
    it('is a plain label with one country: flag and code, nothing to open', async () => {
        const { el } = await render(['IN']);
        expect(el.querySelector('button')).toBeNull();
        const chip = el.querySelector('.chip.fixed')!;
        expect(chip.textContent).toContain('+91');
        expect(chip.getAttribute('aria-label')).toBe('Country: India, +91');
        expect(chip.querySelector('img')?.getAttribute('src')).toBe('/flags/4x3/in.svg');
    });

    it('is a button with several, naming the country for screen readers', async () => {
        const { el } = await render(['IN', 'GB'], 'GB');
        const button = el.querySelector('button.chip')!;
        expect(button.textContent).toContain('+44');
        expect(button.getAttribute('aria-label')).toBe('Country: United Kingdom, +44. Change the country');
        expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens the list in the admin\'s order, the current one marked, and picks one by click', async () => {
        const { fixture, el, tick, options } = await render(['IN', 'GB', 'US']);
        el.querySelector<HTMLButtonElement>('button.chip')!.click();
        await tick();
        expect(options()).toEqual(['IN', 'GB', 'US']);
        expect(el.querySelector('[aria-selected="true"]')?.getAttribute('data-iso')).toBe('IN');
        expect(el.querySelector('input[type="search"]')).toBeNull();
        (el.querySelector('[data-iso="US"]') as HTMLElement).click();
        await tick();
        expect(fixture.componentInstance.country()).toBe('US');
        expect(fixture.componentInstance.chosen()).toBe('US');
        expect(el.querySelector('[role="listbox"]')).toBeNull();
    });

    it('works from the keyboard: arrows open and move, a letter jumps, Enter picks, Escape closes', async () => {
        const { fixture, el, key, options } = await render(['IN', 'GB', 'US', 'AE']);
        const button = el.querySelector('button.chip')!;
        await key(button, 'ArrowDown');
        const list = el.querySelector('[role="listbox"]')!;
        expect(options()).toHaveLength(4);
        expect(document.activeElement).toBe(list);
        await key(list, 'ArrowDown');
        expect(list.getAttribute('aria-activedescendant')).toMatch(/-1$/);
        await key(list, 'u');
        expect(el.querySelector('li.active')?.getAttribute('data-iso')).toBe('GB');
        await key(list, 'Enter');
        expect(fixture.componentInstance.country()).toBe('GB');

        await key(button, 'ArrowDown');
        await key(el.querySelector('[role="listbox"]')!, 'Escape');
        expect(el.querySelector('[role="listbox"]')).toBeNull();
        expect(document.activeElement).toBe(button);
    });

    it('has a search box over eight countries, by name, code or ISO id', async () => {
        const { el, tick, options } = await render(['IN', 'GB', 'US', 'AE', 'SG', 'AU', 'CA', 'NZ', 'DE']);
        el.querySelector<HTMLButtonElement>('button.chip')!.click();
        await tick();
        const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
        expect(document.activeElement).toBe(search);
        search.value = 'zea';
        search.dispatchEvent(new Event('input'));
        await tick();
        expect(options()).toEqual(['NZ']);
        search.value = '+1';
        search.dispatchEvent(new Event('input'));
        await tick();
        expect(options()).toEqual(['US', 'CA']);
    });

    it('closes on a press outside', async () => {
        const { el, tick } = await render(['IN', 'GB']);
        el.querySelector<HTMLButtonElement>('button.chip')!.click();
        await tick();
        document.getElementById('number')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await tick();
        expect(el.querySelector('[role="listbox"]')).toBeNull();
    });

    it('shows the ISO letters when a flag does not load', async () => {
        const { el, tick } = await render(['IN']);
        el.querySelector('img')!.dispatchEvent(new Event('error'));
        await tick();
        expect(el.querySelector('.chip')?.classList).toContain('no-flag');
    });

    it('names countries in the page language', async () => {
        const { el } = await render(['IN'], 'IN', 'hi');
        expect(el.querySelector('.chip')?.getAttribute('aria-label')).toBe('देश: भारत, +91');
    });
});
