import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { Location } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { of, NEVER, Subject } from 'rxjs';
import MediaManagerComponent from './media.page';
import { MediaManagerService } from './media-manager.service';
import { MediaManagerStore } from './media-manager.store';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalService } from '../../../../shared/services/global.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ConstantVariables } from '../../../../shared/constants/common-constants';
import { ChangeDetectorRef } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';

// Mock the BaseComponent's dependencies
vi.mock('../../../../shared/services/toast.service', () => ({
    ToastService: vi.fn().mockImplementation(() => ({
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    })),
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: vi.fn(),
    collection: vi.fn(),
    getFirestore: vi.fn(() => ({})),
    doc: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn((_, callback) => {
        callback({ docs: [] });
        return vi.fn();
    }),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(() => Promise.resolve({ data: () => ({ count: 0 }) })),
}));

vi.mock('@angular/fire/storage', () => ({
    getStorage: vi.fn(() => ({})),
    ref: vi.fn(),
    uploadBytesResumable: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(),
}));

describe('MediaManagerComponent', () => {
    let component: MediaManagerComponent;
    let fixture: ComponentFixture<MediaManagerComponent>;
    let mockMediaManagerService: any;
    let mockMediaManagerStore: any;
    let mockFileUploadService: any;
    let mockDialog: any;
    let mockDialogRef: any;
    let mockRouter: any;
    let mediaSubject: Subject<any>;

    beforeEach(async () => {
        // Create a subject to control observable emissions
        mediaSubject = new Subject<any>();

        mockMediaManagerService = {
            getImagesFromUnsplash: vi.fn().mockResolvedValue({
                status: 200,
                items: [{ id: '1', urls: { regular: 'http://example.com/1.jpg' } }],
                pagination: { pageIndex: 1, pageSize: 20, totalItems: 100, totalPages: 5 },
            }),
            warmupUnsplash: vi.fn(),
            isUnsplashConfigured: vi.fn().mockResolvedValue(true),
            // Use NEVER to prevent emissions that cause detectChanges after component destruction
            getMediaListFromFirestore: vi.fn().mockReturnValue(NEVER),
        };

        mockMediaManagerStore = {
            add: vi.fn(),
            addBatch: vi.fn().mockReturnValue(of([])),
        };

        mockFileUploadService = {
            uploadFileInDb: vi.fn().mockResolvedValue({
                downloadURL: 'http://example.com/new-upload.jpg',
                name: 'new-upload',
                uploadTime: new Date(),
            }),
            uploadFile: vi.fn().mockResolvedValue({
                downloadURL: 'http://example.com/new-upload.jpg',
                name: 'new-upload',
                uploadTime: new Date(),
            }),
            validateFileType: vi.fn().mockReturnValue(null),
            validateFileSize: vi.fn().mockReturnValue(null),
            deleteMediaItem: vi.fn().mockResolvedValue(undefined),
        };

        mockDialog = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(true),
            }),
        };

        mockDialogRef = {
            close: vi.fn(),
        };

        mockRouter = {
            navigate: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [MediaManagerComponent, BrowserAnimationsModule],
            providers: [
                { provide: MediaManagerService, useValue: mockMediaManagerService },
                { provide: MediaManagerStore, useValue: mockMediaManagerStore },
                { provide: FileUploadService, useValue: mockFileUploadService },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: { isDialogOpen: false } },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), openCustomSnackbar: vi.fn() } },
                { provide: GlobalService, useValue: { debugMode: vi.fn(() => false) } },
                { provide: Location, useValue: { back: vi.fn() } },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => null }), snapshot: { paramMap: { get: () => null } } } },
                { provide: Firestore, useValue: {} },
                ConstantVariables,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MediaManagerComponent);
        component = fixture.componentInstance;

        // Spy on ref.detectChanges to prevent errors after destruction
        vi.spyOn(component.ref, 'detectChanges').mockImplementation(() => { });
    });

    afterEach(() => {
        fixture?.destroy();
        mediaSubject?.complete();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('ngOnInit', () => {
        it('should load media items on init', () => {
            fixture.detectChanges();
            expect(mockMediaManagerService.getMediaListFromFirestore).toHaveBeenCalledWith(20, undefined);
        });

        it('should set default selected menu to upload', () => {
            fixture.detectChanges();
            expect(component.selectedItem).toMatchObject({ value: 'upload' });
        });
    });

    describe('selectedMenu', () => {
        it('should clear search results when switching menus', () => {
            component.searchResults = [{ id: '1', url: 'test.jpg' }];
            component.selectedMenu({ name: 'Free Images', value: 'search' });
            expect(component.searchResults).toEqual([]);
        });

        it('should load media items when upload menu is selected', () => {
            component.selectedMenu({ name: 'My Uploads', value: 'upload' });
            expect(mockMediaManagerService.getMediaListFromFirestore).toHaveBeenCalled();
        });

        it('should clear upload image when search menu is selected', () => {
            component.uploadImage = 'some-base64-image';
            component.selectedMenu({ name: 'Free Images', value: 'search' });
            expect(component.uploadImage).toBe('');
        });

        it('should call warmupUnsplash when search menu is selected and Unsplash is configured', async () => {
            mockMediaManagerService.isUnsplashConfigured.mockResolvedValue(true);
            component.selectedMenu({ name: 'Free Images', value: 'search' });
            await vi.waitFor(() => {
                expect(mockMediaManagerService.warmupUnsplash).toHaveBeenCalled();
            });
        });

        it('should NOT call warmupUnsplash when Unsplash is not configured', async () => {
            mockMediaManagerService.isUnsplashConfigured.mockResolvedValue(false);
            mockMediaManagerService.warmupUnsplash.mockClear();
            component.selectedMenu({ name: 'Free Images', value: 'search' });
            await vi.waitFor(() => {
                expect(component.unsplashConfigured).toBe(false);
            });
            expect(mockMediaManagerService.warmupUnsplash).not.toHaveBeenCalled();
        });

        it('should NOT call warmupUnsplash when upload menu is selected', () => {
            mockMediaManagerService.warmupUnsplash.mockClear();
            component.selectedMenu({ name: 'My Uploads', value: 'upload' });
            expect(mockMediaManagerService.warmupUnsplash).not.toHaveBeenCalled();
        });
    });

    describe('searchImage', () => {
        it('should not search when query is empty', () => {
            component.searchImage('');
            expect(mockMediaManagerService.getImagesFromUnsplash).not.toHaveBeenCalled();
        });

        it('should not search when query is undefined', () => {
            component.searchImage(undefined);
            expect(mockMediaManagerService.getImagesFromUnsplash).not.toHaveBeenCalled();
        });

        it('should call unsplash service when query is provided', async () => {
            await component.searchImage('nature', 1);
            expect(mockMediaManagerService.getImagesFromUnsplash).toHaveBeenCalledWith('nature', 1);
        });

        it('should update search results on successful search', async () => {
            component.selectedItem = { value: 'upload' };
            await component.searchImage('nature', 1);
            expect(component.searchResults).toEqual([{ id: '1', urls: { regular: 'http://example.com/1.jpg' } }]);
        });

        it('should update pagination on successful search', async () => {
            component.selectedItem = { value: 'upload' };
            await component.searchImage('nature', 1);
            expect(component.pagination).toEqual({ pageIndex: 1, pageSize: 20, totalItems: 100, totalPages: 5 });
        });

        it('should use page 1 as default when page is not provided', async () => {
            component.selectedItem = { value: 'upload' };
            await component.searchImage('nature');
            expect(mockMediaManagerService.getImagesFromUnsplash).toHaveBeenCalledWith('nature', 1);
        });
    });

    describe('selectMedia', () => {
        it('should set selectedMediaUrl when media is selected', () => {
            const media = { id: '1', url: 'http://example.com/image.jpg' };
            component.selectMedia(media);
            expect(component.selectedMediaUrl).toEqual(media);
        });
    });

    describe('insertMedia', () => {
        it('should close dialog with selected media URL', () => {
            component.selectedMediaUrl = { url: 'http://example.com/image.jpg' };
            component.insertMedia();
            expect(mockDialogRef.close).toHaveBeenCalledWith({
                mediaUrl: 'http://example.com/image.jpg',
                type: 'submit',
                kind: 'image',
            });
        });

        it('should use urls.regular when url is not available', () => {
            component.selectedMediaUrl = { urls: { regular: 'http://example.com/unsplash.jpg' } };
            component.insertMedia();
            expect(mockDialogRef.close).toHaveBeenCalledWith({
                mediaUrl: 'http://example.com/unsplash.jpg',
                type: 'submit',
                kind: 'image',
            });
        });

        it('should use empty string when no url is available', () => {
            component.selectedMediaUrl = {};
            component.insertMedia();
            expect(mockDialogRef.close).toHaveBeenCalledWith({
                mediaUrl: '',
                type: 'submit',
                kind: 'image',
            });
        });
    });

    describe('onFileChange', () => {
        it('should not upload if no files selected', () => {
            const event = { target: { files: { length: 0 }, value: '' } } as any;
            component.onFileChange(event);
            expect(mockFileUploadService.uploadFile).not.toHaveBeenCalled();
        });
    });

    describe('getUrl', () => {
        it('should return urls.regular from element', () => {
            const element = { urls: { regular: 'http://example.com/image.jpg' } };
            expect(component.getUrl(element)).toBe('http://example.com/image.jpg');
        });
    });

    describe('deleteUploadedMedia', () => {
        it('should call deleteMediaItem on file upload service', async () => {
            await component.deleteUploadedMedia('media-id-123');
            expect(mockFileUploadService.deleteMediaItem).toHaveBeenCalledWith('media-id-123');
        });

        it('should reload media items after successful delete', async () => {
            mockMediaManagerService.getMediaListFromFirestore.mockClear();
            await component.deleteUploadedMedia('media-id-123');
            expect(mockMediaManagerService.getMediaListFromFirestore).toHaveBeenCalled();
        });
    });

    describe('confirmationToDeleteItem', () => {
        it('should open confirmation dialog', () => {
            const media = { id: '1', name: 'test.jpg' };
            component.confirmationToDeleteItem(media);
            expect(mockDialog.open).toHaveBeenCalled();
        });
    });

    describe('getPaginatorData', () => {
        it('should search images when in search mode and page changes', async () => {
            component.selectedItem = { value: 'search' };
            component.searchValue = 'nature';
            await component.getPaginatorData({ pageIndex: 2 });
            // pageIndex + 1 because Unsplash API uses 1-based pages while Angular paginator is 0-based
            expect(mockMediaManagerService.getImagesFromUnsplash).toHaveBeenCalledWith('nature', 3);
        });

        it('should load next page of media when moving forward', async () => {
            component.selectedItem = { value: 'upload' };
            component.pagination = { lastVisible: 'some-doc-snapshot' };
            await component.getPaginatorData({ pageIndex: 1, previousPageIndex: 0 });
            expect(mockMediaManagerService.getMediaListFromFirestore).toHaveBeenCalledWith(20, 'some-doc-snapshot');
        });
    });

    describe('initialization', () => {
        it('should have default values', () => {
            expect(component.uploadImage).toBe('');
            expect(component.searchResults).toEqual([]);
            expect(component.showUploadingSpinner).toBe(false);
            expect(component.progressValue).toBe(0);
            expect(component.mode).toBe('determinate');
        });
    });

    describe('_DIALOG_DATA', () => {
        it('should have isDialogOpen as false by default', () => {
            expect(component._DIALOG_DATA.isDialogOpen).toBe(false);
        });
    });

    describe('DOM visibility when not in dialog mode', () => {
        it('should NOT render Insert Media button when isDialogOpen is false', () => {
            fixture.detectChanges();
            const insertBtn = fixture.nativeElement.querySelector('#insertMediaBtn');
            expect(insertBtn).toBeNull();
        });

        it('should NOT render Cancel button when isDialogOpen is false', () => {
            fixture.detectChanges();
            const cancelBtn = fixture.nativeElement.querySelector('#cancelModalBtn');
            expect(cancelBtn).toBeNull();
        });

        it('should NOT render close modal button when isDialogOpen is false', () => {
            fixture.detectChanges();
            const closeBtn = fixture.nativeElement.querySelector('.close-modal-btn');
            expect(closeBtn).toBeNull();
        });
    });

    // --- Regression tests for corrective fixes ---

    describe('selectedMenu - unknown value', () => {
        it('should handle unknown menu value without throwing', () => {
            expect(() => component.selectedMenu({ name: 'Unknown', value: 'unknown' })).not.toThrow();
        });
    });

    describe('ngOnDestroy', () => {
        it('should unsubscribe active subscriptions', () => {
            const mockSub1 = { unsubscribe: vi.fn() };
            const mockSub2 = { unsubscribe: vi.fn() };
            (component as any).subscriptions = [mockSub1, mockSub2];

            component.ngOnDestroy();

            expect(mockSub1.unsubscribe).toHaveBeenCalled();
            expect(mockSub2.unsubscribe).toHaveBeenCalled();
            expect((component as any).subscriptions).toEqual([]);
        });
    });

    describe('confirmationToDeleteItem - dialog outcomes', () => {
        it('should NOT delete when dialog is cancelled', () => {
            mockDialog.open.mockReturnValue({ afterClosed: () => of(false) });
            const deleteSpy = vi.spyOn(component, 'deleteUploadedMedia').mockResolvedValue(undefined);

            component.confirmationToDeleteItem({ id: '1', name: 'test.jpg', url: '' });

            expect(deleteSpy).not.toHaveBeenCalled();
        });

        it('should delete with correct ID when dialog is confirmed', () => {
            mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
            const deleteSpy = vi.spyOn(component, 'deleteUploadedMedia').mockResolvedValue(undefined);

            component.confirmationToDeleteItem({ id: 'media-42', name: 'photo.png', url: '' });

            expect(deleteSpy).toHaveBeenCalledWith('media-42');
        });
    });

    describe('getPaginatorData - searchValue guard', () => {
        it('should not call searchImage when searchValue is undefined', async () => {
            component.selectedItem = { name: 'Search', value: 'search' };
            component.searchValue = undefined as any;
            const searchSpy = vi.spyOn(component, 'searchImage');

            await component.getPaginatorData({ pageIndex: 1 });

            expect(searchSpy).not.toHaveBeenCalled();
        });

        it('should not call searchImage when searchValue is empty string', async () => {
            component.selectedItem = { name: 'Search', value: 'search' };
            component.searchValue = '';
            const searchSpy = vi.spyOn(component, 'searchImage');

            await component.getPaginatorData({ pageIndex: 1 });

            expect(searchSpy).not.toHaveBeenCalled();
        });
    });

    describe('searchImage - error handling', () => {
        it('should show toast on search error', async () => {
            mockMediaManagerService.getImagesFromUnsplash.mockRejectedValueOnce(new Error('Network error'));
            const toastService = TestBed.inject(ToastService) as any;

            component.searchImage('nature', 1);
            // Flush microtasks: rejection propagates through .then() → .catch()
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(toastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Failed to search images. Please try again.', 'error', 'error');
        });

        it('should reset isSearching flag on error', async () => {
            mockMediaManagerService.getImagesFromUnsplash.mockRejectedValueOnce(new Error('Network error'));

            component.searchImage('nature', 1);
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(component.isSearching).toBe(false);
        });
    });

    describe('deleteUploadedMedia - error handling', () => {
        it('should show toast on delete error', async () => {
            mockFileUploadService.deleteMediaItem.mockRejectedValueOnce(new Error('Delete failed'));
            const toastService = TestBed.inject(ToastService) as any;

            await component.deleteUploadedMedia('media-id');

            expect(toastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Failed to delete media item. Please try again.', 'error', 'error');
        });
    });

    describe('getUrl - null safety', () => {
        it('should return empty string for null element', () => {
            expect(component.getUrl(null)).toBe('');
        });

        it('should return empty string for element without urls', () => {
            expect(component.getUrl({})).toBe('');
        });

        it('should return empty string for element with urls but no regular', () => {
            expect(component.getUrl({ urls: {} })).toBe('');
        });
    });

    describe('currentPageIndex', () => {
        it('should update on forward navigation', async () => {
            component.selectedItem = { name: 'Upload', value: 'upload' };
            component.pagination = { pageSize: 20, totalItems: 100, lastVisible: {} as any };

            await component.getPaginatorData({ pageIndex: 1, previousPageIndex: 0 });

            expect(component.currentPageIndex).toBe(1);
        });

        it('should reset to 0 on menu switch', () => {
            component.currentPageIndex = 3;
            component.selectedMenu({ name: 'Upload', value: 'upload' });

            expect(component.currentPageIndex).toBe(0);
        });
    });

    describe('fontawesome removal', () => {
        it('should not render .icon_div in template', () => {
            fixture.detectChanges();
            const iconDiv = fixture.nativeElement.querySelector('.icon_div');
            expect(iconDiv).toBeNull();
        });
    });
});

describe('MediaManagerComponent as Dialog', () => {
    let component: MediaManagerComponent;
    let fixture: ComponentFixture<MediaManagerComponent>;
    let mockDialogRef: any;

    beforeEach(async () => {
        mockDialogRef = {
            close: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [MediaManagerComponent, BrowserAnimationsModule],
            providers: [
                { provide: MediaManagerService, useValue: { getMediaListFromFirestore: vi.fn().mockReturnValue(NEVER), isUnsplashConfigured: vi.fn().mockResolvedValue(true) } },
                { provide: MediaManagerStore, useValue: { add: vi.fn(), addBatch: vi.fn().mockReturnValue(of([])) } },
                { provide: FileUploadService, useValue: { uploadFileInDb: vi.fn(), uploadFile: vi.fn(), validateFileType: vi.fn().mockReturnValue(null), validateFileSize: vi.fn().mockReturnValue(null), deleteMediaItem: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: { isDialogOpen: true } },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), openCustomSnackbar: vi.fn() } },
                { provide: GlobalService, useValue: { debugMode: vi.fn(() => false) } },
                { provide: Location, useValue: { back: vi.fn() } },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => null }), snapshot: { paramMap: { get: () => null } } } },
                { provide: Firestore, useValue: {} },
                ConstantVariables,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MediaManagerComponent);
        component = fixture.componentInstance;

        // Spy on ref.detectChanges to prevent errors after destruction
        vi.spyOn(component.ref, 'detectChanges').mockImplementation(() => { });
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('should have isDialogOpen as true when opened as dialog', () => {
        expect(component._DIALOG_DATA.isDialogOpen).toBe(true);
    });

    describe('DOM visibility when in dialog mode', () => {
        it('should render Insert Media button when isDialogOpen is true', () => {
            fixture.detectChanges();
            const insertBtn = fixture.nativeElement.querySelector('#insertMediaBtn');
            expect(insertBtn).not.toBeNull();
            expect(insertBtn.textContent).toContain('Insert Media');
        });

        it('should render Cancel button when isDialogOpen is true', () => {
            fixture.detectChanges();
            const cancelBtn = fixture.nativeElement.querySelector('#cancelModalBtn');
            expect(cancelBtn).not.toBeNull();
            expect(cancelBtn.textContent.trim()).toBe('Cancel');
        });

        it('should render close modal button when isDialogOpen is true', () => {
            fixture.detectChanges();
            const closeBtn = fixture.nativeElement.querySelector('.close-modal-btn');
            expect(closeBtn).not.toBeNull();
        });

        it('Insert Media button should call insertMedia when clicked', () => {
            fixture.detectChanges();
            const insertSpy = vi.spyOn(component, 'insertMedia');
            const insertBtn = fixture.nativeElement.querySelector('#insertMediaBtn');
            insertBtn.click();
            expect(insertSpy).toHaveBeenCalled();
        });
    });
});

/**
 * Which tabs a caller gets.
 *
 * The dialog is both the image picker and the icon picker, and a caller wants
 * exactly one job done. Offering the wrong tabs is not cosmetic: choosing a
 * photo in an icon-field dialog returns a URL the field discards, so Insert
 * closes the dialog having silently done nothing.
 */
describe('MediaManagerComponent tab visibility', () => {
    async function openWith(data: any) {
        await TestBed.configureTestingModule({
            imports: [MediaManagerComponent, BrowserAnimationsModule],
            providers: [
                { provide: MediaManagerService, useValue: { getMediaListFromFirestore: vi.fn().mockReturnValue(NEVER), isUnsplashConfigured: vi.fn().mockResolvedValue(true) } },
                { provide: MediaManagerStore, useValue: { add: vi.fn(), addBatch: vi.fn().mockReturnValue(of([])) } },
                { provide: FileUploadService, useValue: { uploadFileInDb: vi.fn(), uploadFile: vi.fn(), validateFileType: vi.fn().mockReturnValue(null), validateFileSize: vi.fn().mockReturnValue(null), deleteMediaItem: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: MatDialogRef, useValue: { close: vi.fn() } },
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), openCustomSnackbar: vi.fn() } },
                { provide: GlobalService, useValue: { debugMode: vi.fn(() => false) } },
                { provide: Location, useValue: { back: vi.fn() } },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => null }), snapshot: { paramMap: { get: () => null } } } },
                { provide: Firestore, useValue: {} },
                ConstantVariables,
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(MediaManagerComponent);
        const component = fixture.componentInstance;
        vi.spyOn(component.ref, 'detectChanges').mockImplementation(() => { });
        return { fixture, component };
    }

    it('shows only the image tabs by default', async () => {
        const { component } = await openWith({ isDialogOpen: true });

        expect(component.menuItems.map(i => i.value)).toEqual(['upload', 'search']);
        expect(component.showTabBar).toBe(true);
    });

    it('adds the Icons tab when the caller asks for icons too', async () => {
        const { component } = await openWith({ isDialogOpen: true, allowIcons: true });

        expect(component.menuItems.map(i => i.value)).toEqual(['upload', 'search', 'icons']);
    });

    it('shows only the Icons tab for an icons-only caller', async () => {
        const { component } = await openWith({ isDialogOpen: true, allowIcons: true, allowImages: false });

        expect(component.menuItems.map(i => i.value)).toEqual(['icons']);
    });

    it('hides the tab bar entirely when there is only one tab', async () => {
        const { component, fixture } = await openWith({ isDialogOpen: true, allowIcons: true, allowImages: false });
        fixture.detectChanges();

        // A single highlighted tab implies others to switch to.
        expect(component.showTabBar).toBe(false);
        expect(fixture.nativeElement.querySelector('.media-tabs')).toBeNull();
        expect(fixture.nativeElement.querySelector('.media-single-title')?.textContent).toContain('Icons');
    });

    it('falls back to images when the caller allows neither kind', async () => {
        const { component } = await openWith({ isDialogOpen: true, allowImages: false });

        // A misconfiguration, not a request for an empty dialog.
        expect(component.menuItems.map(i => i.value)).toEqual(['upload', 'search']);
    });

    it('opens on the requested tab', async () => {
        const { component } = await openWith({ isDialogOpen: true, allowIcons: true, initialTab: 'icons' });
        component.ngOnInit();

        expect(component.selectedItem?.value).toBe('icons');
        expect(component.isIconsTab).toBe(true);
    });

    it('ignores an initial tab the caller has not allowed', async () => {
        const { component } = await openWith({ isDialogOpen: true, initialTab: 'icons' });
        component.ngOnInit();

        expect(component.selectedItem?.value).toBe('upload');
    });

    it('does not read upload settings for an icons-only dialog', async () => {
        const { component } = await openWith({ isDialogOpen: true, allowIcons: true, allowImages: false });
        const getDocSpy = vi.spyOn(component as any, 'loadMediaUploadSettings');
        component.ngOnInit();

        // Nothing in this dialog can upload, so the Firestore read is waste.
        expect(getDocSpy).not.toHaveBeenCalled();
    });

    it('still reads upload settings when an image tab is present', async () => {
        const { component } = await openWith({ isDialogOpen: true, allowIcons: true });
        const getDocSpy = vi.spyOn(component as any, 'loadMediaUploadSettings');
        component.ngOnInit();

        expect(getDocSpy).toHaveBeenCalled();
    });
});
