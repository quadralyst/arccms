/**
 * Brand kit (RF5): a kit that did not load says so, with Retry, and cannot be saved,
 * so the saved kit is never replaced by the default one.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BrandKitPage from './brand-kit.page';
import { DEFAULT_BRAND_KIT } from '../../../../shared/email-compiler/email-design.model';

const proto = BrandKitPage.prototype as unknown as Record<string, (this: unknown) => unknown>;

function page(read: () => unknown) {
    return {
        service: { getBrandKit: vi.fn(read), saveBrandKit: vi.fn(() => Promise.resolve()) },
        toast: { success: vi.fn(), error: vi.fn() },
        t: (key: string) => key,
        kit: signal({ ...DEFAULT_BRAND_KIT }),
        saving: signal(false),
        loaded: signal(false),
        loadError: signal(false),
    } as Record<string, any>;
}

describe('BrandKitPage', () => {
    it('says the kit did not load and refuses to save the default over it', async () => {
        const c = page(() => throwError(() => new Error('unavailable')));
        proto['load'].call(c);
        expect(c['service'].getBrandKit).toHaveBeenCalledWith({ surfaceErrors: true });
        expect(c['loadError']()).toBe(true);
        expect(c['loaded']()).toBe(false);
        await proto['save'].call(c);
        expect(c['service'].saveBrandKit).not.toHaveBeenCalled();
    });

    it('loads on Retry, then saves', async () => {
        const c = page(() => of({ ...DEFAULT_BRAND_KIT, primaryColor: '#123456' }));
        c['loadError'].set(true);
        proto['load'].call(c);
        expect(c['loadError']()).toBe(false);
        expect(c['loaded']()).toBe(true);
        expect(c['kit']().primaryColor).toBe('#123456');
        await proto['save'].call(c);
        expect(c['service'].saveBrandKit).toHaveBeenCalled();
        expect(c['toast'].success).toHaveBeenCalledWith('admin.email_brand.saved');
    });

    it('shows Retry, keeps Save off until the kit is in, and names the delete buttons', () => {
        const html = readFileSync(resolve(__dirname, 'brand-kit.page.html'), 'utf8');
        expect(html).toContain('[disabled]="saving() || !loaded()"');
        expect(html).toContain('(click)="load()"');
        expect(html).toContain(`'admin.email_brand.delete_social' | transloco`);
    });

    it('shows the preview in the admin language, and follows a switch', async () => {
        const { TestBed } = await import('@angular/core/testing');
        const { TranslocoService, TranslocoTestingModule } = await import('@jsverse/transloco');
        const { BrandKitService } = await import('./brand-kit.service');
        const { ToastService } = await import('../../../../shared/services/toast.service');
        const en = (await import('../../../../assets/i18n/en.json')).default;
        const hi = (await import('../../../../assets/i18n/hi.json')).default;
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [BrandKitPage, TranslocoTestingModule.forRoot({
                langs: { en, hi }, translocoConfig: { availableLangs: ['en', 'hi'], defaultLang: 'en' }, preloadLangs: true,
            })],
            providers: [
                { provide: BrandKitService, useValue: { getBrandKit: () => of({ ...DEFAULT_BRAND_KIT }) } },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
            ],
        }).overrideComponent(BrandKitPage, { set: { template: '', imports: [] } }).compileComponents();
        const fixture = TestBed.createComponent(BrandKitPage);
        const preview = () => String((fixture.componentInstance.previewHtml() as any).changingThisBreaksApplicationSecurity);
        expect(preview()).toContain(en.admin.email_brand.sample_heading);
        TestBed.inject(TranslocoService).setActiveLang('hi');
        expect(preview()).toContain(hi.admin.email_brand.sample_heading);
        expect(preview()).not.toContain('admin.email_brand.sample_heading');
    });
});
