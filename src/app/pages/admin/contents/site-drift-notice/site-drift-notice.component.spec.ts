import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';
import { SiteDriftNoticeComponent } from './site-drift-notice.component';
import { NO_LIVE_SITE_FILES, SiteDriftService } from '../../../../core/site/site-drift';

async function render(files: string[], compact = false): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
        imports: [SiteDriftNoticeComponent, translocoTestingModule()],
        providers: [{ provide: SiteDriftService, useValue: { differences: vi.fn().mockResolvedValue(files) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SiteDriftNoticeComponent);
    fixture.componentRef.setInput('compact', compact);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
}

describe('SiteDriftNoticeComponent', () => {
    it('shows nothing when the site files match the live site', async () => {
        expect((await render([])).querySelector('.site-drift-notice')).toBeNull();
    });

    it('says the live site differs, naming the files on hover', async () => {
        const el = await render(['_site/home.html'], true);
        const notice = el.querySelector('.site-drift-notice') as HTMLElement;
        expect(notice.textContent).toContain('Live site differs');
        expect(notice.title).toContain('Deploy the website first');
        expect(notice.title).toContain('_site/home.html');
    });

    it('says the live site has no site files yet', async () => {
        const el = await render([NO_LIVE_SITE_FILES]);
        expect(el.querySelector('.site-drift-notice')!.textContent).toContain('no site files yet');
    });
});
