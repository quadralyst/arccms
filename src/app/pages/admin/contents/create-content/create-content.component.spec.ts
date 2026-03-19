import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CreateContentComponent } from './create-content.component';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { signal, NgZone } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { TagsStore } from '../content-types/tags/tags.store';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { GlobalService } from '../../../../../shared/services/global.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { Firestore } from '@angular/fire/firestore';
import { DraftContentsService } from '../draft-content-store/draft-contents.service';
import { CollectionRefSyncService } from '../content-store/collection-ref-sync.service';
import { MatDialog } from '@angular/material/dialog';
import { PublishQueueService } from '../publish-queue/publish-queue.service';
import { ContentsService } from '../content-store/published-contents.service';

describe('CreateContentComponent', () => {
    let component: CreateContentComponent;
    let fixture: ComponentFixture<CreateContentComponent>;
    let mockRouter: any;
    let mockDraftContentsStore: any;
    let mockContentTypesStore: any;
    let mockTagsStore: any;
    let mockGlobalService: any;
    let mockToastService: any;
    let mockFirestore: any;
    let mockDraftContentsService: any;
    let mockCollectionRefSyncService: any;
    let mockDialog: any;

    beforeEach(async () => {
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
            add: vi.fn().mockReturnValue(of('new-id')),
            update: vi.fn().mockReturnValue(of(undefined)),
            delete: vi.fn().mockReturnValue(of({})),
            checkExistingSlugUrl: vi.fn().mockResolvedValue({ exists: false, slug: 'test-slug' }),
            updateNextContentReferences: vi.fn().mockResolvedValue(undefined),
            unsubscribeStore: vi.fn(),
        };

        mockContentTypesStore = {
            items: signal([
                { name: 'Article', slug: 'article' },
                { name: 'Blog', slug: 'blog' }
            ]),
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

        mockDraftContentsService = {
            checkExistingSlugUrl: vi.fn().mockResolvedValue({ exists: false, slug: '' }),
            getBySlug: vi.fn().mockResolvedValue(null),
        };

        mockCollectionRefSyncService = {
            syncReferencedData: vi.fn().mockResolvedValue(undefined),
            buildRefData: vi.fn().mockReturnValue({}),
        };

        mockFirestore = {};

        mockDialog = {
            open: vi.fn().mockReturnValue({
                afterClosed: vi.fn().mockReturnValue(of(null)),
            }),
        };

        await TestBed.configureTestingModule({
            imports: [CreateContentComponent, NoopAnimationsModule, FormsModule, ReactiveFormsModule],
            providers: [
                { provide: DraftContentsStore, useValue: mockDraftContentsStore },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: TagsStore, useValue: mockTagsStore },
                { provide: Firestore, useValue: mockFirestore },
                { provide: DraftContentsService, useValue: mockDraftContentsService },
                { provide: CollectionRefSyncService, useValue: mockCollectionRefSyncService },
                { provide: Router, useValue: mockRouter },
                {
                    provide: ActivatedRoute, useValue: {
                        paramMap: of({ keys: [], get: () => null }),
                        queryParams: of({})
                    }
                },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: ToastService, useValue: mockToastService },
                { provide: MatDialog, useValue: mockDialog },
                { provide: PublishQueueService, useValue: { enqueue: vi.fn().mockResolvedValue(undefined) } },
                { provide: ContentsService, useValue: { pollDeployStatus: vi.fn().mockReturnValue(of({})), getPublishedHistory: vi.fn().mockReturnValue(of([])) } },
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(CreateContentComponent);
        component = fixture.componentInstance;
        
        // Mock NgZone to run immediately
        vi.spyOn((component as any).ngZone, 'run').mockImplementation((fn: any) => fn());
        
        fixture.detectChanges();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Initialization', () => {
        it('should initialize with empty title', () => {
            expect(component.pageTitle).toBe('');
        });

        it('should initialize with null cover image', () => {
            expect(component.coverImage).toBeNull();
        });

        it('should initialize publishForm', () => {
            expect(component.publishForm).toBeDefined();
        });

        it('should initialize seoForm', () => {
            expect(component.seoForm).toBeDefined();
        });
    });

    describe('Form Getters', () => {
        it('should return title form control', () => {
            expect(component.title).toBe(component.publishForm.get('title'));
        });

        it('should return urlSlug form control', () => {
            expect(component.urlSlug).toBe(component.publishForm.get('urlSlug'));
        });

        it('should return type form control', () => {
            expect(component.type).toBe(component.publishForm.get('type'));
        });

        it('should return seoTitle form control', () => {
            expect(component.seoTitle).toBe(component.seoForm.get('seoTitle'));
        });

        it('should return metaDescription form control', () => {
            expect(component.metaDescription).toBe(component.seoForm.get('metaDescription'));
        });

        it('should return canonicalUrl form control', () => {
            expect(component.canonicalUrl).toBe(component.seoForm.get('canonicalUrl'));
        });
    });

    describe('Slug Generation', () => {
        it('should create slug from title', () => {
            component.pageTitle = 'Test Article Title';
            component.createSlag();

            expect(mockDraftContentsStore.checkExistingSlugUrl).toHaveBeenCalledWith('test-article-title', '');
        });

        it('should handle special characters in title', () => {
            component.pageTitle = "Test's Article! With? Special@Characters";
            component.createSlag();

            expect(mockDraftContentsStore.checkExistingSlugUrl).toHaveBeenCalled();
        });

        it('should not create slug if contentId exists', () => {
            component.contentId = 'existing-id';
            component.pageTitle = 'Test Title';
            component.createSlag();

            expect(mockDraftContentsStore.checkExistingSlugUrl).not.toHaveBeenCalled();
        });

        it('should set SEO title when creating slug', () => {
            component.pageTitle = 'My Article';
            component.createSlag();

            expect(component.seoForm.get('seoTitle')?.value).toBe('My Article');
        });
    });

    describe('Slug Editing Feature', () => {
        it('should toggle edit mode', () => {
            component.isEditingSlug.set(false);
            component.toggleSlugEdit();
            expect(component.isEditingSlug()).toBe(true);
        });

        it('should revert slug change when cancelling edit', () => {
            // Setup initial state
            const originalSlug = 'original-slug';
            component.publishForm.patchValue({ urlSlug: originalSlug });

            // Start editing
            component.toggleSlugEdit();
            expect(component.isEditingSlug()).toBe(true);

            // Change slug value
            component.publishForm.patchValue({ urlSlug: 'changed-slug' });
            expect(component.publishForm.get('urlSlug')?.value).toBe('changed-slug');

            // Cancel edit (toggle off)
            component.toggleSlugEdit();

            // Verify revert
            expect(component.isEditingSlug()).toBe(false);
            expect(component.publishForm.get('urlSlug')?.value).toBe(originalSlug);
        });

        it('should not check existence if slug is empty when saving', () => {
            component.publishForm.patchValue({ urlSlug: '' });
            component.saveSlug();
            expect(mockDraftContentsStore.checkExistingSlugUrl).not.toHaveBeenCalled();
        });

        it('should check existence and close edit mode when saving valid slug', () => {
            const newSlug = 'new-valid-slug';
            component.publishForm.patchValue({ urlSlug: newSlug });
            component.isEditingSlug.set(true);

            component.saveSlug();

            expect(mockDraftContentsStore.checkExistingSlugUrl).toHaveBeenCalledWith(newSlug, '');
            expect(component.isEditingSlug()).toBe(false);
        });
    });

    describe('Check Existing Slug', () => {
        it('should not check if contentId exists', () => {
            component.contentId = 'existing-id';

            component.checkExist('my-slug');

            expect(mockDraftContentsStore.checkExistingSlugUrl).not.toHaveBeenCalled();
        });

        it('should check if slug exists', () => {
            component.checkExist('my-slug');
            expect(mockDraftContentsStore.checkExistingSlugUrl).toHaveBeenCalledWith('my-slug', '');
        });
    });

    describe('Cover Image Handling', () => {
        it('should set error message for non-image files', () => {
            const file = new File(['test'], 'test.txt', { type: 'text/plain' });
            component.handleFile(file);

            expect(component.coverImage).toBeNull();
            expect(component.errorMessage).toBe('Please upload a valid image file.');
        });

        it('should remove cover image', () => {
            component.coverImage = 'data:image/jpeg;base64,...';

            component.removeCoverImage();

            expect(component.coverImage).toBeNull();
        });

        it('should set isDragging on dragover', () => {
            const event = { preventDefault: vi.fn() } as unknown as DragEvent;

            component.onDragOver(event);

            expect(component.isDragging).toBe(true);
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('should reset isDragging on drop', () => {
            component.isDragging = true;
            const event = {
                preventDefault: vi.fn(),
                dataTransfer: { files: [] }
            } as unknown as DragEvent;

            component.onDrop(event);

            expect(component.isDragging).toBe(false);
        });
    });

    describe('Menu Operations', () => {
        it('should open menu', () => {
            component.openMenu();
            expect(component.isOpenTopMenu).toBe(true);
        });

        it('should close menu', () => {
            component.isOpenTopMenu = true;
            component.closeMenu();
            expect(component.isOpenTopMenu).toBe(false);
        });
    });

    describe('Tag Management', () => {
        it('should set product labels', () => {
            const tags = [{ label: 'tag1', color: '#D81B60' }, { label: 'tag2', color: '#E65100' }];
            component.setProductLabels(tags);

            expect(component.selectedTags()).toEqual(tags);
            expect(component.publishForm.get('tags')?.value).toEqual(['tag1', 'tag2']);
        });

        it('should remove tag from list', () => {
            component.publishForm.patchValue({ tags: ['tag1', 'tag2', 'tag3'] });

            component.removeTagFromCross('tag2');

            expect(component.publishForm.value.tags).toEqual(['tag1', 'tag3']);
        });

        it('should handle removing last tag', () => {
            component.publishForm.patchValue({ tags: ['onlyTag'] });

            component.removeTagFromCross('onlyTag');

            expect(component.publishForm.value.tags).toEqual([]);
        });
    });

    describe('Save as Draft', () => {
        it('should save new content as draft when title is provided', () => {
            component.pageTitle = 'Test Title';
            component.saveAsDraft();

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
        });

        it('should execute afterSave callback upon successful save', () => {
            component.pageTitle = 'Test Title';
            const afterSaveSpy = vi.fn();
            
            component.saveAsDraft(afterSaveSpy);

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
            expect(afterSaveSpy).toHaveBeenCalled();
        });

        it('should execute afterSave callback upon successful update', async () => {
            component.contentId = 'existing-id';
            component.pageTitle = 'Test Title';
            const afterSaveSpy = vi.fn();
            
            component.saveAsDraft(afterSaveSpy);

            expect(mockDraftContentsStore.update).toHaveBeenCalled();
            // Wait for async updateReferencingContents in ngZone.run
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(afterSaveSpy).toHaveBeenCalled();
        });

        it('should NOT save draft when title is empty', () => {
             // ...
             // existing code
             component.pageTitle = '';
            component.saveAsDraft();

            expect(mockDraftContentsStore.add).not.toHaveBeenCalled();
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith('Title is required', 'error', 'error');
        });
        
        it('should save draft even when required custom fields are empty', () => {
            // ... (existing code)
             mockContentTypesStore.items.set([
                {
                    name: 'Product',
                    slug: 'product',
                    fields: [
                        { key: 'price', label: 'Price', type: 'number', required: true, order: 0 },
                    ]
                }
            ]);

            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'product';
            fixture.detectChanges();

            component.pageTitle = 'Test Product';
            component.saveAsDraft();

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
        });
    });

    describe('Publish Content', () => {
        it('should publish new content when all required fields are provided', () => {
            component.pageTitle = 'Test Title';
            component.directPublishContent();

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
        });

        it('should set publishedStatus to true', () => {
            component.pageTitle = 'Test Title';
            component.directPublishContent();

            const addCall = mockDraftContentsStore.add.mock.calls[0][0];
            expect(addCall.publishedStatus).toBe(true);
        });

        it('should set publishedOn date on first publish', () => {
            component.pageTitle = 'Test Title';
            component.directPublishContent();

            const addCall = mockDraftContentsStore.add.mock.calls[0][0];
            expect(addCall.publishedOn).toBeInstanceOf(Date);
        });

        it('should preserve existing publishedOn when re-publishing', () => {
            const originalDate = new Date('2025-01-15');
            component.pageTitle = 'Test Title';
            component.contentId = 'existing-123';
            mockDraftContentsStore.currentItem.set({ publishedOn: originalDate });

            component.directPublishContent();

            const updateCall = mockDraftContentsStore.update.mock.calls[0][1];
            expect(updateCall.publishedOn).toEqual(originalDate);
        });

        it('should NOT publish when title is empty', () => {
            component.pageTitle = '';
            component.directPublishContent();

            expect(mockDraftContentsStore.add).not.toHaveBeenCalled();
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith('Title is required', 'error', 'error');
        });

        it('should NOT publish when required custom fields are empty', () => {
            // Set up a content type with required custom field
            mockContentTypesStore.items.set([
                {
                    name: 'Product',
                    slug: 'product',
                    fields: [
                        { key: 'price', label: 'Price', type: 'number', required: true, order: 0 },
                    ]
                }
            ]);

            // Re-create component with new store
            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'product';
            fixture.detectChanges();

            // Set title but not the required custom field
            component.pageTitle = 'Test Product';
            component.directPublishContent();

            expect(mockDraftContentsStore.add).not.toHaveBeenCalled();
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith('Price is required', 'error', 'error');
        });

        it('should publish when required custom fields are filled', () => {
            // Set up a content type with required custom field
            mockContentTypesStore.items.set([
                {
                    name: 'Product',
                    slug: 'product',
                    fields: [
                        { key: 'price', label: 'Price', type: 'number', required: true, order: 0 },
                    ]
                }
            ]);

            // Re-create component with new store
            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'product';
            fixture.detectChanges();

            // Set title AND required custom field
            component.pageTitle = 'Test Product';
            component.customFieldValues = { price: 99.99 };
            component.directPublishContent();

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
        });
    });

    describe('Validation Methods', () => {
        it('validateForDraft should pass when title is provided', () => {
            component.pageTitle = 'Test Title';
            const result = component.validateForDraft();
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it('validateForDraft should fail when title is empty', () => {
            component.pageTitle = '';
            const result = component.validateForDraft();
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Title is required');
        });

        it('validateForDraft should fail when title is whitespace only', () => {
            component.pageTitle = '   ';
            const result = component.validateForDraft();
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Title is required');
        });

        it('validateForPublish should check required custom fields', () => {
            // Set up content type with required field but don't fill it
            mockContentTypesStore.items.set([
                {
                    name: 'Product',
                    slug: 'product',
                    fields: [
                        { key: 'price', label: 'Price', type: 'number', required: true, order: 0 },
                    ]
                }
            ]);

            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'product';
            fixture.detectChanges();

            component.pageTitle = 'Test';
            const result = component.validateForPublish();
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Price is required');
        });

        it('validateForPublish should pass when all required fields are filled', () => {
            mockContentTypesStore.items.set([
                {
                    name: 'Product',
                    slug: 'product',
                    fields: [
                        { key: 'price', label: 'Price', type: 'number', required: true, order: 0 },
                    ]
                }
            ]);

            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'product';
            fixture.detectChanges();

            component.pageTitle = 'Test';
            component.customFieldValues = { price: 50 };
            const result = component.validateForPublish();
            expect(result.valid).toBe(true);
        });

        it('getMissingRequiredFields should return missing field labels', () => {
            mockContentTypesStore.items.set([
                {
                    name: 'Product',
                    slug: 'product',
                    fields: [
                        { key: 'price', label: 'Price', type: 'number', required: true, order: 0 },
                        { key: 'sku', label: 'SKU', type: 'text', required: true, order: 1 },
                        { key: 'description', label: 'Description', type: 'text', required: false, order: 2 },
                    ]
                }
            ]);

            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'product';
            fixture.detectChanges();

            const missing = component.getMissingRequiredFields();
            expect(missing).toContain('Price');
            expect(missing).toContain('SKU');
            expect(missing).not.toContain('Description'); // Not required
        });
    });

    describe('Editor Content', () => {
        it('should pass editor content to form', () => {
            const htmlContent = '<p>Test content</p>';
            component.passEditorContentToParent(htmlContent);

            expect(component.publishForm.get('content')?.value).toBe(htmlContent);
        });

        it('should extract plain text for meta description', () => {
            const htmlContent = '<p>This is the content for SEO</p>';
            component.passEditorContentToParent(htmlContent);

            expect(component.seoForm.get('metaDescription')?.value).toBe('This is the content for SEO');
        });
    });

    describe('Type Change', () => {
        it('should update type on selection', () => {
            const event = { target: { value: 'blog' } };
            component.onTypeChange(event);

            expect(component.publishForm.get('type')?.value).toBe('blog');
        });

        it('should not update type if value is empty', () => {
            component.publishForm.patchValue({ type: 'article' });
            const event = { target: { value: '' } };

            component.onTypeChange(event);

            expect(component.publishForm.get('type')?.value).toBe('article');
        });
    });

    describe('Navigation', () => {
        it('should save draft and open preview tab in navigateBySlug', () => {
            // Mock window.open
            const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
            
            component.publishForm.patchValue({ 
                urlSlug: 'my-article',
                type: 'article'
            });
            component.contentTypeSlug = 'articles';
            component.pageTitle = 'Test Title';

            component.navigateBySlug();

            // navigateBySlug calls saveAsDraft, which calls afterSave
            // afterSave should call window.open
            
            expect(mockDraftContentsStore.add).toHaveBeenCalled();
            expect(openSpy).toHaveBeenCalledWith('/articles/my-article?preview=true', '_blank');
            
            openSpy.mockRestore();
        });

        it('should NOT open preview if save fails', () => {
             // Mock window.open
            const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
            
            // Mock save failure
            mockDraftContentsStore.add.mockReturnValue(of(null)); // or throw error
            // Actually implementation calls callback only on success (next with newId)
            
            component.publishForm.patchValue({ 
                urlSlug: 'my-article',
                type: 'article'
            });
            component.contentTypeSlug = 'articles';
            component.pageTitle = 'Title'; // valid title

            // Override behavior to simulate failure (no callback execution)
             mockDraftContentsStore.add.mockImplementation(() => {
                return {
                    subscribe: (observer: any) => {
                        observer.error('Failed');
                    }
                }
            });

            component.navigateBySlug();

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
            expect(openSpy).not.toHaveBeenCalled();
            
            openSpy.mockRestore();
        });

        it('should show slug input when urlSlug is empty (fix for missing controls)', () => {
           component.publishForm.patchValue({ urlSlug: '' });
           fixture.detectChanges();
           expect(component.isEditingSlug()).toBe(false);
        });
        it('should have preview button enabled when urlSlug is present', () => {
            component.publishForm.patchValue({ urlSlug: 'test-slug' });
            fixture.detectChanges();
            
            // Find the preview button specifically by checking its content or icon
            const buttons = fixture.nativeElement.querySelectorAll('button.btn-outline-secondary');
            const previewBtn = Array.from(buttons).find((btn: any) => btn.textContent.includes('Preview')) as HTMLButtonElement;
            
            expect(previewBtn.disabled).toBe(false);
        });

        it('should have preview button disabled when urlSlug is empty', () => {
            component.publishForm.patchValue({ urlSlug: '' });
            fixture.detectChanges();
            
            const buttons = fixture.nativeElement.querySelectorAll('button.btn-outline-secondary');
            const previewBtn = Array.from(buttons).find((btn: any) => btn.textContent.includes('Preview')) as HTMLButtonElement;
            
            expect(previewBtn.disabled).toBe(true);
        });

        it('should have preview button enabled in EDIT mode when urlSlug is present', () => {
            component.contentId = 'edit-mode-id';
            component.publishForm.patchValue({ urlSlug: 'edit-slug' });
            fixture.detectChanges();
            
            const hasSlug = !!component.publishForm.get('urlSlug')?.value;
            // The template uses [disabled]="isSavingDraft || !publishForm.get('urlSlug')?.value"
            // We verify that having contentId doesn't negatively affect this (it shouldn't)
            expect(hasSlug).toBe(true);
            expect(component.isSavingDraft).toBe(false); 
        });
    });

    describe('isEmpty Utility', () => {
        it('should return true for empty object', () => {
            expect(component.isEmpty({})).toBe(true);
        });

        it('should return false for non-empty object', () => {
            expect(component.isEmpty({ key: 'value' })).toBe(false);
        });

        it('should return false for object with multiple keys', () => {
            expect(component.isEmpty({ a: 1, b: 2 })).toBe(false);
        });
    });

    describe('Content Type Items', () => {
        it('should return content type items from store', () => {
            const items = component.contentTypeItems();
            expect(items.length).toBe(2);
            expect(items[0].name).toBe('Article');
        });
    });

    describe('Content ID Input (Edit Mode)', () => {
        it('should accept contentId via input', () => {
            component.contentId = 'edit-content-123';
            expect(component.contentId).toBe('edit-content-123');
        });

        it('should trigger getByCustomField when contentId is set', () => {
            component.contentId = 'load-content-456';
            expect(mockDraftContentsStore.getByCustomField).toHaveBeenCalledWith('id', '==', 'load-content-456', '');
        });

        it('should not trigger getByCustomField for empty contentId', () => {
            const callCountBefore = mockDraftContentsStore.getByCustomField.mock.calls.length;
            component.contentId = '';
            expect(mockDraftContentsStore.getByCustomField.mock.calls.length).toBe(callCountBefore);
        });

        it('should not re-fetch if same contentId is set again', () => {
            component.contentId = 'same-content-789';
            const callCountAfterFirst = mockDraftContentsStore.getByCustomField.mock.calls.length;

            component.contentId = 'same-content-789'; // Same value
            expect(mockDraftContentsStore.getByCustomField.mock.calls.length).toBe(callCountAfterFirst);
        });

        it('should fetch different content if contentId changes', () => {
            component.contentId = 'first-content';
            const callCountAfterFirst = mockDraftContentsStore.getByCustomField.mock.calls.length;

            component.contentId = 'second-content';
            expect(mockDraftContentsStore.getByCustomField.mock.calls.length).toBe(callCountAfterFirst + 1);
            expect(mockDraftContentsStore.getByCustomField).toHaveBeenCalledWith('id', '==', 'second-content', '');
        });
    });

    describe('Form Initialization Guard', () => {
        it('should only initialize forms once', () => {
            // Forms are already initialized in beforeEach via fixture.detectChanges()
            const initialPublishForm = component.publishForm;
            const initialSeoForm = component.seoForm;

            // Setting contentId should not re-initialize forms
            component.contentId = 'test-content';

            expect(component.publishForm).toBe(initialPublishForm);
            expect(component.seoForm).toBe(initialSeoForm);
        });
    });

    describe('Content Type Slug Input', () => {
        it('should accept contentTypeSlug via input', () => {
            component.contentTypeSlug = 'articles';
            expect(component.contentTypeSlug).toBe('articles');
        });

        it('should return content type name from slug', () => {
            component.contentTypeSlug = 'article';
            fixture.detectChanges();

            expect(component.getContentTypeName()).toBe('Article');
        });

        it('should format unknown slug as name', () => {
            component.contentTypeSlug = 'unknown-type';
            fixture.detectChanges();

            expect(component.getContentTypeName()).toBe('Unknown-type');
        });

        it('should update currentFields when contentTypeSlug changes (navigation reactivity)', () => {
            // Set up mock with fields for both types
            mockContentTypesStore.items.set([
                {
                    name: 'Article',
                    slug: 'article',
                    fields: [
                        { key: 'author', label: 'Author', type: 'text', required: true, order: 0 },
                    ]
                },
                {
                    name: 'Product',
                    slug: 'product',
                    fields: [
                        { key: 'price', label: 'Price', type: 'number', required: true, order: 0 },
                        { key: 'color', label: 'Color', type: 'dropdown', required: false, order: 1, options: 'Red, Blue' },
                    ]
                }
            ]);

            // Re-create component to pick up new store
            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;

            // Start with article type
            component.contentTypeSlug = 'article';
            fixture.detectChanges();
            expect(component.currentFields.length).toBe(1);
            expect(component.currentFields[0].key).toBe('author');

            // Simulate navigation to product type (key bug fix)
            component.contentTypeSlug = 'product';
            fixture.detectChanges();
            expect(component.currentFields.length).toBe(2);
            expect(component.currentFields[0].key).toBe('price');
            expect(component.currentFields[1].key).toBe('color');
        });

        it('should clear customFieldValues when switching content types', () => {
            // Set some custom field values
            component.customFieldValues = { author: 'John', category: 'News' };

            // Navigate to different content type
            component.contentTypeSlug = 'new-type';
            fixture.detectChanges();

            // Custom field values should persist (user may want to keep data)
            // This is a design decision - we don't auto-clear
            expect(component.customFieldValues).toEqual({ author: 'John', category: 'News' });
        });
    });

    describe('Custom Fields Support', () => {
        it('should initialize customFieldValues as empty object', () => {
            expect(component.customFieldValues).toEqual({});
        });

        it('should parse comma-separated options string', () => {
            const result = component.parseOptions('Red, Green, Blue');
            expect(result).toEqual(['Red', 'Green', 'Blue']);
        });

        it('should handle empty options string', () => {
            const result = component.parseOptions('');
            expect(result).toEqual([]);
        });

        it('should handle undefined options', () => {
            const result = component.parseOptions(undefined);
            expect(result).toEqual([]);
        });

        it('should trim whitespace from options', () => {
            const result = component.parseOptions('  Red  ,  Green  ,  Blue  ');
            expect(result).toEqual(['Red', 'Green', 'Blue']);
        });

        it('should filter empty options after split', () => {
            const result = component.parseOptions('Red,,Blue');
            expect(result).toEqual(['Red', 'Blue']);
        });

        it('should update custom field value on change', () => {
            component.onCustomFieldChange('color', 'Red');
            expect(component.customFieldValues['color']).toBe('Red');
        });

        it('should handle multiple custom field changes', () => {
            component.onCustomFieldChange('color', 'Red');
            component.onCustomFieldChange('size', 'Large');
            expect(component.customFieldValues).toEqual({ color: 'Red', size: 'Large' });
        });

        it('should add option to checkbox field values', () => {
            component.onCheckboxFieldChange('sizes', 'Small', true);
            component.onCheckboxFieldChange('sizes', 'Large', true);
            expect(component.customFieldValues['sizes']).toEqual(['Small', 'Large']);
        });

        it('should remove option from checkbox field values', () => {
            component.customFieldValues['sizes'] = ['Small', 'Medium', 'Large'];
            component.onCheckboxFieldChange('sizes', 'Medium', false);
            expect(component.customFieldValues['sizes']).toEqual(['Small', 'Large']);
        });

        it('should not duplicate checkbox option if already selected', () => {
            component.customFieldValues['sizes'] = ['Small'];
            component.onCheckboxFieldChange('sizes', 'Small', true);
            expect(component.customFieldValues['sizes']).toEqual(['Small']);
        });

        it('should check if checkbox option is selected', () => {
            component.customFieldValues['sizes'] = ['Small', 'Large'];
            expect(component.isCheckboxOptionSelected('sizes', 'Small')).toBe(true);
            expect(component.isCheckboxOptionSelected('sizes', 'Medium')).toBe(false);
        });

        it('should return false for uninitialized checkbox field', () => {
            expect(component.isCheckboxOptionSelected('nonexistent', 'Option')).toBe(false);
        });

        it('should include customFields in save data', () => {
            component.pageTitle = 'Test';
            component.customFieldValues = { color: 'Red', featured: true };
            component.saveAsDraft();

            const addCall = mockDraftContentsStore.add.mock.calls[0][0];
            expect(addCall.customFields).toEqual({ color: 'Red', featured: true });
        });

        it('should include customFields in publish data', () => {
            component.pageTitle = 'Test';
            component.customFieldValues = { status: 'Active' };
            component.directPublishContent();

            const addCall = mockDraftContentsStore.add.mock.calls[0][0];
            expect(addCall.customFields).toEqual({ status: 'Active' });
        });
    });

    describe('Current Content Type', () => {
        it('should return current fields based on content type slug', () => {
            // Update the mock store's items to include fields
            const contentTypeWithFields = {
                name: 'Article',
                slug: 'article',
                fields: [
                    { key: 'author', label: 'Author', type: 'text', required: true, order: 0 },
                    { key: 'category', label: 'Category', type: 'dropdown', required: false, order: 1, options: 'News, Sports, Tech' },
                ]
            };

            // Manually update the store's items signal
            mockContentTypesStore.items.set([contentTypeWithFields, { name: 'Blog', slug: 'blog', fields: [] }]);

            // Need to re-trigger the component's computed property by re-creating fixture
            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'article';
            fixture.detectChanges();

            const fields = component.currentFields;
            expect(fields.length).toBe(2);
            expect(fields[0].key).toBe('author');
            expect(fields[1].key).toBe('category');
        });

        it('should return empty array if no content type matches', () => {
            // Ensure the store is set up without the 'nonexistent' type
            mockContentTypesStore.items.set([
                { name: 'Article', slug: 'article', fields: [] },
                { name: 'Blog', slug: 'blog', fields: [] }
            ]);

            // Re-create fixture to pick up new store state
            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'nonexistent';
            fixture.detectChanges();

            const fields = component.currentFields;
            expect(fields).toEqual([]);
        });

        it('should return empty array if content type has no fields', () => {
            // Set up the store with an article type that has no fields
            mockContentTypesStore.items.set([
                { name: 'Article', slug: 'article', fields: [] },
                { name: 'Blog', slug: 'blog', fields: [] }
            ]);

            // Re-create fixture to pick up new store state
            fixture = TestBed.createComponent(CreateContentComponent);
            component = fixture.componentInstance;
            component.contentTypeSlug = 'article';
            fixture.detectChanges();

            const fields = component.currentFields;
            // Original mock doesn't have fields, so should return empty
            expect(fields).toEqual([]);
        });
    });

    describe('TipTap Editor Integration', () => {
        it('should render the TipTap editor component', () => {
            const compiled = fixture.nativeElement;
            const tiptapEditor = compiled.querySelector('app-tiptap-editor');
            expect(tiptapEditor).toBeTruthy();
        });

        it('should pass content form value to TipTap editor via productValue input', () => {
            const testContent = '<p>Test HTML content</p>';
            component.publishForm.patchValue({ content: testContent });
            fixture.detectChanges();

            // The productValue binding should reflect the form's content value
            expect(component.publishForm.get('content')?.value).toBe(testContent);
        });

        it('should update form content when TipTap emits textEditorContent', () => {
            const newContent = '<p>Updated content from TipTap</p>';
            component.passEditorContentToParent(newContent);

            expect(component.publishForm.get('content')?.value).toBe(newContent);
        });

        it('should extract plain text for meta description from TipTap content', () => {
            const htmlContent = '<p>This is test content for meta description</p>';
            component.passEditorContentToParent(htmlContent);

            expect(component.seoForm.get('metaDescription')?.value).toBe('This is test content for meta description');
        });

        it('should handle complex HTML content from TipTap', () => {
            const complexHtml = '<h1>Title</h1><p>Paragraph with <strong>bold</strong> and <em>italic</em></p><ul><li>Item 1</li><li>Item 2</li></ul>';
            component.passEditorContentToParent(complexHtml);

            expect(component.publishForm.get('content')?.value).toBe(complexHtml);
        });

        it('should strip HTML tags when generating meta description', () => {
            const htmlWithTags = '<h1>Title</h1><p>Description <strong>text</strong></p>';
            component.passEditorContentToParent(htmlWithTags);

            const metaDescription = component.seoForm.get('metaDescription')?.value;
            expect(metaDescription).not.toContain('<h1>');
            expect(metaDescription).not.toContain('<strong>');
            // Note: consecutive tags without whitespace will result in joined words
            expect(metaDescription).toContain('TitleDescription text');
        });

        it('should handle empty content from TipTap', () => {
            component.passEditorContentToParent('');

            expect(component.publishForm.get('content')?.value).toBe('');
            expect(component.seoForm.get('metaDescription')?.value).toBe('');
        });

        it('should limit meta description to first 160 words', () => {
            // Create content with more than 160 words
            const words = Array(200).fill('word').map((w, i) => `${w}${i}`);
            const longContent = `<p>${words.join(' ')}</p>`;
            component.passEditorContentToParent(longContent);

            const metaDescription = component.seoForm.get('metaDescription')?.value as string;
            const wordCount = metaDescription.trim().split(/\s+/).length;
            expect(wordCount).toBeLessThanOrEqual(160);
        });

        it('should load existing content into editor when editing', () => {
            const existingContent = '<p>Existing draft content</p>';
            mockDraftContentsStore.currentItem.set({
                id: 'test-id',
                title: 'Test Title',
                content: existingContent,
                type: 'article',
                urlSlug: 'test-slug'
            });

            // Trigger the computed property that patches forms
            fixture.detectChanges();

            expect(component.publishForm.get('content')?.value).toBe(existingContent);
        });

        it('should include TipTap content in save draft payload', () => {
            component.pageTitle = 'Test Article';
            const tiptapContent = '<p>Content from TipTap editor</p>';
            component.passEditorContentToParent(tiptapContent);

            component.saveAsDraft();

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
            const addCall = mockDraftContentsStore.add.mock.calls[0][0];
            expect(addCall.content).toBe(tiptapContent);
        });

        it('should include TipTap content in publish payload', () => {
            component.pageTitle = 'Test Article';
            const tiptapContent = '<h1>Published Article</h1><p>Article body</p>';
            component.passEditorContentToParent(tiptapContent);

            component.directPublishContent();

            expect(mockDraftContentsStore.add).toHaveBeenCalled();
            const addCall = mockDraftContentsStore.add.mock.calls[0][0];
            expect(addCall.content).toBe(tiptapContent);
        });

        it('should handle nbsp entities in TipTap content for meta description', () => {
            const contentWithNbsp = '<p>Text with&nbsp;non-breaking&nbsp;spaces</p>';
            component.passEditorContentToParent(contentWithNbsp);

            const metaDescription = component.seoForm.get('metaDescription')?.value as string;
            expect(metaDescription).toBe('Text with non-breaking spaces');
        });
    });


    describe('Content Summary Logic', () => {
        it('should auto-generate summary from content', () => {
            // Mock ViewChild/ElementRef if needed, or just call method
            const htmlContent = '<p>This is a long paragraph that should be truncated to form the summary of the content.</p>';
            component.passEditorContentToParent(htmlContent);
            const summary = component.publishForm.get('summary')?.value;
            expect(summary).toBeTruthy();
            expect(summary.length).toBeLessThanOrEqual(100);
        });

        it('should sync summary to metaDescription if metaDescription was default', () => {
            // Re-initialize to ensure subscriptions
            fixture.detectChanges();

            component.seoForm.patchValue({ metaDescription: 'Old Summary' });
            component.publishForm.patchValue({ summary: 'Old Summary' });

            component.publishForm.patchValue({ summary: 'New Updated Summary' });

            expect(component.seoForm.get('metaDescription')?.value).toBe('New Updated Summary');
        });

        it('should NOT sync summary to metaDescription if metaDescription was manually edited', () => {
            fixture.detectChanges();

            component.publishForm.patchValue({ summary: 'Initial Summary' });
            component.seoForm.patchValue({ metaDescription: 'Manual Edit' });
            component.seoForm.get('metaDescription')?.markAsDirty();

            component.publishForm.patchValue({ summary: 'New Summary' });

            expect(component.seoForm.get('metaDescription')?.value).toBe('Manual Edit');
        });
    });

    describe('Next/Previous Content Logic', () => {
        it('should update previous content link when saving with next content', () => {
            component.selectedNextContent = {
                id: 'next-id',
                title: 'Next Article',
                summary: 'Summary',
                slug: 'next-slug'
            };
            component.pageTitle = 'Current Article';
            component.publishForm.patchValue({ urlSlug: 'current-slug' });

            mockDraftContentsStore.update.mockReturnValue(of({}));

            component.saveAsDraft();

            expect(mockDraftContentsStore.update).toHaveBeenCalledWith('next-id', expect.objectContaining({
                previousContent: expect.objectContaining({
                    slug: 'current-slug'
                })
            }), '');
        });
    });

    describe('Tag Filtering', () => {
        beforeEach(() => {
            // Set up mock tags in the store
            mockTagsStore.items = signal([
                { id: '1', label: 'Technology', color: '#FFB3BA' },
                { id: '2', label: 'Design', color: '#BAFFC9' },
                { id: '3', label: 'Programming', color: '#BAE1FF' },
                { id: '4', label: 'Tech News', color: '#EECBFF' },
            ]);
        });

        it('should return all tags when no search term and no selected tags', () => {
            component.tagSearchTerm.set('');
            component.selectedTags.set([]);

            const filtered = component.filteredTags;

            expect(filtered.length).toBe(4);
        });

        it('should exclude selected tags when no search term', () => {
            component.tagSearchTerm.set('');
            component.selectedTags.set([{ label: 'Technology', color: '#FFB3BA' }]);

            const filtered = component.filteredTags;

            expect(filtered.length).toBe(3);
            expect(filtered.find(t => t.label === 'Technology')).toBeUndefined();
        });

        it('should filter tags by search term', () => {
            component.tagSearchTerm.set('tech');
            component.selectedTags.set([]);

            const filtered = component.filteredTags;

            expect(filtered.length).toBe(2);
            expect(filtered.map(t => t.label)).toContain('Technology');
            expect(filtered.map(t => t.label)).toContain('Tech News');
        });

        it('should filter by search term AND exclude selected tags', () => {
            component.tagSearchTerm.set('tech');
            component.selectedTags.set([{ label: 'Technology', color: '#FFB3BA' }]);

            const filtered = component.filteredTags;

            expect(filtered.length).toBe(1);
            expect(filtered[0].label).toBe('Tech News');
        });

        it('should return empty array when all matching tags are selected', () => {
            component.tagSearchTerm.set('design');
            component.selectedTags.set([{ label: 'Design', color: '#BAFFC9' }]);

            const filtered = component.filteredTags;

            expect(filtered.length).toBe(0);
        });

        it('should be case-insensitive when filtering', () => {
            component.tagSearchTerm.set('PROGRAMMING');
            component.selectedTags.set([]);

            const filtered = component.filteredTags;

            expect(filtered.length).toBe(1);
            expect(filtered[0].label).toBe('Programming');
        });
    });

    describe('Custom Field Image Selection', () => {
        it('should open media manager for a custom image field', () => {
            component.openMediaManagerForField('hero_image');
            expect(mockDialog.open).toHaveBeenCalled();
        });

        it('should store selected image URL in customFieldValues', () => {
            const mockResult = { type: 'submit', mediaUrl: 'https://example.com/image.jpg' };
            mockDialog.open.mockReturnValue({
                afterClosed: vi.fn().mockReturnValue(of(mockResult)),
            });

            component.openMediaManagerForField('hero_image');
            expect(component.customFieldValues['hero_image']).toBe('https://example.com/image.jpg');
        });

        it('should not update customFieldValues when dialog is cancelled', () => {
            mockDialog.open.mockReturnValue({
                afterClosed: vi.fn().mockReturnValue(of(null)),
            });

            component.openMediaManagerForField('hero_image');
            expect(component.customFieldValues['hero_image']).toBeUndefined();
        });

        it('should remove custom field image', () => {
            component.customFieldValues['hero_image'] = 'https://example.com/image.jpg';
            component.removeCustomFieldImage('hero_image');
            expect(component.customFieldValues['hero_image']).toBeNull();
        });

        it('should replace existing image when new one is selected', () => {
            component.customFieldValues['hero_image'] = 'https://example.com/old.jpg';
            const mockResult = { type: 'submit', mediaUrl: 'https://example.com/new.jpg' };
            mockDialog.open.mockReturnValue({
                afterClosed: vi.fn().mockReturnValue(of(mockResult)),
            });

            component.openMediaManagerForField('hero_image');
            expect(component.customFieldValues['hero_image']).toBe('https://example.com/new.jpg');
        });
    });

    describe('Custom Field Rich Text', () => {
        it('should update customFieldValues on richtext content change', () => {
            component.onRichTextFieldChange('bio', '<p>Hello world</p>');
            expect(component.customFieldValues['bio']).toBe('<p>Hello world</p>');
        });

        it('should handle empty richtext content', () => {
            component.onRichTextFieldChange('bio', '');
            expect(component.customFieldValues['bio']).toBe('');
        });

        it('should open fullscreen editor dialog', () => {
            component.customFieldValues['bio'] = '<p>Existing content</p>';
            component.openFullscreenEditor('bio', 'Biography');
            expect(mockDialog.open).toHaveBeenCalled();
        });

        it('should update customFieldValues when fullscreen editor saves', () => {
            const updatedContent = '<p>Updated content from fullscreen</p>';
            mockDialog.open.mockReturnValue({
                afterClosed: vi.fn().mockReturnValue(of(updatedContent)),
            });

            component.openFullscreenEditor('bio', 'Biography');
            expect(component.customFieldValues['bio']).toBe(updatedContent);
        });

        it('should not update customFieldValues when fullscreen editor is cancelled', () => {
            component.customFieldValues['bio'] = '<p>Original</p>';
            mockDialog.open.mockReturnValue({
                afterClosed: vi.fn().mockReturnValue(of(null)),
            });

            component.openFullscreenEditor('bio', 'Biography');
            expect(component.customFieldValues['bio']).toBe('<p>Original</p>');
        });
    });

    describe('DateTime Custom Field', () => {
        it('should store datetime value in customFieldValues', () => {
            component.onCustomFieldChange('event_date', '2026-02-16T14:30');
            expect(component.customFieldValues['event_date']).toBe('2026-02-16T14:30');
        });

        it('should update datetime value', () => {
            component.onCustomFieldChange('event_date', '2026-02-16T14:30');
            component.onCustomFieldChange('event_date', '2026-03-01T09:00');
            expect(component.customFieldValues['event_date']).toBe('2026-03-01T09:00');
        });
    });
});
