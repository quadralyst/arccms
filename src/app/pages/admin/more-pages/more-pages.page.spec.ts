/** Content, More Pages (more-pages.page.ts, specs/visual-editing-spec.md VE-D48). */
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';
import { MorePagesService } from './more-pages.service';
import MorePagesPage from './more-pages.page';
import { Component, Input } from '@angular/core';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';

@Component({ selector: 'arc-page-header', standalone: true, template: '<h1>{{ title }}</h1>' })
class FakeHeader {
    @Input() title = '';
    @Input() subtitle = '';
}

async function open(list: ReturnType<typeof vi.fn>): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
        imports: [MorePagesPage, translocoTestingModule()],
        providers: [provideRouter([]), { provide: MorePagesService, useValue: { list } }],
    })
        .overrideComponent(MorePagesPage, { remove: { imports: [PageHeaderComponent] }, add: { imports: [FakeHeader] } })
        .compileComponents();
    const fixture = TestBed.createComponent(MorePagesPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
}

describe('MorePagesPage', () => {
    it('lists the home page and the static pages, each with its status and its editor', async () => {
        const el = await open(vi.fn().mockResolvedValue([
            { pageId: 'home', kind: 'home', name: '', title: '', address: '/', status: 'changes', lastPublished: null },
            { pageId: 'p-about-us', kind: 'static', name: 'about-us', title: 'About us', address: '/p/about-us', status: 'published', lastPublished: 1767600000000 },
        ]));
        const rows = Array.from(el.querySelectorAll('.page-row'));
        expect(rows.map((r) => r.querySelector('.page-name')?.textContent?.trim())).toEqual(['Home page', 'About us']);
        expect(rows[0].textContent).toContain('Changes not published');
        expect(rows[1].textContent).toContain('Published');
        expect(rows[0].querySelector('a.btn')?.getAttribute('href')).toBe('/admin/more-pages/home');
        expect(rows[1].querySelector('a.btn')?.getAttribute('href')).toBe('/admin/more-pages/p/about-us');
        expect(el.textContent).not.toContain('Other pages show here');
    });

    it('says how other pages get here when only the home page is listed', async () => {
        const el = await open(vi.fn().mockResolvedValue([{ pageId: 'home', kind: 'home', name: '', title: '', address: '/', status: 'file', lastPublished: null }]));
        expect(el.textContent).toContain('Other pages show here');
    });

    it('offers to try again when the list cannot be read', async () => {
        const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const el = await open(list);
        expect(el.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    });
});
