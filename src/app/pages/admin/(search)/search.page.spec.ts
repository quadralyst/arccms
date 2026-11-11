import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import AdminSearchPage from './search.page';
import { SearchService } from '../../../core/services/search.service';
import { headerTestProviders } from '../../../../test/header-test-providers';

describe('AdminSearchPage', () => {
    let fixture: ComponentFixture<AdminSearchPage>;
    let component: AdminSearchPage;
    let params: BehaviorSubject<{ get: (key: string) => string | null }>;
    let searchMock: { isSearchable: (q: string) => boolean; search: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        params = new BehaviorSubject({ get: (key: string) => (key === 'q' ? 'ver' : null) });
        searchMock = {
            isSearchable: (q: string) => q.trim().length >= 2,
            search: vi.fn().mockResolvedValue({
                results: [{ source: 'content-drafts', docId: 'a', lang: 'en', title: 'Anjali Verma', link: '/admin/contents/people/edit/a', badge: 'People', score: 1, highlights: { title: [[7, 10]], snippet: [] } }],
                tookMs: 12,
                fallbackUsed: undefined,
            }),
        };

        await TestBed.configureTestingModule({
            imports: [AdminSearchPage],
            providers: [
                ...headerTestProviders(),
                { provide: SearchService, useValue: searchMock },
                { provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() } },
                { provide: Router, useValue: { navigateByUrl: vi.fn(), navigate: vi.fn(), createUrlTree: vi.fn(() => ({})), serializeUrl: vi.fn(() => '/x'), events: new BehaviorSubject(null) } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AdminSearchPage);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    });

    it('searches the drafts index across every language for the q parameter', () => {
        expect(searchMock.search).toHaveBeenCalledWith({ q: 'ver', lang: 'all', scope: 'admin', except: ['content'], limit: 20 });
        expect(component.results()).toHaveLength(1);
        expect(component.tookMs()).toBe(12);
    });

    it('renders the results list with highlights', () => {
        const title = fixture.nativeElement.querySelector('.arc-results__title');
        expect(title.textContent.trim()).toBe('Anjali Verma');
        expect(title.querySelector('mark').textContent).toBe('Ver');
    });

    it('re-runs when the query parameter changes and skips short queries', async () => {
        params.next({ get: () => 'g' });
        await fixture.whenStable();
        expect(component.query()).toBe('g');
        expect(component.results()).toEqual([]);
        expect(searchMock.search).toHaveBeenCalledTimes(1);
    });

    it('says the search did not run, with Retry, rather than "nothing matched"', async () => {
        searchMock.search.mockRejectedValueOnce(new Error('FirebaseError: internal'));
        await component.run('ver');
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const alert = root.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('The search did not run');
        expect(root.textContent).not.toContain('internal');
        expect(root.textContent).not.toContain('Nothing matched');

        (alert.querySelector('button') as HTMLButtonElement).click();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(component.failed()).toBe(false);
        expect(component.results()).toHaveLength(1);
    });

    it('keeps the newest results when an older, slower search fails later', async () => {
        let failOld: (e: Error) => void = () => {};
        searchMock.search.mockImplementationOnce(() => new Promise((_, reject) => (failOld = reject)));
        const older = component.run('old query');
        await component.run('kar');
        expect(component.results()).toHaveLength(1);

        failOld(new Error('timeout'));
        await older;
        expect(component.results()).toHaveLength(1);
        expect(component.failed()).toBe(false);
        expect(component.loading()).toBe(false);
        expect(component.query()).toBe('kar');
    });
});
