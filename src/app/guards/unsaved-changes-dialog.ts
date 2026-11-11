import { Injector } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, map } from 'rxjs';
import { ConfirmationPopupComponent } from '../../shared/components/confirmation-popup/confirmation-popup.component';

/**
 * "Leave without saving?" with Stay (where focus starts) and Leave. Emits true
 * for Leave; Stay, Escape and a click outside keep the page.
 *
 * In a file of its own so the guard, which the routes load with the first script,
 * loads Angular Material's dialog only when it has a question to ask.
 */
export function askToLeave(injector: Injector): Observable<boolean> {
    const transloco = injector.get(TranslocoService);
    return injector.get(MatDialog).open(ConfirmationPopupComponent, {
        width: '380px',
        maxWidth: '92vw',
        data: {
            titleKey: 'common.leave.title',
            dialogMessage: transloco.translate('common.leave.message'),
            btnText: transloco.translate('common.leave.leave'),
            cancelText: transloco.translate('common.leave.stay'),
            panelType: 'warn',
        },
    }).afterClosed().pipe(map((answer) => answer === true));
}
