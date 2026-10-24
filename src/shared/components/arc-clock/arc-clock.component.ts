/**
 * The true date and time, and a warning when this device's clock is off
 * (specs/clock-and-zones-spec.md, T-D16; docs/app/clock-and-zones.html). For an app's
 * footer or status bar: `<arc-clock [zone]="shop.zone" format="medium" />`. Core places it
 * nowhere on its own screens.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcTime, type ZoneRef } from '../../../app/core/time/arc-time.service';
import type { ArcTimeFormat } from '../../../app/core/time/arc-time';

/** "7 minutes", "2 hours", in the language on screen. */
export function clockDrift(ms: number, locale: string): string {
    const abs = Math.abs(ms);
    const minutes = Math.round(abs / 60_000);
    const [amount, unit] = abs < 60_000 ? [Math.round(abs / 1000), 'second'] : minutes >= 120 ? [Math.round(minutes / 60), 'hour'] : [minutes, 'minute'];
    try {
        return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(amount);
    } catch {
        return new Intl.NumberFormat('en-US', { style: 'unit', unit, unitDisplay: 'long' }).format(amount);
    }
}

@Component({
    selector: 'arc-clock',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <time class="arc-clock-time" [attr.datetime]="iso()">{{ text() }}</time>
        @if (clock.skewed()) {
        <span class="arc-clock-warning" role="status">
            <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
            {{ (clock.offset() < 0 ? 'common.time.device_fast' : 'common.time.device_slow') | transloco: { amount: drift() } }}
        </span>
        }
    `,
    styles: [`
        :host { display: inline-flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
        .arc-clock-warning { color: var(--arc-clock-warning-color, #b45309); }
    `],
})
export class ArcClockComponent {
    private readonly time = inject(ArcTime);
    readonly clock = this.time.clock();

    /** Which zone to show: the reader's by default, or `site`, an IANA name, or a place. */
    readonly zone = input<ZoneRef>('member');
    /** How to show it: any arcTime format. Default `medium` (date and time with seconds). */
    readonly format = input<ArcTimeFormat>('medium');

    readonly iso = computed(() => new Date(this.clock.now()).toISOString());
    readonly text = computed(() => this.time.format(this.clock.now(), this.format(), this.zone()));
    readonly drift = computed(() => clockDrift(this.clock.offset(), this.time.locale()));
}
