import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import ImportFilesPageComponent from './import-files.page';
import { ImportFilesService } from './import-files.service';

describe('ImportFilesPageComponent', () => {
    let component: ImportFilesPageComponent;
    let fixture: ComponentFixture<ImportFilesPageComponent>;
    let mockImportFilesService: any;

    beforeEach(async () => {
        mockImportFilesService = {
            uploadFile: vi.fn().mockResolvedValue({ downloadURL: 'https://example.com/file.jpg', fullPath: 'mediaImages/file.jpg' }),
            uploadFiles: vi.fn().mockResolvedValue([
                { fileName: 'img1.jpg', storagePath: 'mediaImages/img1.jpg', downloadURL: 'https://example.com/img1.jpg', success: true },
            ]),
            updateMediaMetadata: vi.fn().mockResolvedValue(undefined),
            importFromManifest: vi.fn().mockResolvedValue([
                { fileName: 'img1.jpg', storagePath: 'mediaImages/img1.jpg', downloadURL: 'https://example.com/img1.jpg', success: true },
            ]),
        };

        await TestBed.configureTestingModule({
            imports: [
                ImportFilesPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: {} },
                { provide: Storage, useValue: {} },
                { provide: ImportFilesService, useValue: mockImportFilesService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ImportFilesPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should default to upload mode', () => {
        expect(component.mode()).toBe('upload');
    });

    it('should switch to manifest mode', () => {
        component.mode.set('manifest');
        expect(component.mode()).toBe('manifest');
    });

    it('should accept multiple files via file input', () => {
        const files = [
            new File(['1'], 'img1.jpg', { type: 'image/jpeg' }),
            new File(['2'], 'img2.png', { type: 'image/png' }),
        ];

        const event = { target: { files } } as any;
        component.onFilesSelected(event);

        expect(component.selectedFiles().length).toBe(2);
    });

    it('should accept files via drag and drop', () => {
        const files = [new File(['1'], 'dropped.jpg')];
        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            dataTransfer: { files },
        } as any;

        component.onDrop(event);

        expect(component.selectedFiles().length).toBe(1);
        expect(component.selectedFiles()[0].name).toBe('dropped.jpg');
    });

    it('should show file list after selection', () => {
        const files = [new File(['content'], 'test.jpg')];
        component.selectedFiles.set(files);

        expect(component.selectedFiles().length).toBe(1);
        expect(component.totalSize).toBeGreaterThan(0);
    });

    it('should remove file from list', () => {
        const files = [
            new File(['1'], 'img1.jpg'),
            new File(['2'], 'img2.png'),
        ];
        component.selectedFiles.set(files);

        component.removeFile(0);

        expect(component.selectedFiles().length).toBe(1);
        expect(component.selectedFiles()[0].name).toBe('img2.png');
    });

    it('should call uploadFiles when upload starts', async () => {
        component.selectedFiles.set([new File(['1'], 'img1.jpg')]);

        await component.startUpload();

        expect(mockImportFilesService.uploadFiles).toHaveBeenCalled();
    });

    it('should show upload results after completion', async () => {
        component.selectedFiles.set([new File(['1'], 'img1.jpg')]);

        await component.startUpload();

        expect(component.uploadResults()).toBeTruthy();
        expect(component.uploadResults()!.length).toBe(1);
    });

    it('should update media metadata when option is enabled', async () => {
        component.selectedFiles.set([new File(['1'], 'img1.jpg')]);
        component.updateMediaCollection.set(true);

        await component.startUpload();

        expect(mockImportFilesService.updateMediaMetadata).toHaveBeenCalled();
    });

    it('should use manifest mode when selected', async () => {
        component.mode.set('manifest');
        component.manifestData.set({ media1: { name: 'img1.jpg', storagePath: 'mediaImages/img1.jpg' } });
        component.selectedFiles.set([new File(['1'], 'img1.jpg')]);

        await component.startUpload();

        expect(mockImportFilesService.importFromManifest).toHaveBeenCalledWith(
            component.manifestData(),
            component.selectedFiles(),
            expect.any(Function),
        );
    });

    it('should reset all state on resetUpload', () => {
        component.selectedFiles.set([new File(['1'], 'img1.jpg')]);
        component.uploadResults.set([{ fileName: 'img1.jpg', storagePath: '', downloadURL: '', success: true }]);

        component.resetUpload();

        expect(component.selectedFiles().length).toBe(0);
        expect(component.uploadResults()).toBeNull();
    });

    it('should format file sizes correctly', () => {
        expect(component.formatSize(0)).toBe('0 B');
        expect(component.formatSize(1024)).toBe('1 KB');
    });
});
