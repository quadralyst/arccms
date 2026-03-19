import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FileUploadComponent } from './file-upload.component';
import { FileUploadService } from '../../services/file-upload.service';
import { vi } from 'vitest';

describe('FileUploadComponent', () => {
    let component: FileUploadComponent;
    let fixture: ComponentFixture<FileUploadComponent>;
    let mockFileUploadService: any;

    beforeEach(async () => {
        mockFileUploadService = {
            uploadFileInDb: vi.fn().mockImplementation((base64, progressCallback) => {
                progressCallback(50);
                return Promise.resolve({
                    downloadURL: 'http://test.com/img.jpg',
                    name: 'img_123',
                    uploadTime: new Date()
                });
            })
        };

        await TestBed.configureTestingModule({
            imports: [FileUploadComponent],
            providers: [
                { provide: FileUploadService, useValue: mockFileUploadService }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(FileUploadComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should upload file on selection', async () => {
        const mockFile = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
        const mockEvent = { target: { files: [mockFile] } };

        await component.onFileSelected(mockEvent);

        // Wait for FileReader to complete
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(mockFileUploadService.uploadFileInDb).toHaveBeenCalled();
        expect(component.uploadedUrl()).toBe('http://test.com/img.jpg');
        expect(component.uploadProgress()).toBe(100);
    });
});
