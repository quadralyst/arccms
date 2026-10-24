/**
 * `{{ moment | arcTime: format : zone : locale }}` (specs/clock-and-zones-spec.md, T-D15;
 * docs/app/clock-and-zones.html). Use it in place of Angular's `| date`, which cannot
 * follow summer time.
 *
 *     {{ m.sentAt | arcTime: 'time' }}                    the reader's zone
 *     {{ m.sentAt | arcTime: 'ago' }}                     "2 minutes ago", from ArcClock
 *     {{ meeting.at | arcTime: 'place' : office.zone }}   "22:00 Zurich (01:30 for you)"
 *
 * Impure, so it follows a change of zone, language or day, but it formats again only when
 * what it shows can change: `ago` each minute, `day` at the reader's midnight.
 */
import { Pipe, PipeTransform, inject } from '@angular/core';
import { ArcTime, type ZoneRef } from './arc-time.service';
import { toMoment, type ArcTimeFormat, type MomentInput } from './arc-time';
import { zonedDayKey } from './zones';

@Pipe({ name: 'arcTime', standalone: true, pure: false })
export class ArcTimePipe implements PipeTransform {
    private readonly time = inject(ArcTime);
    private lastKey = '';
    private lastText = '';

    transform(value: MomentInput, format: ArcTimeFormat = 'dateTime', zone: ZoneRef = 'member', locale?: string): string {
        const moment = toMoment(value);
        if (moment === null) return '';
        // Read here, so the template follows these signals.
        const tz = this.time.zone(zone);
        const viewer = this.time.zone('member');
        const lang = locale || this.time.locale();
        let when = '';
        if (format === 'ago') when = String(Math.trunc((this.time.clock().now() - moment) / 60_000));
        else if (format === 'day') when = zonedDayKey(tz, this.time.clock().now());
        const place = typeof zone === 'object' && zone ? zone.name ?? '' : '';
        const key = `${moment}|${typeof format === 'object' ? JSON.stringify(format) : format}|${tz}|${viewer}|${lang}|${place}|${when}`;
        if (key !== this.lastKey) {
            this.lastKey = key;
            this.lastText = this.time.format(moment, format, zone, locale);
        }
        return this.lastText;
    }
}
