import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import type { Change } from '../../../core/editing/compare';
import { changedJustNow, type EditingHold } from '../../../core/editing/hold';
import { ReviewChangesDialogComponent, type ReviewAnswer, type ReviewData } from './review-changes-dialog.component';

/** Opens the review (VE-D80) and asks before work changes hands (VE-D81, VE-D83). */
@Injectable({ providedIn: 'root' })
export class ReviewService {
    private dialog = inject(MatDialog);
    private confirm = inject(ConfirmService);
    private transloco = inject(TranslocoService);

    async open(data: ReviewData): Promise<ReviewAnswer | null> {
        const ref = this.dialog.open<ReviewChangesDialogComponent, ReviewData, ReviewAnswer>(ReviewChangesDialogComponent, {
            width: '760px', maxWidth: '94vw', maxHeight: '90vh', data,
        });
        return (await firstValueFrom(ref.afterClosed(), { defaultValue: undefined })) ?? null;
    }

    /** Take over: asked first, and more strongly when they changed something moments ago, or words here are not saved. */
    askTakeOver(hold: EditingHold, wordsHere = false): Promise<boolean> {
        const name = escapeHtml(hold.name || '?');
        const lost = wordsHere ? ` ${this.transloco.translate('admin.hold.take_over_lost')}` : '';
        return this.confirm.ask({
            titleKey: 'admin.hold.take_over_title',
            dialogMessage: this.transloco.translate(changedJustNow(hold, Date.now()) ? 'admin.hold.take_over_now' : 'admin.hold.take_over_confirm', { name }) + lost,
            btnText: this.transloco.translate('admin.hold.take_over'),
        });
    }

    askDiscard(): Promise<boolean> {
        return this.confirm.ask({
            titleKey: 'admin.hold.discard_title',
            dialogMessage: this.transloco.translate('admin.hold.discard_confirm'),
            btnText: this.transloco.translate('admin.hold.discard'),
            panelType: 'warn',
        });
    }
}

/** Whether what was reviewed is still what is there. */
export function sameChanges(now: readonly Change[], seen: readonly Change[]): boolean {
    return JSON.stringify(now) === JSON.stringify(seen);
}

/**
 * A page that is only looked at (VE-D79): clicks and keys in the frame change
 * nothing and follow no link; a click says why. Returns what ends it.
 */
export function viewOnlyPage(doc: Document, onClick: () => void): () => void {
    const stop = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        // Words selected to copy end in a click that asks for nothing.
        const selected = doc.defaultView?.getSelection?.()?.toString() ?? '';
        if (event.type === 'click' && !selected) onClick();
    };
    const kinds = ['click', 'dblclick', 'submit', 'beforeinput', 'paste', 'drop', 'dragstart'] as const;
    for (const kind of kinds) doc.addEventListener(kind, stop, true);
    return () => {
        for (const kind of kinds) doc.removeEventListener(kind, stop, true);
    };
}
