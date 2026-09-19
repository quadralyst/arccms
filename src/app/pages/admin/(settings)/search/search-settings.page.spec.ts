import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { SearchSettingsPage } from './search-settings.page';
import { SearchService } from '../../../../core/services/search.service';

const { getDocMock } = vi.hoisted(() => ({ getDocMock: vi.fn() }));
vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual<typeof import('@angular/fire/firestore')>('@angular/fire/firestore');
    return { ...actual, doc: vi.fn(() => ({})), getDoc: (...args: unknown[]) => getDocMock(...args) };
});

describe('SearchSettingsPage', () => {
    let fixture: ComponentFixture<SearchSettingsPage>;
    let component: SearchSettingsPage;
    let searchMock: { reindex: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        getDocMock.mockResolvedValue({
            exists: () => true,
            data: () => ({
                sources: {
                    content: { documents: 3, entries: 4, reindexedAt: { seconds: 1_700_000_000 } },
                    directory: { documents: 1, entries: 1 },
                },
            }),
        });
        searchMock = {
            reindex: vi.fn().mockResolvedValue([{ source: 'content', documents: 3, entries: 4, removed: 0, collections: [], durationMs: 5 }]),
        };

        await TestBed.configureTestingModule({
            imports: [SearchSettingsPage],
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: SearchService, useValue: searchMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SearchSettingsPage);
        component = fixture.componentInstance;
        await component.ngOnInit();
        fixture.detectChanges();
    });

    it('lists the known sources with their status and unknown ones from the status doc', () => {
        const content = component.rows().find(r => r.id === 'content');
        expect(content?.status?.entries).toBe(4);
        expect(component.rows().find(r => r.id === 'content-drafts')?.status).toBeNull();
        expect(component.unknownRows().map(r => r.id)).toEqual(['directory']);
        expect(component.reindexedAt(content!.status)?.getTime()).toBe(1_700_000_000_000);
    });

    it('rebuilds one source and reports the counts', async () => {
        await component.rebuild('content');
        expect(searchMock.reindex).toHaveBeenCalledWith({ source: 'content' });
        expect(component.message()).toContain('4');
        expect(component.busy()).toBeNull();
    });

    it('rebuilds everything with an empty request and surfaces failures', async () => {
        await component.rebuild();
        expect(searchMock.reindex).toHaveBeenCalledWith({});

        searchMock.reindex.mockRejectedValueOnce(new Error('nope'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await component.rebuild();
        expect(component.error()).toBeTruthy();
        spy.mockRestore();
    });
});
