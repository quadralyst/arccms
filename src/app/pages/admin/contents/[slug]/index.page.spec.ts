import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../../test/header-test-providers';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ContentsPage from './index.page';
import { ActivatedRoute } from '@angular/router';
import { of, BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentsStore } from '../content-store/published-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { GlobalService } from '../../../../../shared/services/global.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { ContentTypesService } from '../content-types/content-types.service';
import { DatePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';

describe('ContentsPage', () => {
    let component: ContentsPage;
    let fixture: ComponentFixture<ContentsPage>;
    let mockDraftContentsStore: any;
    let mockContentsStore: any;
    let mockContentTypesStore: any;
    let mockGlobalService: any;
    let mockToastService: any;
    let mockSanitizer: any;
    let mockRouter: any;
    let paramMapSubject: BehaviorSubject<any>;

    const createMockParamMap = (slug: string | null) => ({
        get: (key: string) => key === 'slug' ? slug : null,
        keys: slug ? ['slug'] : []
    });

    beforeEach(async () => {
        paramMapSubject = new BehaviorSubject(createMockParamMap('articles'));

        mockDraftContentsStore = {
            items: signal([]),
            currentItem: signal({}),
            isLoading: signal(false),
            totalRecords: signal(0),
            getAll: vi.fn(() => of([])),
            clearList: vi.fn(),
            delete: vi.fn().mockReturnValue(of({})),
            update: vi.fn().mockReturnValue(of({})),
            unsubscribeStore: vi.fn(),
        };

        mockContentsStore = {
            items: signal([]),
            update: vi.fn().mockReturnValue(of({})),
            unsubscribeStore: vi.fn(),
        };

        mockContentTypesStore = {
            items: signal([{ name: 'Articles', slug: 'articles' }]),
            isLoading: signal(false),
            getAll: vi.fn(() => of([])),
            unsubscribeStore: vi.fn(),
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
        };

        mockSanitizer = {
            bypassSecurityTrustHtml: vi.fn((html) => html),
        };

        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true),
        };

        await TestBed.configureTestingModule({
            imports: [ContentsPage, NoopAnimationsModule],
            providers: [
                ...headerTestProviders(),
                { provide: DraftContentsStore, useValue: mockDraftContentsStore },
                { provide: ContentsStore, useValue: mockContentsStore },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: Firestore, useValue: {} },
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
                { provide: DomSanitizer, useValue: mockSanitizer },
                { provide: ContentTypesService, useValue: { update: vi.fn().mockReturnValue(of({})) } },
                { provide: DatePipe, useValue: { transform: vi.fn(() => '2024-01-01') } },
                { provide: MatDialog, useValue: { open: vi.fn() } }
            ]
        })
            .overrideProvider(ContentTypesService, { useValue: { update: vi.fn().mockReturnValue(of({})) } })
            .overrideProvider(Firestore, { useValue: {} })
            .compileComponents();

        fixture = TestBed.createComponent(ContentsPage);
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
        it('should pass slug to DraftContentsTableComponent', () => {
            fixture.detectChanges();

            const compiled = fixture.nativeElement as HTMLElement;
            const draftContentsTable = compiled.querySelector('arc-draft-contents-table');

            // Component should be present when slug is provided
            expect(draftContentsTable).toBeTruthy();
        });

        it('should hide content when slug is falsy', () => {
            // Set slug to null
            paramMapSubject.next(createMockParamMap(null));
            fixture.detectChanges();

            const compiled = fixture.nativeElement as HTMLElement;
            // Content div should not be present when slug is null/undefined
            const contentDiv = compiled.querySelector('.p-4');
            expect(contentDiv).toBeNull();
        });
    });
});
