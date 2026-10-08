/**
 * Marks the dialog layer as the admin's while an admin or setup wizard page is open,
 * so its dialogs, menus and toasts take the admin's colours (src/admin-theme.css) and
 * the website's and sign-in page's never do: there is one dialog layer for the whole app.
 */
import { DestroyRef, inject } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';

export const ADMIN_OVERLAY_CLASS = 'arc-admin-overlay';

/** Call from the admin's or the wizard's component; the mark goes when it is destroyed. */
export function useAdminOverlay(): void {
    const container = inject(OverlayContainer).getContainerElement();
    container.classList.add(ADMIN_OVERLAY_CLASS);
    inject(DestroyRef).onDestroy(() => container.classList.remove(ADMIN_OVERLAY_CLASS));
}
