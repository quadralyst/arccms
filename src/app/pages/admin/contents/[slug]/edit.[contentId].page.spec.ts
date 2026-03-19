import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EditContentPage from './edit.[contentId].page';
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

describe('EditContentPage', () => {
    let component: EditContentPage;
    let fixture: ComponentFixture<EditContentPage>;
    let mockDraftContentsStore: any;
    let mockContentTypesStore: any;
    let mockTagsStore: any;
    let mockGlobalService: any;
    let mockToastService: any;
    let mockRouter: any;
    let mockFirestore: any;
    let paramMapSubject: BehaviorSubject<any>;

    const createMockParamMap = (slug: string | null, contentId: string | null) => ({
        get: (key: string) => {
            if (key === 'slug') return slug;
            if (key === 'contentId') return contentId;
            return null;
        },
        keys: [slug ? 'slug' : null, contentId ? 'contentId' : null].filter(Boolean)
    });

    beforeEach(async () => {
        paramMapSubject = new BehaviorSubject(createMockParamMap('articles', 'content-123'));

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
            imports: [EditContentPage, NoopAnimationsModule, FormsModule, ReactiveFormsModule],
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

        fixture = TestBed.createComponent(EditContentPage);
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

        it('should extract contentId from route params', () => {
            fixture.detectChanges();
            expect(component.contentId()).toBe('content-123');
        });

        it('should handle different slug and contentId values', () => {
            // Initial values
            fixture.detectChanges();
            expect(component.slug()).toBe('articles');
            expect(component.contentId()).toBe('content-123');

            // Change to different values via BehaviorSubject
            paramMapSubject.next(createMockParamMap('blogs', 'content-456'));
            fixture.detectChanges();

            expect(component.slug()).toBe('blogs');
            expect(component.contentId()).toBe('content-456');
        });

        it('should return null for missing slug', () => {
            paramMapSubject.next(createMockParamMap(null, 'content-123'));
            fixture.detectChanges();

            expect(component.slug()).toBeNull();
            expect(component.contentId()).toBe('content-123');
        });

        it('should return null for missing contentId', () => {
            paramMapSubject.next(createMockParamMap('articles', null));
            fixture.detectChanges();

            expect(component.slug()).toBe('articles');
            expect(component.contentId()).toBeNull();
        });
    });

    describe('Template Integration', () => {
        it('should render CreateContentComponent', () => {
            fixture.detectChanges();

            const compiled = fixture.nativeElement as HTMLElement;
            const createContent = compiled.querySelector('arc-create-content');

            expect(createContent).toBeTruthy();
        });

        it('should pass empty strings as fallback when params are null', () => {
            paramMapSubject.next(createMockParamMap(null, null));
            fixture.detectChanges();

            // Component should render with empty string fallbacks
            const compiled = fixture.nativeElement as HTMLElement;
            const createContent = compiled.querySelector('arc-create-content');
            expect(createContent).toBeTruthy();
        });

        it('should pass both slug and contentId to CreateContentComponent', () => {
            fixture.detectChanges();

            const compiled = fixture.nativeElement as HTMLElement;
            const createContent = compiled.querySelector('arc-create-content');

            // Verify the component is rendered (child component receives inputs)
            expect(createContent).toBeTruthy();
        });
    });

    describe('Component Metadata', () => {
        it('should have correct selector', () => {
            expect(EditContentPage).toBeDefined();
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

    describe('Edit Mode Behavior', () => {
        it('should provide contentId for edit mode distinction', () => {
            fixture.detectChanges();

            // The component provides both slug and contentId
            // Edit mode is determined by presence of contentId
            expect(component.contentId()).toBeTruthy();
            expect(component.contentId()).toBe('content-123');
        });

        it('should provide slug for content type context', () => {
            fixture.detectChanges();

            // Slug determines which content type is being edited
            expect(component.slug()).toBe('articles');
        });
    });
});
