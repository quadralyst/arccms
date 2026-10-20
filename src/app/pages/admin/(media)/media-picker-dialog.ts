import type { MatDialogConfig } from '@angular/material/dialog';
import type { MediaDialogData } from './media.page';

/**
 * How every caller opens the Media Manager as a picker:
 * `dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, ... }))`.
 *
 * The width tracks the window's height (a wide, landscape dialog on a
 * desktop) but never passes the screen's width, so on a phone the dialog is
 * the width of the screen and its tabs, Insert and Cancel stay in reach.
 */
export const MEDIA_PICKER_DIALOG_SIZE = {
    width: '134vh',
    maxWidth: '100vw',
    maxHeight: '90vh',
} as const;

export function mediaPickerDialogConfig(data: MediaDialogData): MatDialogConfig<MediaDialogData> {
    return {
        enterAnimationDuration: '450ms',
        exitAnimationDuration: '300ms',
        ...MEDIA_PICKER_DIALOG_SIZE,
        panelClass: 'common-dialog-box',
        disableClose: true,
        // The heading names the dialog for screen readers too.
        ...(data.title?.trim() ? { ariaLabel: data.title.trim() } : {}),
        data,
    };
}
