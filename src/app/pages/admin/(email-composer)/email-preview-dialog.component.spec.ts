/** The composer's preview shows the email as written, and its links cannot replace it. */
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import { EmailPreviewDialogComponent } from './email-preview-dialog.component';

describe('EmailPreviewDialogComponent', () => {
    it('keeps the inline styles and stops a link leaving the email, in a frame with no scripts', () => {
        TestBed.configureTestingModule({
            imports: [EmailPreviewDialogComponent],
            providers: [
                { provide: MatDialogRef, useValue: { close: vi.fn() } },
                { provide: MAT_DIALOG_DATA, useValue: { html: '<p style="color:red"><a href="/x">x</a></p>' } },
            ],
        });
        const fixture = TestBed.createComponent(EmailPreviewDialogComponent);
        fixture.detectChanges();
        const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
        expect(frame.getAttribute('sandbox')).toBe('');
        expect(frame.getAttribute('srcdoc')).toBe('<base target="_blank"><p style="color:red"><a href="/x">x</a></p>');
    });
});
