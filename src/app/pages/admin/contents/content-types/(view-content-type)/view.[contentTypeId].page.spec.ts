import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Router, ActivatedRoute } from '@angular/router';
import { ViewContentTypeComponent } from './view.[contentTypeId].page';
import { ContentTypesStore } from '../content-types.store';
import { ContentType } from '../content-types.model';
import { ToastService } from '../../../../../../shared/services/toast.service';
import { of } from 'rxjs';

describe('ViewContentTypeComponent', () => {
    let component: ViewContentTypeComponent;
    let fixture: ComponentFixture<ViewContentTypeComponent>;
    let mockStore: any;
    let mockRouter: any;
    let mockToastService: any;

    const mockContentType: ContentType = {
        id: 'test-id',
        name: 'Test Type',
        slug: 'test-type',
        description: 'Test Description',
        icon: 'fa-solid fa-file',
        order: 1,
        fields: [
            {
                key: 'title',
                label: 'Title',
                type: 'text',
                required: true,
                order: 0,
            },
            {
                key: 'content',
                label: 'Content',
                type: 'richtext',
                required: false,
                order: 1,
            },
        ],
        createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
        modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
    };

    beforeEach(async () => {
        mockStore = {
            get: vi.fn().mockReturnValue(mockContentType),
            currentItem: vi.fn().mockReturnValue(mockContentType),
        };

        mockRouter = {
            navigate: vi.fn(),
        };

        mockToastService = {
            openCustomSnackbar: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [ViewContentTypeComponent, CommonModule, MatIconModule],
            providers: [
                { provide: ContentTypesStore, useValue: mockStore },
                { provide: Router, useValue: mockRouter },
                { provide: ToastService, useValue: mockToastService },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { params: {} },
                        params: of({}),
                        queryParams: of({}),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ViewContentTypeComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Initialization', () => {
        it('should initialize with null currentItem', () => {
            expect(component.currentItem).toBeNull();
        });

        it('should have action input', () => {
            expect(component.action).toBeDefined();
        });

        it('should have close output emitter', () => {
            expect(component.close).toBeDefined();
        });
    });

    describe('ID Input Property', () => {
        it('should get and set id', () => {
            component.id = 'new-id';
            expect(component.id).toBe('new-id');
        });

        it('should call store.get when id is set', () => {
            component.id = 'test-id';
            expect(mockStore.get).toHaveBeenCalledWith('test-id');
        });

        it('should set currentItem when id is set', () => {
            component.id = 'test-id';
            expect(component.currentItem).toEqual(mockContentType);
        });

        it('should not call store.get when id is empty', () => {
            mockStore.get.mockClear();
            component.id = '';
            expect(mockStore.get).not.toHaveBeenCalled();
        });

        it('should not set currentItem when id is empty', () => {
            component.currentItem = mockContentType;
            component.id = '';
            expect(component.currentItem).toEqual(mockContentType);
        });
    });

    describe('closeView', () => {
        it('should emit close event', () => {
            const closeSpy = vi.fn();
            component.close.subscribe(closeSpy);
            component.closeView();
            expect(closeSpy).toHaveBeenCalled();
        });

        it('should emit close event without arguments', () => {
            const closeSpy = vi.fn();
            component.close.subscribe(closeSpy);
            component.closeView();
            expect(closeSpy).toHaveBeenCalledWith(undefined);
        });
    });

    describe('Data Display', () => {
        beforeEach(() => {
            component.id = mockContentType.id!;
        });

        it('should display content type name', () => {
            expect(component.currentItem?.name).toBe('Test Type');
        });

        it('should display content type slug', () => {
            expect(component.currentItem?.slug).toBe('test-type');
        });

        it('should display content type description', () => {
            expect(component.currentItem?.description).toBe('Test Description');
        });

        it('should display content type icon', () => {
            expect(component.currentItem?.icon).toBe('fa-solid fa-file');
        });

        it('should display content type order', () => {
            expect(component.currentItem?.order).toBe(1);
        });

        it('should display content type fields', () => {
            expect(component.currentItem?.fields).toHaveLength(2);
        });

        it('should display field details', () => {
            expect(component.currentItem?.fields[0]).toEqual({
                key: 'title',
                label: 'Title',
                type: 'text',
                required: true,
                order: 0,
            });
        });
    });

    describe('Store Integration', () => {
        it('should use ContentTypesStore', () => {
            expect(component.contentTypesStore).toBe(mockStore);
        });

        it('should retrieve item from store by id', () => {
            mockStore.get.mockClear();
            component.id = 'another-id';
            expect(mockStore.get).toHaveBeenCalledWith('another-id');
        });

        it('should handle null return from store', () => {
            mockStore.get.mockReturnValue(null);
            component.id = 'non-existent-id';
            expect(component.currentItem).toBeNull();
        });

        it('should handle undefined return from store', () => {
            mockStore.get.mockReturnValue(undefined);
            component.id = 'undefined-id';
            expect(component.currentItem).toBeUndefined();
        });
    });

    describe('Component Lifecycle', () => {
        it('should update currentItem when id changes', () => {
            const newContentType = { ...mockContentType, id: 'new-id', name: 'New Type' };
            mockStore.get.mockReturnValue(newContentType);

            component.id = 'new-id';
            expect(component.currentItem?.name).toBe('New Type');
        });

        it('should maintain currentItem across multiple id changes', () => {
            component.id = 'id-1';
            expect(component.currentItem).toBeDefined();

            component.id = 'id-2';
            expect(component.currentItem).toBeDefined();
        });
    });

    describe('Action Input', () => {
        it('should accept action input', () => {
            fixture.componentRef.setInput('action', 'view');
            expect(component.action()).toBe('view');
        });

        it('should have default action value', () => {
            expect(component.action()).toBe('action');
        });
    });

    describe('Template Reference Data', () => {
        it('should define built-in content fields', () => {
            expect(component.builtInContentFields.length).toBeGreaterThan(0);
            const keys = component.builtInContentFields.map(f => f.key);
            expect(keys).toContain('title');
            expect(keys).toContain('url');
            expect(keys).toContain('coverImage');
            expect(keys).toContain('content');
            expect(keys).toContain('publishedOn');
            expect(keys).toContain('readTime');
            expect(keys).toContain('excerpt');
        });

        it('should define loop attributes', () => {
            expect(component.loopAttributes.length).toBeGreaterThan(0);
            const keys = component.loopAttributes.map(a => a.key);
            expect(keys).toContain('items');
            expect(keys).toContain('tags');
        });

        it('should define page-level fields', () => {
            expect(component.pageFields.length).toBeGreaterThan(0);
            const keys = component.pageFields.map(f => f.key);
            expect(keys).toContain('contentType');
            expect(keys).toContain('contentTypeSlug');
        });

        it('should define detail-only fields', () => {
            expect(component.detailOnlyFields.length).toBeGreaterThan(0);
            const keys = component.detailOnlyFields.map(f => f.key);
            expect(keys).toContain('share.facebook');
            expect(keys).toContain('previousContent.title');
            expect(keys).toContain('nextContent.url');
        });

        it('should define tag loop fields', () => {
            expect(component.tagLoopFields).toEqual([
                { key: 'name', label: 'Tag name', syntax: '{{ name }}' },
                { key: 'color', label: 'Tag color', syntax: '{{ color }}' },
            ]);
        });

        it('should define directives', () => {
            expect(component.directives.length).toBeGreaterThan(0);
            const keys = component.directives.map(d => d.key);
            expect(keys).toContain('data-arc-bind');
            expect(keys).toContain('data-arc-if');
            expect(keys).toContain('innerHTML');
        });

        it('should include syntax in the correct format for each field', () => {
            for (const field of component.builtInContentFields) {
                expect(field.syntax).toBeTruthy();
                expect(field.label).toBeTruthy();
                expect(field.key).toBeTruthy();
            }
        });

        it('should return custom field entries from content type fields', () => {
            component.id = mockContentType.id!;
            const entries = component.customFieldEntries;
            expect(entries).toHaveLength(2);
            expect(entries[0]).toEqual({
                key: 'title',
                label: 'Title',
                syntax: '{{ title }}',
                note: 'text',
            });
            expect(entries[1]).toEqual({
                key: 'content',
                label: 'Content',
                syntax: '{{ content }}',
                note: 'richtext',
            });
        });

        it('should return empty custom field entries when no content type loaded', () => {
            expect(component.customFieldEntries).toEqual([]);
        });

        it('should return empty custom field entries when fields are undefined', () => {
            mockStore.get.mockReturnValue({ ...mockContentType, fields: undefined });
            component.id = 'test-id';
            expect(component.customFieldEntries).toEqual([]);
        });
    });
});
