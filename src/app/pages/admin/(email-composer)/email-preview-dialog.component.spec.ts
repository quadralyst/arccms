/** The composer's preview shows the email as written, and its links cannot replace it. */
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import { EmailPreviewDialogComponent } from './email-preview-dialog.component';
import { EMAIL_FRAME_SANDBOX } from '../../../../shared/utils/email-preview';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const en = JSON.parse(readFileSync(resolve(__dirname, '../../../../assets/i18n/en.json'), 'utf8'));
const transloco = TranslocoTestingModule.forRoot({ langs: { en }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true });

describe('EmailPreviewDialogComponent', () => {
    it('keeps the inline styles and opens a link in a new tab, in a frame with no scripts', async () => {
        TestBed.configureTestingModule({
            imports: [EmailPreviewDialogComponent, transloco],
            providers: [
                { provide: MatDialogRef, useValue: { close: vi.fn() } },
                { provide: MAT_DIALOG_DATA, useValue: { html: '<p style="color:red"><a href="/x">x</a></p>' } },
            ],
        });
        const fixture = TestBed.createComponent(EmailPreviewDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
        expect(frame.getAttribute('sandbox')).toBe(EMAIL_FRAME_SANDBOX);
        expect(fixture.nativeElement.querySelector('button[mat-dialog-close]').getAttribute('aria-label')).toBe('Close preview');
        expect(frame.getAttribute('srcdoc')).toBe('<base target="_blank"><p style="color:red"><a href="/x" target="_blank" rel="noopener noreferrer">x</a></p>');
    });
});
