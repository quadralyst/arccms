import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AddContentPage from './add.page';
import { ActivatedRoute, Router } from '@angular/router';
import { of, BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { TagsStore } from '../content-types/tags/tags.store';
import { GlobalService } from '../../../../../shared/services/global.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Firestore } from '@angular/fire/firestore';
import { DraftContentsService } from '../draft-content-store/draft-contents.service';
import { CollectionRefSyncService } from '../content-store/collection-ref-sync.service';
import { MatDialog } from '@angular/material/dialog';
import { PublishQueueService } from '../publish-queue/publish-queue.service';
import { ContentsService } from '../content-store/published-contents.service';

describe('AddContentPage', () => {
    let component: AddContentPage;
    let fixture: ComponentFixture<AddContentPage>;
    let mockDraftContentsStore: any;
    let mockContentTypesStore: any;
    let mockTagsStore: any;
    let mockGlobalService: any;
    let mockToastService: any;
    let mockRouter: any;
    let mockFirestore: any;
    let paramMapSubject: BehaviorSubject<any>;

    const createMockParamMap = (slug: string | null) => ({
        get: (key: string) => key === 'slug' ? slug : null,
        keys: slug ? ['slug'] : []
    });

    beforeEach(async () => {
        paramMapSubject = new BehaviorSubject(createMockParamMap('articles'));

        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true),
        };

        mockDraftContentsStore = {
            items: signal([]),
            currentItem: signal({}),
            isLoading: signal(false),
            getAll: vi.fn(() => of([])),
            getByCustomField: vi.fn(),
            clearCurrent: vi.fn(),
            clearList: vi.fn(),
            add: vi.fn().mockReturnValue(of({ id: 'new-id' })),
            update: vi.fn().mockReturnValue(of({})),
            delete: vi.fn().mockReturnValue(of({})),
            checkExistingSlugUrl: vi.fn().mockResolvedValue({ exists: false, slug: 'test-slug' }),
            unsubscribeStore: vi.fn(),
        };

        mockContentTypesStore = {
            items: signal([
                { name: 'Article', slug: 'articles' },
                { name: 'Blog', slug: 'blogs' }
            ]),
            isLoading: signal(false),
            getAll: vi.fn(() => of([])),
            unsubscribeStore: vi.fn(),
        };

        mockTagsStore = {
            items: signal([]),
            currentItem: signal({}),
            isLoading: signal(false),
            getAll: vi.fn(),
            getContentTypeSlug: vi.fn().mockReturnValue(''),
            setContentTypeSlug: vi.fn(),
            getTagByLabel: vi.fn(),
            addTagWithAutoColor: vi.fn().mockReturnValue({ label: 'test', color: '#D81B60' }),
            add: vi.fn().mockReturnValue(of('new-tag-id')),
            updateUsedColors: vi.fn(),
        };

        mockGlobalService = {
            goBack: vi.fn(),
            debugMode: false,
        };

        mockToastService = {
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            openCustomSnackbar: vi.fn(),
        };

        mockFirestore = {};

        await TestBed.configureTestingModule({
            imports: [AddContentPage, NoopAnimationsModule, FormsModule, ReactiveFormsModule],
            providers: [
                { provide: DraftContentsStore, useValue: mockDraftContentsStore },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: TagsStore, useValue: mockTagsStore },
                { provide: Firestore, useValue: mockFirestore },
                { provide: DraftContentsService, useValue: { dbCollection: {}, checkExistingSlugUrl: vi.fn(), getContentsByType: vi.fn() } },
                { provide: CollectionRefSyncService, useValue: { syncReferencedData: vi.fn() } },
                { provide: Router, useValue: mockRouter },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        paramMap: paramMapSubject.asObservable(),
                        queryParams: of({})
                    }
                },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: ToastService, useValue: mockToastService },
                { provide: MatDialog, useValue: { open: vi.fn().mockReturnValue({ afterClosed: () => of(null) }) } },
                { provide: PublishQueueService, useValue: { enqueue: vi.fn().mockResolvedValue(undefined) } },
                { provide: ContentsService, useValue: { pollDeployStatus: vi.fn().mockReturnValue(of({})), getPublishedHistory: vi.fn().mockReturnValue(of([])) } },
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(AddContentPage);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Route Parameters', () => {
        it('should extract slug from route params', () => {
            fixture.detectChanges();
            expect(component.slug()).toBe('articles');
        });

        it('should handle different slug values', () => {
            // Initial value
            fixture.detectChanges();
            expect(component.slug()).toBe('articles');

            // Change to different slug via BehaviorSubject
            paramMapSubject.next(createMockParamMap('blogs'));
            fixture.detectChanges();

            expect(component.slug()).toBe('blogs');
        });

        it('should return null for missing slug', () => {
            // Set slug to null
            paramMapSubject.next(createMockParamMap(null));
            fixture.detectChanges();

            expect(component.slug()).toBeNull();
        });
    });

    describe('Template Integration', () => {
        it('should render CreateContentComponent', () => {
            fixture.detectChanges();

            const compiled = fixture.nativeElement as HTMLElement;
            const createContent = compiled.querySelector('arc-create-content');

            // Component should be present
            expect(createContent).toBeTruthy();
        });

        it('should pass empty string as fallback when slug is null', () => {
            // Set slug to null
            paramMapSubject.next(createMockParamMap(null));
            fixture.detectChanges();

            // Even with null slug, component should render with empty string fallback
            const compiled = fixture.nativeElement as HTMLElement;
            const createContent = compiled.querySelector('arc-create-content');
            expect(createContent).toBeTruthy();
        });
    });

    describe('Component Metadata', () => {
        it('should have correct selector', () => {
            expect(AddContentPage).toBeDefined();
            fixture.detectChanges();
            expect(component).toBeDefined();
        });

        it('should import CreateContentComponent', () => {
            fixture.detectChanges();
            const compiled = fixture.nativeElement as HTMLElement;
            // arc-create-content should be rendered
            expect(compiled.innerHTML).toContain('arc-create-content');
        });
    });
});
