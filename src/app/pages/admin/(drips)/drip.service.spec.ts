/**
 * The campaign, broadcast and brand kit reads (RF5): a page that asks gets the failure,
 * every other caller keeps its quiet fallback.
 */
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { firstValueFrom, throwError } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@angular/fire/firestore', async (orig) => ({
    ...(await orig<object>()),
    collection: vi.fn(() => ({})),
    query: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    doc: vi.fn(() => ({})),
    collectionData: vi.fn(() => throwError(() => new Error('permission-denied'))),
    getDoc: vi.fn(() => Promise.reject(new Error('unavailable'))),
}));

import { DripService } from './drip.service';
import { BroadcastService } from '../(broadcasts)/broadcast.service';
import { BrandKitService } from '../(email-brand)/brand-kit.service';
import { DEFAULT_BRAND_KIT } from '../../../../shared/email-compiler/email-design.model';
import { SiteBrandService } from '../../../core/brand/site-brand';

describe('load failures', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        TestBed.configureTestingModule({
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: Functions, useValue: {} },
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: SiteBrandService, useValue: {} },
            ],
        });
    });

    it('drip campaigns: empty for the list hub, an error for the Drip campaigns page', async () => {
        const service = TestBed.inject(DripService);
        expect(await firstValueFrom(service.watchCampaigns())).toEqual([]);
        await expect(firstValueFrom(service.watchCampaigns({ surfaceErrors: true }))).rejects.toThrow('permission-denied');
    });

    it('broadcasts: empty for the list hub, an error for the Broadcasts page', async () => {
        const service = TestBed.inject(BroadcastService);
        expect(await firstValueFrom(service.watchRecent())).toEqual([]);
        await expect(firstValueFrom(service.watchRecent(20, { surfaceErrors: true }))).rejects.toThrow('permission-denied');
    });

    it("drip campaigns and broadcasts: empty, with onError told, for a list's Sequence and Broadcasts tabs", async () => {
        const drips = TestBed.inject(DripService);
        const broadcasts = TestBed.inject(BroadcastService);
        const onError = vi.fn();
        expect(await firstValueFrom(drips.watchCampaigns({ onError }))).toEqual([]);
        expect(await firstValueFrom(broadcasts.watchRecent(100, { onError }))).toEqual([]);
        expect(onError).toHaveBeenCalledTimes(2);
        expect(String(onError.mock.calls[0][0])).toContain('permission-denied');
    });

    it('brand kit: the default for the editors, an error for the Brand kit page', async () => {
        const service = TestBed.inject(BrandKitService);
        expect(await firstValueFrom(service.getBrandKit())).toEqual({ ...DEFAULT_BRAND_KIT });
        await expect(firstValueFrom(service.getBrandKit({ surfaceErrors: true }))).rejects.toThrow('unavailable');
    });
});
