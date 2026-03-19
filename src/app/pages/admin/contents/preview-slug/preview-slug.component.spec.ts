import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreviewSlugComponent } from './preview-slug.component';
import { ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { GlobalService } from '../../../../../shared/services/global.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { DomSanitizer } from '@angular/platform-browser';

describe('PreviewSlugComponent', () => {
    let component: PreviewSlugComponent;
    let fixture: ComponentFixture<PreviewSlugComponent>;
    let mockDraftStore: any;
    let mockGlobalService: any;
    let mockToastService: any;
    let mockSanitizer: any;
    let paramMapSubject: Subject<any>;

    const sampleContent = {
        id: 'content-123',
        title: 'Sample Article',
        content: '<p>This is the content body</p>',
        urlSlug: 'sample-article',
        type: 'article',
        status: 'publish',
        publishedStatus: true,
        coverImage: 'https://example.com/image.jpg',
        tags: ['tech', 'angular'],
        publishedOn: new Date('2024-01-15')
    };

    beforeEach(async () => {
        paramMapSubject = new Subject();

        mockDraftStore = {
            currentItem: signal({}),
            isLoading: signal(false),
            getByCustomField: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        mockGlobalService = {
            goBack: vi.fn(),
            debugMode: false,
        };

        mockToastService = {
            success: vi.fn(),
            error: vi.fn(),
        };

        mockSanitizer = {
            bypassSecurityTrustHtml: vi.fn((html) => html),
        };

        await TestBed.configureTestingModule({
            imports: [PreviewSlugComponent, NoopAnimationsModule],
            providers: [
                { provide: DraftContentsStore, useValue: mockDraftStore },
                { provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable() } },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: ToastService, useValue: mockToastService },
                { provide: DomSanitizer, useValue: mockSanitizer }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(PreviewSlugComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Initialization', () => {
        it('should set isSlugUrlAvailable to true initially', () => {
            expect(component.isSlugUrlAvailable).toBe(true);
        });

        it('should have empty fullUrl initially', () => {
            expect(component.fullUrl).toBe('');
        });

        it('should fetch content by slug from route params', async () => {
            component.ngOnInit();
            paramMapSubject.next({ get: (key: string) => key === 'slug' ? 'my-article' : null });
            await fixture.whenStable();

            expect(mockDraftStore.getByCustomField).toHaveBeenCalledWith('urlSlug', '==', 'my-article');
        });

        it('should not fetch content if no slug provided', async () => {
            component.ngOnInit();
            paramMapSubject.next({ get: () => null });
            await fixture.whenStable();

            expect(mockDraftStore.getByCustomField).not.toHaveBeenCalled();
        });
    });

    describe('Content Data', () => {
        it('should return current item from store', () => {
            mockDraftStore.currentItem = signal(sampleContent);
            fixture = TestBed.createComponent(PreviewSlugComponent);
            component = fixture.componentInstance;

            const data = component.contentDetailedData();
            expect(data.title).toBe('Sample Article');
        });

        it('should return empty object when no content', () => {
            const data = component.contentDetailedData();
            expect(data).toEqual({});
        });
    });

    describe('isEmpty Utility', () => {
        it('should return true for empty object', () => {
            expect(component.isEmpty({})).toBe(true);
        });

        it('should return false for non-empty object', () => {
            expect(component.isEmpty({ id: '123' })).toBe(false);
        });

        it('should return false for object with multiple properties', () => {
            expect(component.isEmpty(sampleContent)).toBe(false);
        });
    });

    describe('getSafeString', () => {
        it('should sanitize HTML content', () => {
            mockDraftStore.currentItem = signal(sampleContent);
            fixture = TestBed.createComponent(PreviewSlugComponent);
            component = fixture.componentInstance;

            component.getSafeString();

            expect(mockSanitizer.bypassSecurityTrustHtml).toHaveBeenCalled();
        });

        it('should replace light color with black', () => {
            const contentWithLightColor = {
                ...sampleContent,
                content: '<p style="color: rgb(243, 244, 245)">Light text</p>'
            };
            mockDraftStore.currentItem = signal(contentWithLightColor);
            fixture = TestBed.createComponent(PreviewSlugComponent);
            component = fixture.componentInstance;

            component.getSafeString();

            expect(mockSanitizer.bypassSecurityTrustHtml).toHaveBeenCalledWith(
                expect.stringContaining('color: #000')
            );
        });

        it('should return empty string for undefined content', () => {
            mockDraftStore.currentItem = signal({});
            fixture = TestBed.createComponent(PreviewSlugComponent);
            component = fixture.componentInstance;

            component.getSafeString();

            expect(mockSanitizer.bypassSecurityTrustHtml).toHaveBeenCalledWith('');
        });
    });

    describe('Loading State', () => {
        it('should reflect loading state from store', () => {
            mockDraftStore.isLoading = signal(true);
            fixture = TestBed.createComponent(PreviewSlugComponent);
            component = fixture.componentInstance;

            expect(component.draftStore.isLoading()).toBe(true);
        });
    });
});
