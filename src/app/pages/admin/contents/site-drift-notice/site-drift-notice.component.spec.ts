import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';
import { SiteDriftNoticeComponent } from './site-drift-notice.component';
import { NO_LIVE_SITE_FILES, SiteDriftService } from '../../../../core/site/site-drift';

async function render(files: string[], compact = false): Promise<HTMLElement> {
    return (await renderFixture(files, compact)).nativeElement as HTMLElement;
}

async function renderFixture(files: string[], compact = false) {
    await TestBed.configureTestingModule({
        imports: [SiteDriftNoticeComponent, translocoTestingModule()],
        providers: [{ provide: SiteDriftService, useValue: { differences: vi.fn().mockResolvedValue(files) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SiteDriftNoticeComponent);
    fixture.componentRef.setInput('compact', compact);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
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

    it('in a toolbar, opens the message on a tap (a phone shows only the icon) and closes it on a tap elsewhere', async () => {
        const fixture = await renderFixture(['_site/home.html'], true);
        const el = fixture.nativeElement as HTMLElement;
        const button = el.querySelector('button.site-drift-notice') as HTMLButtonElement;
        expect(button.getAttribute('aria-label')).toBe('Live site differs');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(el.querySelector('.site-drift-popover')).toBeNull();

        button.click();
        fixture.detectChanges();
        const popover = el.querySelector('.site-drift-popover') as HTMLElement;
        expect(popover.textContent).toContain('Live site differs');
        expect(popover.textContent).toContain('Deploy the website first');
        expect(button.getAttribute('aria-expanded')).toBe('true');
        // Kept on screen, however narrow the window.
        expect(parseFloat(popover.style.left)).toBeGreaterThanOrEqual(16);
        expect(parseFloat(popover.style.width)).toBeLessThanOrEqual(window.innerWidth - 32);

        document.body.click();
        fixture.detectChanges();
        expect(el.querySelector('.site-drift-popover')).toBeNull();
    });

    it('closes the message on Escape and on a scroll', async () => {
        const fixture = await renderFixture(['_site/home.html'], true);
        const el = fixture.nativeElement as HTMLElement;
        const button = el.querySelector('button.site-drift-notice') as HTMLButtonElement;
        button.click();
        fixture.detectChanges();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();
        expect(el.querySelector('.site-drift-popover')).toBeNull();

        button.click();
        fixture.detectChanges();
        document.body.dispatchEvent(new Event('scroll'));
        fixture.detectChanges();
        expect(el.querySelector('.site-drift-popover')).toBeNull();
    });

    it('says the live site has no site files yet', async () => {
        const el = await render([NO_LIVE_SITE_FILES]);
        expect(el.querySelector('.site-drift-notice')!.textContent).toContain('no site files yet');
    });
});
