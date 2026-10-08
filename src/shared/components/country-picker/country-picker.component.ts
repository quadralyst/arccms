/**
 * Country picker: a list of chosen countries (flag, name, calling code) and a
 * search box to add more, by name in the reader's language or in English, by
 * ISO id or by code (`44`, `+44`). Settings, SMS uses it for the countries
 * people can sign in from (specs/phone-country-spec.md); an app can use it for
 * any list of countries.
 *
 * It never lets the list go empty: the last country has no remove button.
 */
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { COUNTRIES, Country, countryByIso, countryName, flagUrl } from '../../data/countries';

/** Results shown at once; typing more narrows them. */
const MAX_RESULTS = 8;

let nextId = 0;

@Component({
    selector: 'arc-country-picker',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <ul class="picked list-unstyled d-flex flex-wrap gap-2 mb-2">
            @for (country of picked(); track country.iso) {
            <li class="picked-country" [attr.data-iso]="country.iso">
                <img [src]="flag(country.iso)" alt="" width="20" height="15" (error)="noFlag($event)" />
                <span>{{ name(country.iso) }}</span>
                <span class="text-muted">+{{ country.code }}</span>
                @if (picked().length > 1) {
                <button type="button" class="remove" (click)="remove(country.iso)"
                    [attr.aria-label]="'common.country_picker.remove' | transloco: { country: name(country.iso) }">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                }
            </li>
            }
        </ul>
        <div class="search">
            <input #box type="search" class="form-control" autocomplete="off" role="combobox"
                [id]="inputId()" [attr.aria-label]="label() || null"
                [attr.aria-expanded]="query() ? 'true' : 'false'" [attr.aria-controls]="listId"
                [attr.aria-activedescendant]="results().length && query() ? listId + '-' + active() : null"
                [placeholder]="'common.country_picker.search' | transloco"
                (input)="search($any($event.target).value)" (keydown)="key($event)" />
            @if (query()) {
            <ul class="results list-unstyled" role="listbox" [id]="listId">
                @for (country of results(); track country.iso; let i = $index) {
                <li role="option" [id]="listId + '-' + i" [attr.aria-selected]="i === active()" [class.active]="i === active()"
                    [attr.data-iso]="country.iso" (mousedown)="$event.preventDefault()" (click)="add(country.iso)">
                    <img [src]="flag(country.iso)" alt="" width="20" height="15" (error)="noFlag($event)" />
                    <span>{{ name(country.iso) }}</span>
                    <span class="text-muted">+{{ country.code }}</span>
                </li>
                } @empty {
                <li class="none text-muted">{{ 'common.country_picker.none' | transloco }}</li>
                }
            </ul>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .picked-country { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.5rem; border: 1px solid #dee2e6; border-radius: 999px; background: #f8f9fa; font-size: 0.9rem; }
        img { border-radius: 2px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1); flex: none; }
        .remove { border: 0; background: none; padding: 0 0.15rem; color: #6c757d; line-height: 1; }
        .remove:hover, .remove:focus-visible { color: #dc3545; }
        .search { position: relative; max-width: 360px; }
        .results { position: absolute; z-index: 10; left: 0; right: 0; margin-top: 2px; background: #fff; border: 1px solid #dee2e6; border-radius: 0.375rem; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); max-height: 320px; overflow-y: auto; }
        .results li { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.75rem; cursor: pointer; }
        .results li.active, .results li[role="option"]:hover { background: #e9f2ff; }
        .results li.none { cursor: default; }
    `],
})
export class CountryPickerComponent {
    private readonly transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

    /** The chosen ISO ids, in the order they were added. */
    readonly value = model<string[]>([]);
    /** The id for the search box, so a page's `<label for>` can name it. */
    readonly inputId = input<string>(`country-picker-${nextId}`);
    /** A name for the search box when the page has no `<label>` for it. */
    readonly label = input<string>('');

    readonly listId = `country-picker-list-${nextId++}`;
    private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
    readonly query = signal('');
    readonly active = signal(0);

    readonly picked = computed(() => this.value().map((iso) => countryByIso(iso)).filter((c): c is Country => !!c));

    readonly results = computed(() => {
        const text = this.query().trim().toLowerCase();
        if (!text) return [];
        const code = text.replace(/^\+/, '');
        const lang = this.lang();
        const taken = new Set(this.value());
        const score = (country: Country): number => {
            const names = [countryName(country.iso, lang), countryName(country.iso)].map((n) => n.toLowerCase());
            if (/^\d+$/.test(code)) return country.code === code ? 0 : country.code.startsWith(code) ? 1 : -1;
            if (country.iso.toLowerCase() === text) return 0;
            if (names.some((n) => n.startsWith(text))) return 1;
            if (names.some((n) => n.includes(text))) return 2;
            return -1;
        };
        return COUNTRIES
            .filter((country) => !taken.has(country.iso))
            .map((country) => ({ country, rank: score(country) }))
            .filter(({ rank }) => rank >= 0)
            .sort((a, b) => a.rank - b.rank
                || Number(!!b.country.primary) - Number(!!a.country.primary)
                || countryName(a.country.iso, lang).localeCompare(countryName(b.country.iso, lang), lang))
            .slice(0, MAX_RESULTS)
            .map(({ country }) => country);
    });

    name(iso: string): string {
        return countryName(iso, this.lang());
    }

    flag(iso: string): string {
        return flagUrl(iso);
    }

    /** A flag that did not load leaves the name and code, which say it all. */
    noFlag(event: Event): void {
        (event.target as HTMLElement).style.display = 'none';
    }

    search(text: string): void {
        this.query.set(text);
        this.active.set(0);
    }

    add(iso: string): void {
        if (!this.value().includes(iso)) this.value.set([...this.value(), iso]);
        this.clear();
    }

    /** Empties the box itself too: a `[value]` binding does not reliably reset what was typed. */
    private clear(): void {
        const box = this.box()?.nativeElement;
        if (box) box.value = '';
        this.search('');
    }

    remove(iso: string): void {
        if (this.value().length > 1) this.value.set(this.value().filter((id) => id !== iso));
    }

    key(event: KeyboardEvent): void {
        const count = this.results().length;
        if (event.key === 'ArrowDown' && count) {
            event.preventDefault();
            this.active.set((this.active() + 1) % count);
        } else if (event.key === 'ArrowUp' && count) {
            event.preventDefault();
            this.active.set((this.active() - 1 + count) % count);
        } else if (event.key === 'Enter' && count) {
            event.preventDefault();
            this.add(this.results()[this.active()].iso);
        } else if (event.key === 'Escape' && this.query()) {
            event.preventDefault();
            this.clear();
        }
    }
}
