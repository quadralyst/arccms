/**
 * Zone picker (specs/clock-and-zones-spec.md, T-D16; docs/app/clock-and-zones.html): the
 * chosen time zone as people read it ("Zurich, GMT+2") and a Change button that opens a
 * search by city, zone name ("India Standard Time") or offset ("GMT+5:30"). With
 * `allowAutomatic`, "Automatic" follows the device and is `null`. Settings, Localization
 * uses it for the site zone, the profile page for the person's own; an app can use it for
 * the zone of a place it owns.
 *
 * Its value is always an IANA name, or null for Automatic.
 */
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, model, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcTime } from '../../../app/core/time/arc-time.service';
import { allZones, canonicalZone, deviceZone, zoneCity, zoneLabel } from '../../../app/core/time/zones';

/** Results shown at once; typing more narrows them. */
const MAX_RESULTS = 8;

let nextId = 0;

interface ZoneEntry {
    zone: string;
    label: string;
    /** Its long name, lower case: "india standard time". */
    long: string;
    /** Lower-case text a search matches: the zone, its label (city and offset) and its long name. */
    haystack: string;
}

@Component({
    selector: 'arc-zone-picker',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (!open()) {
        <div class="current">
            <span class="zone-now" [attr.data-zone]="value() ?? 'automatic'">
                @if (value()) { {{ labelOf(value()!) }} }
                @else if (allowAutomatic()) { {{ 'common.time.automatic' | transloco: { zone: labelOf(device) } }} }
                @else { <span class="text-muted">{{ 'common.time.not_set' | transloco }}</span> }
            </span>
            <button type="button" class="btn btn-sm btn-outline-secondary change" (click)="start()" [disabled]="disabled()">
                <i class="fas fa-pen me-1"></i> {{ 'common.time.change' | transloco }}
            </button>
        </div>
        } @else {
        <div class="search">
            <input #box type="search" class="form-control" autocomplete="off" role="combobox"
                [id]="inputId()" [attr.aria-label]="label() || null" aria-expanded="true" [attr.aria-controls]="listId"
                [attr.aria-activedescendant]="results().length ? listId + '-' + active() : null"
                [placeholder]="'common.time.search' | transloco"
                (input)="search($any($event.target).value)" (keydown)="key($event)" (blur)="close()" />
            <ul class="results list-unstyled" role="listbox" [id]="listId">
                @for (entry of results(); track entry.zone; let i = $index) {
                <li role="option" [id]="listId + '-' + i" [attr.aria-selected]="i === active()" [class.active]="i === active()"
                    [attr.data-zone]="entry.zone" (mousedown)="$event.preventDefault()" (click)="choose(entry.zone)">
                    @if (entry.zone === AUTOMATIC) { {{ 'common.time.automatic' | transloco: { zone: labelOf(device) } }} } @else { {{ entry.label }} }
                </li>
                } @empty {
                <li class="none text-muted">{{ 'common.time.none' | transloco }}</li>
                }
            </ul>
        </div>
        }
    `,
    styles: [`
        :host { display: block; }
        .current { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .zone-now { flex: 1; min-width: 12rem; }
        .search { position: relative; max-width: 360px; }
        .results { position: absolute; z-index: 10; left: 0; right: 0; margin-top: 2px; background: #fff; border: 1px solid #dee2e6; border-radius: 0.375rem; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); max-height: 320px; overflow-y: auto; }
        .results li { padding: 0.4rem 0.75rem; cursor: pointer; }
        .results li.active, .results li[role="option"]:hover { background: #e9f2ff; }
        .results li.none { cursor: default; }
    `],
})
export class ZonePickerComponent {
    /** The `Automatic` row's id in the results; never a value. */
    readonly AUTOMATIC = '';
    private readonly time = inject(ArcTime);

    /** The chosen IANA name, or null for Automatic. */
    readonly value = model<string | null>(null);
    /** Offer "Automatic", which follows the device (value null). */
    readonly allowAutomatic = input(false);
    readonly disabled = input(false);
    /** The id for the search box, so a page's `<label for>` can name it. */
    readonly inputId = input<string>(`zone-picker-${nextId}`);
    /** A name for the search box when the page has no `<label>` for it. */
    readonly label = input<string>('');

    readonly listId = `zone-picker-list-${nextId++}`;
    readonly device = deviceZone();
    private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
    readonly open = signal(false);
    readonly query = signal('');
    readonly active = signal(0);

    /** Every zone with its label and search text, made on first open (about 420 zones). */
    private entries: ZoneEntry[] | null = null;

    constructor() {
        // Focus the box as soon as it is drawn.
        effect(() => {
            if (this.open()) this.box()?.nativeElement.focus();
        });
    }

    readonly results = computed<ZoneEntry[]>(() => {
        if (!this.open()) return [];
        const text = this.query().trim().toLowerCase();
        const automatic: ZoneEntry[] = this.allowAutomatic() ? [{ zone: this.AUTOMATIC, label: '', long: '', haystack: '' }] : [];
        const all = this.allEntries();
        if (!text) {
            // Nothing typed yet: the current choice and the device's zone, to confirm or move on from.
            const near = [...new Set([this.value(), this.device].filter((z): z is string => !!z))];
            return [...automatic, ...near.map((zone) => all.find((e) => e.zone === zone)).filter((e): e is ZoneEntry => !!e)];
        }
        const rank = (entry: ZoneEntry): number => {
            const city = zoneCity(entry.zone).toLowerCase();
            if (city.startsWith(text) || entry.zone.toLowerCase() === text) return 0;
            if (entry.long.startsWith(text) || entry.label.toLowerCase().includes(text)) return 1;
            if (entry.zone.toLowerCase().includes(text)) return 2;
            if (entry.haystack.includes(text)) return 3;
            return -1;
        };
        return all
            .map((entry) => ({ entry, r: rank(entry) }))
            .filter(({ r }) => r >= 0)
            .sort((a, b) => a.r - b.r || a.entry.label.localeCompare(b.entry.label))
            .slice(0, MAX_RESULTS)
            .map(({ entry }) => entry);
    });

    labelOf(zone: string): string {
        return zoneLabel(zone, Date.now(), this.time.locale());
    }

    start(): void {
        this.query.set('');
        this.active.set(0);
        this.open.set(true);
    }

    close(): void {
        this.open.set(false);
    }

    search(text: string): void {
        this.query.set(text);
        this.active.set(0);
    }

    choose(zone: string): void {
        this.value.set(zone === this.AUTOMATIC ? null : canonicalZone(zone));
        this.close();
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
            this.choose(this.results()[this.active()].zone);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.close();
        }
    }

    private allEntries(): ZoneEntry[] {
        if (this.entries) return this.entries;
        const now = Date.now();
        const locale = this.time.locale();
        this.entries = allZones().map((zone) => {
            const label = zoneLabel(zone, now, locale);
            let long = '';
            try {
                long = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longGeneric' })
                    .formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
            } catch {
                long = '';
            }
            return { zone, label, long: long.toLowerCase(), haystack: `${zone} ${label} ${long}`.toLowerCase().replace(/_/g, ' ') };
        });
        return this.entries;
    }
}
