/**
 * Tests for the confirmation dialog: its buttons, where focus starts, and the
 * ConfirmService that opens it in place of the browser's confirm().
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConfirmationDialogData, ConfirmationPopupComponent } from './confirmation-popup.component';
import { ConfirmService } from './confirm.service';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

async function setUp(data: ConfirmationDialogData, lang?: string) {
    const dialogRef = { close: vi.fn() };
    await TestBed.configureTestingModule({
        imports: [ConfirmationPopupComponent, NoopAnimationsModule, translocoTestingModule(lang ? { lang } : {})],
        providers: [
            { provide: MatDialogRef, useValue: dialogRef },
            { provide: MAT_DIALOG_DATA, useValue: data },
        ],
    }).compileComponents();
    const fixture: ComponentFixture<ConfirmationPopupComponent> = TestBed.createComponent(ConfirmationPopupComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, component: fixture.componentInstance, dialogRef, el };
}

describe('ConfirmationPopupComponent', () => {
    const data: ConfirmationDialogData = {
        dialogType: 'Delete',
        dialogMessage: 'Delete <strong>Spring sale</strong>?',
        btnText: 'Delete',
        panelType: 'warn',
    };

    it('has the arc-confirmation-popup selector', () => {
        const componentDef = (ConfirmationPopupComponent as any).ɵcmp;
        expect(componentDef.selectors[0][0]).toBe('arc-confirmation-popup');
    });

    describe('buttons', () => {
        beforeEach(() => TestBed.resetTestingModule());

        it('the cancel button says "Cancel", not "Close"', async () => {
            const { el } = await setUp(data);
            expect(el.querySelector('.cancel-btn')?.textContent?.trim()).toBe('Cancel');
        });

        it('the cancel button is translated', async () => {
            const { el } = await setUp(data, 'hi');
            expect(el.querySelector('.cancel-btn')?.textContent?.trim()).toBe('रद्द करें');
        });

        it('a caller can name the cancel button', async () => {
            const { el } = await setUp({ ...data, cancelText: 'Keep it' });
            expect(el.querySelector('.cancel-btn')?.textContent?.trim()).toBe('Keep it');
        });

        it('focus starts on Cancel, not on the confirm button', async () => {
            const { el } = await setUp(data);
            const initial = el.querySelectorAll('[cdkFocusInitial], [cdkfocusinitial]');
            expect(initial.length).toBe(1);
            expect(initial[0].classList.contains('cancel-btn')).toBe(true);
            expect(el.querySelector('.confirm-btn')?.hasAttribute('cdkfocusinitial')).toBe(false);
        });

        it('the confirm button closes with true, and only once', async () => {
            const { el, dialogRef } = await setUp(data);
            (el.querySelector('.confirm-btn') as HTMLButtonElement).click();
            expect(dialogRef.close).toHaveBeenCalledTimes(1);
            expect(dialogRef.close).toHaveBeenCalledWith(true);
        });

        it('a warn dialog has a red confirm button', async () => {
            const { el } = await setUp(data);
            expect(el.querySelector('.confirm-btn')?.classList.contains('btn-danger')).toBe(true);
        });

        it('shows the message and the confirm text', async () => {
            const { el } = await setUp(data);
            expect(el.querySelector('mat-dialog-content strong')?.textContent).toBe('Spring sale');
            expect(el.querySelector('.confirm-btn')?.textContent?.trim()).toBe('Delete');
        });
    });

    describe('title', () => {
        beforeEach(() => TestBed.resetTestingModule());

        it('falls back to dialogType', async () => {
            const { component } = await setUp(data);
            expect(component.title).toBe('Delete');
        });

        it('translates titleKey', async () => {
            const { component } = await setUp({ ...data, titleKey: 'common.dialog.confirm' });
            expect(component.title).toBe('Confirm');
        });
    });
});

describe('ConfirmService', () => {
    function serviceAnswering(answer: unknown) {
        TestBed.resetTestingModule();
        const open = vi.fn().mockReturnValue({ afterClosed: () => of(answer) });
        TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: { open } }] });
        return { service: TestBed.inject(ConfirmService), open };
    }

    it('resolves true only on the confirm button', async () => {
        const { service, open } = serviceAnswering(true);
        const data = { dialogMessage: 'Sure?', btnText: 'Delete' };
        expect(await service.ask(data)).toBe(true);
        expect(open).toHaveBeenCalledWith(ConfirmationPopupComponent, expect.objectContaining({ data }));
    });

    it('resolves false on Cancel, Escape or a click outside', async () => {
        expect(await serviceAnswering(undefined).service.ask({})).toBe(false);
        expect(await serviceAnswering('').service.ask({})).toBe(false);
    });
});
