/**
 * `arcTime` for code (specs/clock-and-zones-spec.md, T-D15; docs/app/clock-and-zones.html):
 * picks the zone (member, site, device, or a place's), the locale of the language on
 * screen, and the true now for "Today" and "2 minutes ago", then formats with
 * formatArcTime (arc-time.ts). Templates use the `arcTime` pipe, which calls this.
 */
import { Injectable, Injector, LOCALE_ID, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { MEMBER_LANGUAGE_LIST } from '../i18n/member-language.service';
import { ArcClock } from './arc-clock';
import { ArcZones } from './arc-zones.service';
import { formatArcTime, type ArcTimeFormat, type MomentInput } from './arc-time';
import { firstZone } from './zones';

/** A place's zone, with its name for labels ("22:00 Main Street (01:30 for you)"). */
export interface PlaceZone {
    zone: string | null | undefined;
    name?: string;
}

/** Which zone: `member` (the reader's, the default), `site`, `device`, an IANA name, or a place. */
export type ZoneRef = 'member' | 'site' | 'device' | PlaceZone | (string & {}) | null | undefined;

/**
 * The locale for a language on screen: a member language's own (`de-CH`); for a bare
 * code such as `en`, the browser's regional variant of it when it has one (`en-GB`
 * reads 22:00, `en` alone 10:00 PM); else the code.
 */
export function localeForLanguage(code: string, browserLanguages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? []): string {
    const declared = MEMBER_LANGUAGE_LIST.find((l) => l.code === code)?.locale;
    if (declared && declared !== 'en-US') return declared;
    if (code.includes('-')) return code;
    const regional = browserLanguages.find((tag) => tag.toLowerCase().startsWith(`${code.toLowerCase()}-`));
    return regional ?? declared ?? code;
}

let instance: ArcTime | null = null;

/**
 * A moment as text, from anywhere in the app: `arcTime(sale.at, 'place', shop.zone)`.
 * The same as the `arcTime` pipe.
 */
export function arcTime(value: MomentInput, format: ArcTimeFormat = 'dateTime', zone: ZoneRef = 'member', locale?: string): string {
    if (!instance) throw new Error('arcTime: the app has not started yet.');
    return instance.format(value, format, zone, locale);
}

@Injectable({ providedIn: 'root' })
export class ArcTime {
    private readonly zones = inject(ArcZones);
    private readonly transloco = inject(TranslocoService);
    private readonly injector = inject(Injector);
    private readonly angularLocale = inject(LOCALE_ID);
    private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
    private clockRef: ArcClock | null = null;

    /** The locale of the language on screen; it follows a switch at once. */
    readonly locale = computed(() => localeForLanguage(this.lang()));

    constructor() {
        instance = this;
    }

    /** The clock, made on first need: a page that shows no relative time never measures. */
    clock(): ArcClock {
        return (this.clockRef ??= this.injector.get(ArcClock));
    }

    /** The IANA name a zone reference stands for, with the fallbacks of T-D11. */
    zone(ref: ZoneRef = 'member'): string {
        if (ref === null || ref === undefined || ref === 'member') return this.zones.member();
        if (ref === 'site') return this.zones.site();
        if (ref === 'device') return this.zones.device();
        const place = typeof ref === 'object' ? ref.zone : ref;
        return firstZone(place, this.zones.site());
    }

    /** A moment as text: see `arcTime`. */
    format(value: MomentInput, format: ArcTimeFormat = 'dateTime', zone: ZoneRef = 'member', locale?: string): string {
        const needsNow = format === 'day' || format === 'ago';
        return formatArcTime(value, format, this.zone(zone), {
            locale: locale || this.locale(),
            angularLocale: this.angularLocale,
            now: needsNow ? this.clock().now() : undefined,
            viewerZone: this.zones.member(),
            placeName: typeof zone === 'object' && zone ? zone.name : undefined,
            forYou: (time) => this.transloco.translate('common.time.for_you', { time }),
        });
    }
}
