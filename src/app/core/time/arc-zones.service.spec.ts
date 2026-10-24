import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ArcZones, MEMBER_ZONE_CACHE_KEY, setMemberZone } from './arc-zones.service';
import { LOCALIZATION_CACHE_KEY, LocalizationService } from '../services/localization.service';
import { deviceZone } from './zones';
import type { ILocalizationSettings } from '../../../shared/models/localization.model';

function localization(timeZone?: string) {
    const settings = signal<ILocalizationSettings>({ defaultLanguage: 'en', enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }] });
    const loaded = signal(false);
    const load = vi.fn(async () => {
        settings.set({ ...settings(), ...(timeZone ? { timeZone } : {}) });
        loaded.set(true);
        return settings();
    });
    return { settings, loaded, load };
}

function start(mock = localization(), extra: unknown[] = []): ArcZones {
    TestBed.configureTestingModule({ providers: [{ provide: LocalizationService, useValue: mock }, ...(extra as never[])] });
    return TestBed.inject(ArcZones);
}

describe('ArcZones (specs/clock-and-zones-spec.md, T-D9 to T-D11)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => {
        TestBed.resetTestingModule();
        localStorage.clear();
    });

    it("gives a person the device's zone until they choose one", () => {
        const zones = start();
        expect(zones.member()).toBe(deviceZone());
        expect(zones.memberChoice()).toBeNull();
    });

    it('keeps a chosen zone on this device, in its current name, and forgets it on null', () => {
        const zones = start();
        zones.useMemberZone('Asia/Calcutta');
        expect(zones.member()).toBe('Asia/Kolkata');
        expect(localStorage.getItem(MEMBER_ZONE_CACHE_KEY)).toBe('Asia/Kolkata');
        TestBed.resetTestingModule();
        expect(start().member()).toBe('Asia/Kolkata');
        setMemberZone(null);
        expect(localStorage.getItem(MEMBER_ZONE_CACHE_KEY)).toBeNull();
    });

    it('ignores a zone the browser does not know, kept or chosen', () => {
        localStorage.setItem(MEMBER_ZONE_CACHE_KEY, 'Mars/Olympus');
        const zones = start();
        expect(zones.memberChoice()).toBeNull();
        zones.useMemberZone('+05:30');
        expect(zones.memberChoice()).toBeNull();
        expect(zones.member()).toBe(deviceZone());
    });

    it("reads the site's zone once, sharing the language list's read, and is UTC until one is set", async () => {
        const unset = localization();
        const zones = start(unset);
        expect(zones.site()).toBe('UTC');
        zones.site();
        await Promise.resolve();
        expect(unset.load).toHaveBeenCalledTimes(1);
        expect(zones.siteIsSet()).toBe(false);

        TestBed.resetTestingModule();
        const zurich = localization('Europe/Zurich');
        const site = start(zurich);
        site.site();
        await Promise.resolve();
        expect(site.site()).toBe('Europe/Zurich');
        expect(site.siteIsSet()).toBe(true);
    });

    it("answers from this device's copy of the settings before the read comes back", () => {
        localStorage.setItem(LOCALIZATION_CACHE_KEY, JSON.stringify({ defaultLanguage: 'en', enabledLanguages: [], timeZone: 'America/Phoenix' }));
        const mock = localization();
        mock.load.mockImplementation(() => new Promise(() => {}));
        expect(start(mock).site()).toBe('America/Phoenix');
    });

    it('does not read or store anything on the server render', () => {
        const mock = localization('Europe/Zurich');
        const zones = start(mock, [{ provide: PLATFORM_ID, useValue: 'server' }]);
        expect(zones.site()).toBe('UTC');
        expect(mock.load).not.toHaveBeenCalled();
        zones.useMemberZone('Europe/Zurich');
        expect(localStorage.getItem(MEMBER_ZONE_CACHE_KEY)).toBeNull();
    });
});
