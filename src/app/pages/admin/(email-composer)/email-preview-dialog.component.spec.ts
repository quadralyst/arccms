/** The composer's preview shows the email as written, and its links cannot replace it. */
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import { EmailPreviewDialogComponent } from './email-preview-dialog.component';
import { EMAIL_FRAME_SANDBOX } from '../../../../shared/utils/email-preview';

describe('EmailPreviewDialogComponent', () => {
    it('keeps the inline styles and opens a link in a new tab, in a frame with no scripts', () => {
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
        expect(frame.getAttribute('sandbox')).toBe(EMAIL_FRAME_SANDBOX);
        expect(frame.getAttribute('srcdoc')).toBe('<base target="_blank"><p style="color:red"><a href="/x" target="_blank" rel="noopener noreferrer">x</a></p>');
    });
});
