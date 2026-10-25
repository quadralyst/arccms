/**
 * Arc CMS's fresh-code dialog (docs/app/fresh-code.html): sends as it opens, closes
 * with the proof on the right code, with null on Cancel, and says what went wrong.
 */
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FreshCodeDialogComponent } from './fresh-code-dialog.component';
import { FreshCodeService } from './fresh-code.service';

describe('FreshCodeDialogComponent', () => {
    let codes: { request: ReturnType<typeof vi.fn>; confirmCode: ReturnType<typeof vi.fn> };
    let ref: { close: ReturnType<typeof vi.fn> };

    async function open() {
        await TestBed.configureTestingModule({
            imports: [FreshCodeDialogComponent, NoopAnimationsModule, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: { purpose: 'pos-setup' } },
                { provide: MatDialogRef, useValue: ref },
                { provide: FreshCodeService, useValue: codes },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(FreshCodeDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        return fixture;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        ref = { close: vi.fn() };
        codes = {
            request: vi.fn().mockResolvedValue({ sent: true, via: 'email', to: 'a•••@example.com' }),
            confirmCode: vi.fn().mockResolvedValue('the-proof'),
        };
    });

    it('sends a code for its purpose as it opens, and says where it went', async () => {
        const fixture = await open();
        expect(codes.request).toHaveBeenCalledWith('pos-setup');
        expect(fixture.componentInstance.sent()?.to).toBe('a•••@example.com');
        expect(fixture.componentInstance.wait()).toBe(60);
    });

    it('closes with the proof when the code is right', async () => {
        const fixture = await open();
        await fixture.componentInstance.check('123456');
        expect(codes.confirmCode).toHaveBeenCalledWith('pos-setup', '123456');
        expect(ref.close).toHaveBeenCalledWith('the-proof');
    });

    it('stays open and shows the refusal when the code is wrong', async () => {
        codes.confirmCode.mockRejectedValue({ code: 'functions/invalid-argument', message: "That code didn't work.", details: { reason: 'code-wrong' } });
        const fixture = await open();
        await fixture.componentInstance.check('000000');
        expect(ref.close).not.toHaveBeenCalled();
        expect(fixture.componentInstance.error()).toBe("That code didn't work.");
        expect(fixture.componentInstance.working()).toBe(false);
    });

    it('shows a refused send, and waits as long as the server says', async () => {
        codes.request.mockRejectedValue({ code: 'functions/resource-exhausted', message: 'Please wait 40 seconds.', details: { reason: 'wait', wait: 40 } });
        const fixture = await open();
        expect(fixture.componentInstance.error()).toBe('Please wait 40 seconds.');
        expect(fixture.componentInstance.wait()).toBe(40);
    });

    it('closes with null on Cancel', async () => {
        const fixture = await open();
        fixture.componentInstance.cancel();
        expect(ref.close).toHaveBeenCalledWith(null);
    });
});
