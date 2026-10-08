/**
 * The country beside a phone number (specs/phone-country-spec.md): its flag and
 * calling code, so it is never a guess which country a number is read in.
 *
 * With one country it is a plain label. With several it is a button that opens
 * the list (flag, name in the page language, code); more than eight adds a
 * search box. Choosing one emits `chosen`, so the page can put the caret back
 * in the number. Pressing the chip leaves focus in the number box until the list
 * takes it (Safari never focuses a clicked button), so the box can tell a move to
 * the chip from leaving. Used by the sign-in box, the profile's number box and the
 * SMS test send; an app can put it beside any number box.
 */
import {
    ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, output, signal, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Country, countryByIso, countryName, flagUrl } from '../../data/countries';

/** Above this many countries the list gets a search box. */
const SEARCH_FROM = 8;

let nextId = 0;

@Component({
    selector: 'arc-phone-country',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:mousedown)': 'outside($event)',
    },
    template: `
        @if (current(); as country) {
            @if (choices().length > 1) {
            <button #trigger type="button" class="chip" aria-haspopup="listbox" [attr.aria-expanded]="open()"
                [attr.aria-controls]="listId" [disabled]="disabled()"
                [attr.aria-label]="'member.phone_country.change' | transloco: { country: name(country.iso), code: country.code }"
                (mousedown)="$event.preventDefault()" (click)="toggle()" (keydown)="triggerKey($event)">
                <img [src]="flag(country.iso)" alt="" width="20" height="15" (error)="noFlag($event)" />
                <span class="iso" aria-hidden="true">{{ country.iso }}</span>
                <span class="code">+{{ country.code }}</span>
                <i class="fa-solid fa-chevron-down caret" aria-hidden="true"></i>
            </button>
            } @else {
            <span class="chip fixed" [attr.aria-label]="'member.phone_country.label' | transloco: { country: name(country.iso), code: country.code }" role="img">
                <img [src]="flag(country.iso)" alt="" width="20" height="15" (error)="noFlag($event)" />
                <span class="iso" aria-hidden="true">{{ country.iso }}</span>
                <span class="code" aria-hidden="true">+{{ country.code }}</span>
            </span>
            }
        }
        @if (open()) {
        <div class="menu">
            @if (choices().length > searchFrom) {
            <input #search type="search" class="form-control form-control-sm" autocomplete="off"
                [attr.aria-label]="'member.phone_country.search' | transloco"
                [placeholder]="'member.phone_country.search' | transloco"
                (input)="query.set($any($event.target).value); active.set(0)" (keydown)="listKey($event)" />
            }
            <ul #list role="listbox" [id]="listId" tabindex="-1" class="list-unstyled"
                [attr.aria-activedescendant]="listId + '-' + active()" (keydown)="listKey($event)">
                @for (country of shown(); track country.iso; let i = $index) {
                <li role="option" [id]="listId + '-' + i" [attr.aria-selected]="country.iso === value()"
                    [class.active]="i === active()" [attr.data-iso]="country.iso" (click)="choose(country.iso)">
                    <img [src]="flag(country.iso)" alt="" width="20" height="15" (error)="noFlag($event)" />
                    <span class="name">{{ name(country.iso) }}</span>
                    <span class="text-muted">+{{ country.code }}</span>
                </li>
                }
            </ul>
        </div>
        }
    `,
    styles: [`
        :host { position: relative; display: inline-flex; align-self: stretch; }
        .chip { display: inline-flex; align-items: center; gap: 0.35rem; height: 100%; padding: 0 0.6rem; border: 1px solid #ced4da; border-right: 0; border-radius: 0.375rem 0 0 0.375rem; background: #f8f9fa; color: #212529; font-size: 0.95rem; white-space: nowrap; }
        button.chip { cursor: pointer; }
        button.chip:hover { background: #e9ecef; }
        button.chip:focus-visible { outline: 2px solid #86b7fe; outline-offset: -2px; }
        img { border-radius: 2px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1); flex: none; }
        /* The ISO letters stand in for a flag that did not load. */
        .iso { display: none; font-size: 0.75rem; font-weight: 600; color: #6c757d; }
        .chip.no-flag .iso { display: inline; }
        .caret { font-size: 0.65rem; color: #6c757d; }
        .menu { position: absolute; z-index: 1050; top: calc(100% + 4px); left: 0; min-width: 260px; max-width: calc(100vw - 2rem); background: #fff; border: 1px solid #dee2e6; border-radius: 0.375rem; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12); padding: 0.25rem 0; }
        .menu input { margin: 0.25rem 0.5rem 0.4rem; width: calc(100% - 1rem); }
        ul { max-height: 280px; overflow-y: auto; margin: 0; outline: none; }
        li { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.75rem; cursor: pointer; }
        li.active, li:hover { background: #e9f2ff; }
        li[aria-selected="true"] .name { font-weight: 600; }
    `],
})
export class PhoneCountryComponent {
    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

    /** The ISO ids the member can choose from, in the admin's order. */
    readonly countries = input<readonly string[]>([]);
    /** The chosen ISO id. */
    readonly value = model<string>('');
    readonly disabled = input(false);
    /** A country was chosen from the list: the page puts the caret back in the number. */
    readonly chosen = output<string>();

    readonly listId = `phone-country-${nextId++}`;
    readonly searchFrom = SEARCH_FROM;
    readonly open = signal(false);
    readonly active = signal(0);
    readonly query = signal('');

    private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
    private readonly list = viewChild<ElementRef<HTMLElement>>('list');
    private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

    readonly choices = computed(() => this.countries().map((iso) => countryByIso(iso)).filter((c): c is Country => !!c));
    readonly current = computed(() => countryByIso(this.value()) ?? this.choices()[0] ?? null);

    readonly shown = computed(() => {
        const text = this.query().trim().toLowerCase().replace(/^\+/, '');
        if (!text) return this.choices();
        const lang = this.lang();
        return this.choices().filter((country) => country.code.startsWith(text)
            || country.iso.toLowerCase() === text
            || [countryName(country.iso, lang), countryName(country.iso)].some((n) => n.toLowerCase().includes(text)));
    });

    name(iso: string): string {
        return countryName(iso, this.lang());
    }

    flag(iso: string): string {
        return flagUrl(iso);
    }

    noFlag(event: Event): void {
        const img = event.target as HTMLElement;
        img.style.display = 'none';
        img.parentElement?.classList.add('no-flag');
    }

    toggle(): void {
        if (this.open()) this.close(true);
        else this.show();
    }

    private show(): void {
        this.query.set('');
        this.active.set(Math.max(0, this.choices().findIndex((c) => c.iso === this.current()?.iso)));
        this.open.set(true);
        // Focus moves into the list once it is drawn.
        setTimeout(() => (this.search() ?? this.list())?.nativeElement.focus());
    }

    private close(refocus: boolean): void {
        this.open.set(false);
        if (refocus) this.trigger()?.nativeElement.focus();
    }

    choose(iso: string): void {
        this.value.set(iso);
        this.open.set(false);
        this.chosen.emit(iso);
    }

    triggerKey(event: KeyboardEvent): void {
        if (['ArrowDown', 'ArrowUp'].includes(event.key) && !this.open()) {
            event.preventDefault();
            this.show();
        }
    }

    listKey(event: KeyboardEvent): void {
        const count = this.shown().length;
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (count) this.active.set((this.active() + 1) % count);
                break;
            case 'ArrowUp':
                event.preventDefault();
                if (count) this.active.set((this.active() - 1 + count) % count);
                break;
            case 'Home':
                if (event.target === this.list()?.nativeElement) { event.preventDefault(); this.active.set(0); }
                break;
            case 'End':
                if (event.target === this.list()?.nativeElement) { event.preventDefault(); this.active.set(Math.max(0, count - 1)); }
                break;
            case 'Enter':
            case ' ':
                if (event.key === ' ' && event.target !== this.list()?.nativeElement) break;
                event.preventDefault();
                if (count) this.choose(this.shown()[this.active()].iso);
                break;
            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                this.close(true);
                break;
            case 'Tab':
                this.close(false);
                break;
            default:
                // Typing a letter on the list jumps to the first country whose name starts with it.
                if (event.target === this.list()?.nativeElement && /^\p{L}$/u.test(event.key)) {
                    const letter = event.key.toLowerCase();
                    const at = this.shown().findIndex((c) => this.name(c.iso).toLowerCase().startsWith(letter));
                    if (at >= 0) this.active.set(at);
                }
        }
        this.list()?.nativeElement.querySelector(`#${this.listId}-${this.active()}`)?.scrollIntoView?.({ block: 'nearest' });
    }

    /** A press anywhere else closes the list. */
    outside(event: Event): void {
        if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
    }
}
