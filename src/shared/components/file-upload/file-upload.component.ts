import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileUploadService } from '../../services/file-upload.service';

@Component({
    selector: 'arc-file-upload',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="file-upload-container">
      <h3>File Upload</h3>
      <input type="file" (change)="onFileSelected($event)" accept="image/*" />
      
      @if(uploadProgress() > 0 && uploadProgress() < 100){
      <div>
        Uploading: {{ uploadProgress() | number:'1.0-0' }}%
      </div>
      }

      @if(uploadedUrl()){
      <div>
        <p>Last Upload:</p>
        <img [src]="uploadedUrl()" alt="Uploaded Image" width="200" style="max-width: 100%" />
      </div>
      }

      @if(error()){
      <div>
        {{ error() }}
      </div>
      }
    </div>
  `,
    styles: [`
    .file-upload-container { padding: 20px; border: 1px dashed #ccc; margin: 20px; }
  `]
})
export class FileUploadComponent {
    fileUploadService = inject(FileUploadService);
    uploadProgress = signal(0);
    uploadedUrl = signal('');
    error = signal('');

    async onFileSelected(event: any) {
        const file: File = event.target.files[0];
        if (file) {
            this.error.set('');
            try {
                const reader = new FileReader();
                reader.onload = async (e: any) => {
                    const base64 = e.target.result;
                    this.uploadProgress.set(1); // Start progress
                    const result = await this.fileUploadService.uploadFileInDb(base64, (progress) => {
                        this.uploadProgress.set(progress);
                    });
                    this.uploadedUrl.set(result.downloadURL);
                    this.uploadProgress.set(100);
                };
                reader.readAsDataURL(file);
            } catch (err) {
                this.error.set('Upload failed');
                console.error(err);
                this.uploadProgress.set(0);
            }
        }
    }
}
