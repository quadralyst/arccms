import { describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CountryPickerComponent } from './country-picker.component';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

@Component({
    standalone: true,
    imports: [CountryPickerComponent],
    template: `<arc-country-picker [(value)]="countries" />`,
})
class Host {
    countries = signal(['IN']);
}

function render(countries: string[], lang = 'en') {
    TestBed.configureTestingModule({ imports: [Host, translocoTestingModule({ lang })] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.countries.set(countries);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    const type = (text: string) => {
        input.value = text;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
    };
    const press = (key: string) => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key }));
        fixture.detectChanges();
    };
    const results = () => [...el.querySelectorAll('[role="option"]')].map((li) => li.getAttribute('data-iso'));
    return { fixture, el, input, type, press, results };
}

describe('CountryPickerComponent', () => {
    it('shows each chosen country with its flag, name and code', () => {
        const { el } = render(['IN', 'GB']);
        const chips = [...el.querySelectorAll('.picked-country')];
        expect(chips.map((c) => [...c.querySelectorAll('span')].map((s) => s.textContent?.trim()).join(' '))).toEqual(['India +91', 'United Kingdom +44']);
        expect(chips[0].querySelector('img')?.getAttribute('src')).toBe('/flags/4x3/in.svg');
    });

    it('never lets the last country go', () => {
        expect(render(['IN']).el.querySelector('.picked-country button')).toBeNull();
    });

    it('finds countries by name, ISO id or code, leaving out those already chosen', () => {
        const { type, results } = render(['IN']);
        type('united');
        expect(results()).toEqual(expect.arrayContaining(['GB', 'US', 'AE']));
        type('+44');
        expect(results()).toEqual(['GB', 'GG', 'IM', 'JE']);
        type('91');
        expect(results()).toEqual([]);
        type('ae');
        expect(results()[0]).toBe('AE');
    });

    it('says when nothing matches', () => {
        const { el, type } = render(['IN']);
        type('zzzz');
        expect(el.querySelector('.results .none')?.textContent).toContain('No country matches');
    });

    it('adds a country by click or keyboard, and removes one', () => {
        const { fixture, el, type, press, input } = render(['IN']);
        type('+44');
        (el.querySelector('[role="option"][data-iso="GB"]') as HTMLElement).click();
        fixture.detectChanges();
        expect(fixture.componentInstance.countries()).toEqual(['IN', 'GB']);
        expect(input.value).toBe('');

        type('+1');
        press('ArrowDown');
        expect(input.getAttribute('aria-activedescendant')).toMatch(/-1$/);
        press('Enter');
        expect(fixture.componentInstance.countries()).toHaveLength(3);

        el.querySelector<HTMLButtonElement>('.picked-country[data-iso="IN"] button')!.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.countries()).not.toContain('IN');
    });

    it('clears the search on Escape', () => {
        const { el, type, press, input } = render(['IN']);
        type('fr');
        press('Escape');
        expect(input.value).toBe('');
        expect(el.querySelector('[role="listbox"]')).toBeNull();
    });

    it('names countries in the page language, and finds them by their English name too', () => {
        const { el, type, results } = render(['IN'], 'hi');
        expect(el.querySelector('.picked-country')?.textContent).toContain('भारत');
        type('france');
        expect(results()).toEqual(['FR']);
    });
});
