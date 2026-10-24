/**
 * The three kinds of zone (specs/clock-and-zones-spec.md, T-D9 to T-D11;
 * docs/app/clock-and-zones.html):
 *
 * - the **site zone**, `timeZone` on Settings/localization, set on Settings, Localization
 *   and by the onboarding wizard; UTC until an admin sets one;
 * - the **member zone**, each person's own, in the admin area too: the device's unless
 *   they chose one, kept on this device like the member language;
 * - a **place zone**, which the app passes for something it owns (a shop's `zone`).
 */
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LocalizationService, readStoredLocalization } from '../services/localization.service';
import { canonicalZone, deviceZone, firstZone } from './zones';

/** Where a person's chosen zone is kept on the device. */
export const MEMBER_ZONE_CACHE_KEY = 'arc-member-zone';

function readChoice(): string | null {
    try {
        return canonicalZone(typeof localStorage === 'undefined' ? null : localStorage.getItem(MEMBER_ZONE_CACHE_KEY));
    } catch {
        return null;
    }
}

let instance: ArcZones | null = null;

/**
 * Set this person's zone from anywhere in the app: `setMemberZone('Europe/Zurich')`, or
 * `setMemberZone(null)` to follow the device again. Kept on this device.
 */
export function setMemberZone(zone: string | null): void {
    if (!instance) throw new Error('setMemberZone: the app has not started yet.');
    instance.useMemberZone(zone);
}

@Injectable({ providedIn: 'root' })
export class ArcZones {
    private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
    private readonly localization = inject(LocalizationService);

    private readonly deviceSignal = signal(deviceZone());
    private readonly choice = signal(this.browser ? readChoice() : null);
    private siteRequested = false;

    /** The zone this device is set to. Read again when the page is shown, for a person who travelled. */
    readonly device = this.deviceSignal.asReadonly();
    /** The zone this person chose on this device, or null when they follow the device. */
    readonly memberChoice = this.choice.asReadonly();
    /** This person's zone: their choice, else the device's. */
    readonly member = computed(() => firstZone(this.choice(), this.deviceSignal()));

    /** The zone the site set, or null: the one read on this visit, else the copy kept on this device. */
    private readonly siteChoice = computed(() =>
        canonicalZone(this.localization.loaded() ? this.localization.settings().timeZone : readStoredLocalization()?.timeZone),
    );

    constructor() {
        instance = this;
        if (!this.browser) return;
        const shown = () => {
            if (document.visibilityState === 'visible') this.deviceSignal.set(deviceZone());
        };
        document.addEventListener('visibilitychange', shown);
        inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', shown));
    }

    /**
     * The site's zone, UTC until an admin sets one. The first read loads Settings/localization
     * (once, shared with the language list); until then the copy kept on this device answers.
     */
    site(): string {
        if (this.browser && !this.siteRequested) {
            this.siteRequested = true;
            void this.localization.load();
        }
        return firstZone(this.siteChoice());
    }

    /** Whether the site has a zone of its own yet. */
    siteIsSet(): boolean {
        this.site();
        return this.siteChoice() !== null;
    }

    /** Choose this person's zone on this device; null, or a name the browser does not know, follows the device again. */
    useMemberZone(zone: string | null): void {
        const known = canonicalZone(zone);
        this.choice.set(known);
        if (!this.browser) return;
        try {
            if (known) localStorage.setItem(MEMBER_ZONE_CACHE_KEY, known);
            else localStorage.removeItem(MEMBER_ZONE_CACHE_KEY);
        } catch {
            // private mode: the choice lasts this visit only
        }
    }
}
