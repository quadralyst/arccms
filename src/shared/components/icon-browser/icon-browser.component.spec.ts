import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconBrowserComponent } from './icon-browser.component';
import { IconLibraryService } from '../../services/icon-library.service';
import { ArcIcon } from '../../models/icon.model';

describe('IconBrowserComponent', () => {
    let component: IconBrowserComponent;
    let fixture: ComponentFixture<IconBrowserComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [IconBrowserComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(IconBrowserComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Drives ngOnInit to completion so the index is in place. */
    async function init(): Promise<void> {
        await component.ngOnInit();
        fixture.detectChanges();
    }

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('loading', () => {
        it('starts in a loading state', () => {
            expect(component.loading()).toBe(true);
        });

        it('clears loading and shows results once the index arrives', async () => {
            await init();
            expect(component.loading()).toBe(false);
            expect(component.failed()).toBe(false);
            expect(component.results().length).toBeGreaterThan(0);
        });

        it('reports failure when the index cannot be loaded', async () => {
            vi.spyOn(TestBed.inject(IconLibraryService), 'loadIndex').mockResolvedValue(null);
            await init();

            expect(component.failed()).toBe(true);
            expect(component.results()).toEqual([]);
        });
    });

    describe('search and filtering', () => {
        beforeEach(init);

        it('narrows the grid to matching icons', () => {
            component.onSearchChange('search');
            expect(component.results().map(r => r.entry.n)).toEqual(['magnifying-glass']);
        });

        it('filters by style', () => {
            component.setStyle('brands');
            expect(component.results().map(r => r.entry.n)).toEqual(['github']);
        });

        it('combines a style filter with a search term', () => {
            component.setStyle('regular');
            component.onSearchChange('folder');
            expect(component.results().map(r => r.classes)).toEqual(['fa-regular fa-folder']);
        });

        it('reports no results for a term that matches nothing', () => {
            component.onSearchChange('zzzznotanicon');
            expect(component.results()).toEqual([]);
            expect(component.totalMatches()).toBe(0);
        });

        it('resets the window when the search changes', () => {
            component.showMore();
            component.onSearchChange('folder');
            expect(component.shownCount()).toBe(120);
        });
    });

    describe('paging', () => {
        beforeEach(init);

        it('reports no more results when everything fits', () => {
            expect(component.hasMore()).toBe(false);
        });

        it('windows the results and grows on demand', async () => {
            // 300 icons is more than the 120-per-page window.
            const many = Array.from({ length: 300 }, (_, i) => ({
                n: `icon-${i}`, l: `Icon ${i}`, s: ['solid' as const], t: '',
            }));
            vi.spyOn(TestBed.inject(IconLibraryService), 'loadIndex')
                .mockResolvedValue({ version: 'test', icons: many });
            await init();

            expect(component.results()).toHaveLength(120);
            expect(component.totalMatches()).toBe(300);
            expect(component.hasMore()).toBe(true);

            component.showMore();
            expect(component.results()).toHaveLength(240);
            expect(component.hasMore()).toBe(true);

            component.showMore();
            expect(component.results()).toHaveLength(300);
            expect(component.hasMore()).toBe(false);
        });
    });

    describe('selection', () => {
        beforeEach(init);

        it('highlights the clicked icon and emits its token', async () => {
            const emitted: (ArcIcon | null)[] = [];
            component.iconSelected.subscribe(icon => emitted.push(icon));

            const target = component.results().find(r => r.entry.n === 'magnifying-glass')!;
            await component.select(target);

            expect(component.selectedKey()).toBe('solid:magnifying-glass');
            expect(emitted).toHaveLength(1);
            expect(emitted[0]).toMatchObject({
                set: 'fa',
                name: 'magnifying-glass',
                classes: 'fa-solid fa-magnifying-glass',
            });
        });

        it('keys a selection by style, so the same icon in two styles is distinct', () => {
            const [solid, regular] = component.results().filter(r => r.entry.n === 'folder');
            expect(component.keyFor(solid)).toBe('solid:folder');
            expect(component.keyFor(regular)).toBe('regular:folder');
        });

        it('does not emit a token that lost the race to a later click', async () => {
            const emitted: (ArcIcon | null)[] = [];
            component.iconSelected.subscribe(icon => emitted.push(icon));

            const first = component.results().find(r => r.entry.n === 'folder' && r.style === 'solid')!;
            const second = component.results().find(r => r.entry.n === 'file' && r.style === 'solid')!;

            // Both clicks are in flight; only the last one may report a result.
            const firstClick = component.select(first);
            const secondClick = component.select(second);
            await Promise.all([firstClick, secondClick]);

            expect(component.selectedKey()).toBe('solid:file');
            expect(emitted.map(icon => icon?.name)).toEqual(['file']);
        });
    });
});
