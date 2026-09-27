import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AdminSearchComponent } from './admin-search.component';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import { SearchService } from '../../../app/core/services/search.service';

async function render(isAdmin: boolean) {
    await TestBed.configureTestingModule({
        imports: [AdminSearchComponent],
        providers: [
            { provide: AuthState, useValue: { isAdmin: () => isAdmin, currentUser: () => null } },
            { provide: SearchService, useValue: { isSearchable: () => false, search: vi.fn() } },
            { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminSearchComponent);
    fixture.detectChanges();
    return fixture;
}

describe('AdminSearchComponent', () => {
    it('renders nothing for a non-admin', async () => {
        const fixture = await render(false);
        expect(fixture.nativeElement.querySelector('arc-search-box')).toBeNull();
    });

    it('renders the admin search box with the drafts source, every language and the hotkey', async () => {
        const fixture = await render(true);
        const box = fixture.debugElement.children[0].componentInstance;
        expect(box.scope).toBe('admin');
        expect(box.sources).toEqual(['content-drafts']);
        expect(box.lang).toBe('all');
        expect(box.hotkey).toBe(true);
        expect(box.resultsUrl).toBe('/admin/search');
        expect(fixture.nativeElement.querySelector('input').getAttribute('placeholder')).toBeTruthy();
    });
});
