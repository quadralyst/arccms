import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { NEVER, of } from 'rxjs';
import MediaManagerComponent, { MediaDialogData, sameShape } from './media.page';
import { MediaManagerService } from './media-manager.service';
import { MediaManagerStore } from './media-manager.store';
import { MediaFilesService } from './media-files.service';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalService } from '../../../../shared/services/global.service';
import { ConstantVariables } from '../../../../shared/constants/common-constants';
import { MediaAiService } from './media-ai.service';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: vi.fn(),
    collection: vi.fn(),
    getFirestore: vi.fn(() => ({})),
    doc: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
    deleteDoc: vi.fn(),
    onSnapshot: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
}));

vi.mock('@angular/fire/storage', () => ({
    getStorage: vi.fn(() => ({})),
    ref: vi.fn(),
    uploadBytesResumable: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(),
}));

const upload = {
    id: 'up1',
    url: 'https://storage/xl',
    name: 'team-a1b2c3-xl.webp',
    title: 'Team',
    variants: {
        s: { url: 'https://storage/s', path: 's', width: 300, height: 200 },
        m: { url: 'https://storage/m', path: 'm', width: 600, height: 400 },
        l: { url: 'https://storage/l', path: 'l', width: 900, height: 600 },
        xl: { url: 'https://storage/xl', path: 'xl', width: 1200, height: 800 },
    },
};

const note = { prompt: 'A bowl of fruit', model: 'gpt-image-2', connection: 'oa', settings: { aspect: '3:2' as const, quality: 'high' as const, count: 1 }, costUsd: 0.211, createdAt: new Date(), createdBy: 'u1', recordId: 'r1', purpose: 'arc-media-image' };
const saved = { id: 'ai1', media: { downloadURL: 'https://storage/ai-xl', name: 'a-bowl.webp', uploadTime: new Date(), variants: upload.variants, title: 'A bowl of fruit', ai: note } };

/**
 * The Media Manager's Create with AI tab (specs/ai-media-spec.md, AM-D21 to AM-D26): offered
 * only with a picture model, opened by a caller's initialTab, a saved picture handed to My
 * Uploads in a picker with the caller's crop, Edit with AI and Generate again.
 */
describe('MediaManagerComponent, Create with AI', () => {
    let fixture: ComponentFixture<MediaManagerComponent>;
    let component: MediaManagerComponent;
    let dialogRef: { close: ReturnType<typeof vi.fn> };
    let fileUpload: any;
    let store: any;
    let mediaService: any;
    let ai: any;
    const settle = () => new Promise((r) => setTimeout(r, 0));

    async function create(data: MediaDialogData, available = true) {
        ai = { available: vi.fn(async () => available), info: vi.fn(async () => ({ purpose: { id: 'arc-media-image', label: 'Media image', enabled: true, house: false }, test: true, models: [], estimate: null, allowance: null, budget: { monthlyUsd: 20, spent: 0, left: 20 } })), generate: vi.fn(), read: vi.fn() };
        dialogRef = { close: vi.fn() };
        fileUpload = {
            uploadFile: vi.fn(),
            uploadCroppedCopy: vi.fn().mockResolvedValue({
                downloadURL: 'https://storage/crop-xl',
                name: 'team-crop-q1w2e3-xl.webp',
                uploadTime: new Date(),
                width: 600,
                height: 600,
                variants: { ...upload.variants, xl: { url: 'https://storage/crop-xl', path: 'cxl', width: 600, height: 600 } },
            }),
            validateFileType: vi.fn().mockReturnValue(null),
            deleteMediaItem: vi.fn(),
        };
        store = { add: vi.fn(), addBatch: vi.fn().mockReturnValue(of(['crop-id'])) };
        mediaService = {
            getMediaListFromFirestore: vi.fn().mockReturnValue(NEVER),
            isUnsplashConfigured: vi.fn().mockResolvedValue(true),
            warmupUnsplash: vi.fn(),
            readMediaImage: vi.fn().mockResolvedValue(new Blob(['xl'], { type: 'image/webp' })),
        };

        await TestBed.configureTestingModule({
            imports: [MediaManagerComponent, BrowserAnimationsModule],
            providers: [
                { provide: MediaManagerService, useValue: mediaService },
                { provide: MediaManagerStore, useValue: store },
                { provide: FileUploadService, useValue: fileUpload },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), openCustomSnackbar: vi.fn() } },
                { provide: GlobalService, useValue: { debugMode: vi.fn(() => false) } },
                { provide: Location, useValue: { back: vi.fn() } },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => null }), snapshot: { paramMap: { get: () => null } } } },
                { provide: Firestore, useValue: {} },
                { provide: MediaFilesService, useValue: { listPage: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }), listAll: vi.fn().mockResolvedValue([]), pdfBytes: vi.fn(), addBatch: vi.fn(() => of([])), saveDetails: vi.fn(), deleteFile: vi.fn(), rememberBytes: vi.fn() } },
                { provide: MediaAiService, useValue: ai },
                ConstantVariables,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MediaManagerComponent);
        component = fixture.componentInstance;
        vi.spyOn(component.ref, 'detectChanges').mockImplementation(() => { });
        vi.spyOn(component.notify, 'success').mockImplementation(() => { });
        vi.spyOn(component.notify, 'error').mockImplementation(() => { });
    }

    afterEach(() => fixture?.destroy());

    it('offers the tab only once a picture model is known, after My Uploads', async () => {
        await create({ isDialogOpen: true });
        component.ngOnInit();
        expect(component.menuItems.some((i) => i.value === 'ai')).toBe(false);
        await settle();
        expect(component.menuItems.map((i) => i.value).slice(0, 2)).toEqual(['upload', 'ai']);
        expect(ai.available).toHaveBeenCalledWith('arc-media-image');
    });

    it('stays hidden without a picture model', async () => {
        await create({ isDialogOpen: true }, false);
        component.ngOnInit();
        await settle();
        expect(component.menuItems.some((i) => i.value === 'ai')).toBe(false);
        component.editWithAi(upload);
        expect(component.isAiTab).toBe(false);
    });

    it('opens on the tab when the caller asks, with its purpose\'s house style', async () => {
        await create({ isDialogOpen: true, initialTab: 'ai', ai: { purpose: 'cover', prompt: 'A cover' } });
        component.ngOnInit();
        await settle();
        expect(component.isAiTab).toBe(true);
        expect(component.aiPreset).toEqual({ purpose: 'cover', prompt: 'A cover' });
        expect(ai.available).toHaveBeenCalledWith('cover');
    });

    it('in a picker, selects a saved picture in My Uploads and opens the crop at the caller\'s ratio when its shape differs', async () => {
        await create({ isDialogOpen: true, cropRatio: '16:9' });
        component.ngOnInit();
        await settle();
        component.selectedMenu(component.menuItems.find((i) => i.value === 'ai')!);
        component.onAiSaved(saved);
        expect(component.selectedItem?.value).toBe('upload');
        expect(component.selectedMediaUrl).toMatchObject({ id: 'ai1', ai: note });
        expect(component.isCropping).toBe(true);
        expect(component.cropRatio).toBe('16:9');
    });

    it('skips the crop when the picture is already the caller\'s shape', async () => {
        await create({ isDialogOpen: true, cropRatio: '16:9' });
        component.ngOnInit();
        await settle();
        component.onAiSaved({ ...saved, media: { ...saved.media, width: 1376, height: 768 } });
        expect(component.selectedMediaUrl).toMatchObject({ id: 'ai1' });
        expect(component.isCropping).toBe(false);
        expect(sameShape(1200, 800, '3:2')).toBe(true);
        expect(sameShape(1200, 800, '16:9')).toBe(false);
    });

    it('on the Media page, stays in the tab after a save', async () => {
        await create({ isDialogOpen: false });
        component.ngOnInit();
        await settle();
        component.selectedMenu(component.menuItems.find((i) => i.value === 'ai')!);
        component.onAiSaved(saved);
        expect(component.isAiTab).toBe(true);
    });

    it('Edit with AI opens the tab on a library picture; another tab leaves it', async () => {
        await create({ isDialogOpen: true });
        component.ngOnInit();
        await settle();
        component.editWithAi(upload);
        expect(component.isAiTab).toBe(true);
        expect(component.aiEditSource).toEqual({ id: 'up1', url: 'https://storage/s', title: 'Team', width: 1200, height: 800 });
        component.selectedMenu(component.menuItems[0]);
        expect(component.aiEditSource).toBeNull();
        // An Unsplash photo is not the library's to edit.
        component.editWithAi({ id: 'un1', urls: { regular: 'https://images.unsplash.com/x' } });
        expect(component.isAiTab).toBe(false);
    });

    it('Generate again opens the tab with the note\'s settings', async () => {
        await create({ isDialogOpen: true });
        component.ngOnInit();
        await settle();
        component.generateAgain(note);
        expect(component.isAiTab).toBe(true);
        expect(component.aiPreset).toEqual({ prompt: 'A bowl of fruit', model: 'oa/gpt-image-2', aspect: '3:2', quality: 'high', count: 1 });
    });
});
