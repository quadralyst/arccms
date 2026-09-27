/**
 * Tests for DiscoverabilitySettingsPage (docs/discoverability-spec.md, D3)
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscoverabilitySettingsPage } from './discoverability-settings.page';
import { DiscoverabilitySettingsService } from './discoverability-settings.service';
import { AboutSettingsService } from '../about/about-settings.service';
import { DEFAULT_DISCOVERABILITY_SETTINGS } from '../../../../../shared/models/discoverability.model';
import { CRAWLERS } from '../../../../../shared/constants/crawlers';

describe('DiscoverabilitySettingsPage', () => {
    let component: DiscoverabilitySettingsPage;
    let fixture: ComponentFixture<DiscoverabilitySettingsPage>;
    let service: any;

    beforeEach(async () => {
        service = {
            load: vi.fn().mockResolvedValue({
                ...DEFAULT_DISCOVERABILITY_SETTINGS,
                crawlers: { ...DEFAULT_DISCOVERABILITY_SETTINGS.crawlers, gptbot: false },
                indexNow: { enabled: true, key: 'abc' },
            }),
            save: vi.fn().mockResolvedValue(undefined),
            apply: vi.fn().mockResolvedValue({ files: ['/robots.txt', '/llms.txt', '/llms-full.txt', '/abc.txt'], removed: [], indexNowKey: 'abc' }),
        };
        await TestBed.configureTestingModule({
            imports: [DiscoverabilitySettingsPage],
            providers: [
                { provide: DiscoverabilitySettingsService, useValue: service },
                { provide: AboutSettingsService, useValue: { load: vi.fn().mockResolvedValue({ finalUrl: 'https://x.com/' }) } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(DiscoverabilitySettingsPage);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    });

    it('loads settings and renders one switch per registered crawler, grouped', () => {
        const el: HTMLElement = fixture.nativeElement;
        expect(component.settings().crawlers['gptbot']).toBe(false);
        expect(el.querySelectorAll('.crawler-row').length).toBe(CRAWLERS.length);
        expect(el.querySelectorAll('.crawler-group').length).toBe(2);
        const gpt = el.querySelector('[data-testid="crawler-gptbot"] input') as HTMLInputElement;
        expect(gpt.checked).toBe(false);
        expect(component.blockedCount()).toBe(1);
        expect(el.querySelector('code')?.textContent).toBe('abc');
        expect((el.querySelector('a[href="https://x.com/robots.txt"]'))).toBeTruthy();
    });

    it('toggles a crawler, llms.txt and IndexNow', () => {
        component.setCrawler('ccbot', false);
        component.setField('llmsTxt', false);
        component.setIndexNow(false);
        expect(component.settings().crawlers['ccbot']).toBe(false);
        expect(component.settings().llmsTxt).toBe(false);
        expect(component.settings().indexNow.enabled).toBe(false);
        expect(component.blockedCount()).toBe(2);
    });

    it('save without apply only writes the document', async () => {
        await component.save(false);
        expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ llmsTxt: true }));
        expect(service.apply).not.toHaveBeenCalled();
        expect(component.error()).toBe(false);
        expect(component.message()).toContain('next publish');
    });

    it('save and apply pushes the files and reports the count', async () => {
        await component.save(true);
        expect(service.apply).toHaveBeenCalled();
        expect(component.message()).toContain('4');
        expect(component.error()).toBe(false);
    });

    it('reports an apply failure without losing the save', async () => {
        service.apply.mockRejectedValue(new Error('nope'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await component.save(true);
        expect(service.save).toHaveBeenCalled();
        expect(component.error()).toBe(true);
        expect(component.message()).toContain('next publish');
        spy.mockRestore();
    });
});
