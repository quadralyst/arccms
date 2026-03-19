import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import ExportFilesPageComponent from './export-files.page';
import { ExportFilesService } from './export-files.service';
import { MediaDocInfo } from '../data-constants';

describe('ExportFilesPageComponent', () => {
    let component: ExportFilesPageComponent;
    let fixture: ComponentFixture<ExportFilesPageComponent>;
    let mockExportFilesService: any;

    const mockMediaItems: MediaDocInfo[] = [
        {
            id: 'media1',
            name: 'image_001',
            downloadURL: 'https://example.com/img1.jpg',
            storagePath: 'mediaImages/image_001.jpg',
            uploadTime: '2024-01-15T10:00:00Z',
            type: 'image',
        },
        {
            id: 'media2',
            name: 'image_002',
            downloadURL: 'https://example.com/img2.png',
            storagePath: 'mediaImages/image_002.png',
            uploadTime: '2024-01-14T09:00:00Z',
            type: 'image',
        },
        {
            id: 'media3',
            name: 'image_003',
            downloadURL: 'https://example.com/img3.jpg',
            storagePath: 'mediaImages/image_003.jpg',
            uploadTime: '2024-01-13T08:00:00Z',
            type: 'image',
        },
    ];

    beforeEach(async () => {
        mockExportFilesService = {
            getMediaItems: vi.fn().mockResolvedValue(mockMediaItems),
            downloadAsZip: vi.fn().mockResolvedValue(new Blob(['zip'])),
            triggerDownload: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                ExportFilesPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: {} },
                { provide: Storage, useValue: {} },
                { provide: ExportFilesService, useValue: mockExportFilesService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ExportFilesPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        // Wait for async ngOnInit
        await fixture.whenStable();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load media items on init', async () => {
        expect(mockExportFilesService.getMediaItems).toHaveBeenCalled();
        expect(component.mediaItems().length).toBe(3);
    });

    it('should display media items with correct info', () => {
        expect(component.mediaItems()[0].name).toBe('image_001');
        expect(component.mediaItems()[1].name).toBe('image_002');
        expect(component.mediaItems()[2].name).toBe('image_003');
    });

    it('should start with no items selected', () => {
        expect(component.selectedCount).toBe(0);
    });

    it('should report total count', () => {
        expect(component.totalCount).toBe(3);
    });

    it('should toggle all items', () => {
        component.toggleAll(true);
        expect(component.mediaItems().every((m) => m.selected)).toBe(true);
        expect(component.selectedCount).toBe(3);
        expect(component.allSelected).toBe(true);
    });

    it('should deselect all items', () => {
        component.toggleAll(true);
        component.toggleAll(false);
        expect(component.selectedCount).toBe(0);
        expect(component.allSelected).toBe(false);
    });

    it('should toggle individual item by id', () => {
        component.toggleItem('media1');
        expect(component.mediaItems().find((m) => m.id === 'media1')?.selected).toBe(true);
        expect(component.selectedCount).toBe(1);
    });

    it('should report someSelected (indeterminate)', () => {
        component.toggleItem('media1');
        expect(component.someSelected).toBe(true);
        expect(component.allSelected).toBe(false);
    });

    it('should call downloadAsZip with selected items', async () => {
        component.toggleAll(true);
        await component.downloadAsZip();

        expect(mockExportFilesService.downloadAsZip).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ id: 'media1' }),
                expect.objectContaining({ id: 'media2' }),
                expect.objectContaining({ id: 'media3' }),
            ]),
            expect.any(Function),
        );
        expect(mockExportFilesService.triggerDownload).toHaveBeenCalled();
    });

    it('should not call downloadAsZip when nothing selected', async () => {
        await component.downloadAsZip();
        expect(mockExportFilesService.downloadAsZip).not.toHaveBeenCalled();
    });

    it('should format dates correctly', () => {
        expect(component.formatUploadDate('2024-01-15T10:00:00Z')).toContain('Jan');
        expect(component.formatUploadDate('2024-01-15T10:00:00Z')).toContain('2024');
    });

    it('should handle empty date string', () => {
        expect(component.formatUploadDate('')).toBe('');
    });

    it('should handle load error gracefully', async () => {
        mockExportFilesService.getMediaItems.mockRejectedValueOnce(new Error('Network error'));

        fixture = TestBed.createComponent(ExportFilesPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.loadError()).toBe('Network error');
        expect(component.mediaItems().length).toBe(0);
    });
});
