import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmationDialogData, ConfirmationPopupComponent } from './confirmation-popup.component';

/**
 * Ask a yes or no question with Arc CMS's own dialog, never the browser's
 * `confirm()`: it is translated, styled, starts on Cancel, and a test can
 * answer it.
 *
 *   if (!(await this.confirm.ask({
 *       titleKey: 'common.dialog.delete',
 *       dialogMessage: this.transloco.translate('admin.products.delete_confirm', { name: escapeHtml(p.name) }),
 *       btnText: this.transloco.translate('common.actions.delete'),
 *       panelType: 'warn',
 *   }))) return;
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
    private dialog = inject(MatDialog);

    /** True when the person pressed the confirm button; false on Cancel, Escape or a click outside. */
    async ask(data: ConfirmationDialogData, width = '380px'): Promise<boolean> {
        const ref = this.dialog.open(ConfirmationPopupComponent, { width, maxWidth: '92vw', data });
        return (await firstValueFrom(ref.afterClosed(), { defaultValue: undefined })) === true;
    }
}
