/** The bar, the review window and the kept drafts (specs/visual-editing-spec.md, VE-D79 to VE-D84). */
import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';
import { HoldService } from '../../../core/editing/hold.service';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { HoldBarComponent } from './hold-bar.component';
import { KeptDraftsComponent } from './kept-drafts.component';
import { ReviewChangesDialogComponent, type ReviewData } from './review-changes-dialog.component';
import { ReviewService, viewOnlyPage } from './review.service';

const change = (field: string, before: string, after: string, extra = {}) => ({ id: `|${field}`, field, lang: '', kind: 'text' as const, before, after, ...extra });

describe('ReviewChangesDialogComponent', () => {
    const close = vi.fn();
    async function open(part: Partial<ReviewData>) {
        close.mockClear();
        const data: ReviewData = {
            title: 'Guide', hold: null, isNew: false, load: async () => [change('title', 'Old words', 'New words')],
            label: (c) => c.field, language: (c) => c, emptyText: 'empty', ...part,
        };
        TestBed.configureTestingModule({
            imports: [ReviewChangesDialogComponent, translocoTestingModule()],
            providers: [{ provide: MAT_DIALOG_DATA, useValue: data }, { provide: MatDialogRef, useValue: { close } }],
        });
        const fixture = TestBed.createComponent(ReviewChangesDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();
        return { fixture, el: fixture.nativeElement as HTMLElement };
    }

    it('shows the old words and the new, and on someone else\'s work Take over and Publish these', async () => {
        const { el } = await open({ hold: { by: 'p', name: 'Priya' } });
        expect(el.querySelector('del')?.textContent).toBe('Old');
        expect(el.querySelector('ins')?.textContent).toBe('New');
        expect(el.querySelector('[data-testid="put-back"]')).toBeNull();
        expect(el.querySelector('[data-testid="review-discard"]')).toBeNull();
        el.querySelector<HTMLButtonElement>('[data-testid="review-takeover"]')!.click();
        expect(close).toHaveBeenCalledWith({ action: 'takeover', seen: [expect.objectContaining({ field: 'title' })] });
    });

    it('puts one back and reads the list again; Discard only when something is live', async () => {
        const putBack = vi.fn(async () => undefined);
        const load = vi.fn().mockResolvedValueOnce([change('title', 'a', 'b')]).mockResolvedValueOnce([]);
        const { fixture, el } = await open({ putBack, load, canDiscard: true });
        expect(el.querySelector('[data-testid="review-discard"]')).not.toBeNull();
        el.querySelector<HTMLButtonElement>('[data-testid="put-back"]')!.click();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(putBack).toHaveBeenCalled();
        expect(el.textContent).toContain('Nothing differs');
        expect(el.querySelector<HTMLButtonElement>('[data-testid="review-publish"]')!.disabled).toBe(true);
    });

    it('draws stored words as words, and only picture addresses that may be drawn', async () => {
        const { el } = await open({ load: async () => [
            change('title', '', '<img src=x onerror=alert(1)>'),
            change('photo', 'javascript:alert(1)', '/media/a.jpg', { kind: 'picture' }),
        ] });
        expect(el.querySelector('.words img')).toBeNull();
        expect(el.querySelector('ins')?.textContent).toContain('<img');
        expect(Array.from(el.querySelectorAll('.pictures img')).map((img) => img.getAttribute('src'))).toEqual(['/media/a.jpg']);
    });

    it('a change that could not be put back says so, and the list stays', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { fixture, el } = await open({ putBack: async () => { throw new Error('offline'); } });
        el.querySelector<HTMLButtonElement>('[data-testid="put-back"]')!.click();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(el.querySelector('[role="alert"]')?.textContent).toContain('could not be put back');
        expect(el.querySelector('[data-testid="review-change"]')).not.toBeNull();
    });

    it('says yes and no, and when only formatting changed', async () => {
        const { el } = await open({ load: async () => [
            change('flag', 'false', 'true', { kind: 'value' }), change('content', 'Same', 'Same', { kind: 'rich', sameWords: true }),
        ] });
        expect(el.querySelector('ins')?.textContent).toBe('Yes');
        expect(el.textContent).toContain('Only formatting');
    });

    it('says when the changes could not be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { el } = await open({ load: async () => { throw new Error('offline'); } });
        expect(el.querySelector('[role="alert"]')?.textContent).toContain('could not be read');
    });

    it('lets the cards that go with it be chosen', async () => {
        const cards = [{ type: 'quotes', id: 'a', name: 'Quotes: A', take: true }];
        const { el } = await open({ hold: { by: 'p', name: 'Priya' }, cards });
        el.querySelector<HTMLInputElement>('[data-testid="review-cards"] input')!.click();
        expect(cards[0].take).toBe(false);
    });
});

describe('HoldBarComponent', () => {
    it('says who holds it, and that unsaved words are still here to copy', () => {
        TestBed.configureTestingModule({ imports: [HoldBarComponent, translocoTestingModule()] });
        const fixture = TestBed.createComponent(HoldBarComponent);
        fixture.componentRef.setInput('hold', { by: 'p', name: 'Priya' });
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.textContent).toContain('Priya has unpublished changes.');
        expect(el.querySelector('[data-testid="hold-reload"]')).toBeNull();
        fixture.componentRef.setInput('lost', true);
        fixture.detectChanges();
        expect(el.textContent).toContain('still on this screen to copy');
        expect(el.querySelector('[data-testid="hold-reload"]')).not.toBeNull();
    });
});

describe('KeptDraftsComponent', () => {
    it('lists the kept drafts, restores one after asking, and nothing while someone else holds it', async () => {
        const ask = vi.fn(async () => true);
        TestBed.configureTestingModule({
            imports: [KeptDraftsComponent, translocoTestingModule()],
            providers: [
                { provide: HoldService, useValue: { kept: vi.fn(async () => [{ id: 'k1', by: 'p', name: 'Priya', why: 'takeover', data: {} }]) } },
                { provide: ConfirmService, useValue: { ask } },
            ],
        });
        const fixture = TestBed.createComponent(KeptDraftsComponent);
        fixture.componentRef.setInput('path', 'arc_blog_drafts/d1');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.textContent).toContain('Priya\'s draft');
        const restored = vi.fn();
        fixture.componentInstance.restore.subscribe(restored);
        el.querySelector('button')!.click();
        await fixture.whenStable();
        expect(ask).toHaveBeenCalled();
        expect(restored).toHaveBeenCalledWith(expect.objectContaining({ id: 'k1' }));
        fixture.componentRef.setInput('locked', true);
        fixture.detectChanges();
        expect(el.querySelector('button')!.disabled).toBe(true);
    });
});

describe('looking only', () => {
    it('asks more strongly when they changed something moments ago', async () => {
        const ask = vi.fn(async (_data: { dialogMessage: unknown }) => true);
        TestBed.configureTestingModule({ imports: [translocoTestingModule()], providers: [{ provide: ConfirmService, useValue: { ask } }] });
        const review = TestBed.inject(ReviewService);
        await review.askTakeOver({ by: 'p', name: '<b>Priya</b>', at: new Date() });
        expect(String(ask.mock.calls[0][0].dialogMessage)).toContain('moments ago');
        // A name is never markup in the question.
        expect(String(ask.mock.calls[0][0].dialogMessage)).not.toContain('<b>');
        await review.askTakeOver({ by: 'p', name: 'Priya', at: new Date(0) });
        expect(String(ask.mock.calls[1][0].dialogMessage)).not.toContain('moments ago');
        await review.askTakeOver({ by: 'p', name: 'Priya', at: new Date(0) }, true);
        expect(String(ask.mock.calls[2][0].dialogMessage)).toContain('copy it first');
    });

    it('a page looked at follows no link and takes no words; a click says why', () => {
        const doc = document.implementation.createHTMLDocument('');
        doc.body.innerHTML = '<a href="/x">x</a>';
        const clicked = vi.fn();
        const end = viewOnlyPage(doc, clicked);
        const event = new Event('click', { bubbles: true, cancelable: true });
        doc.querySelector('a')!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(clicked).toHaveBeenCalledTimes(1);
        end();
        doc.querySelector('a')!.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
        expect(clicked).toHaveBeenCalledTimes(1);
    });
});
