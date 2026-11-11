/**
 * Analytics settings: Disconnect asks with Arc CMS's own dialog (RF4, 4.10).
 *
 * The page is large; the method is run on a stand-in for the page so only the
 * question and what follows it are under test.
 */
import { describe, it, expect, vi } from 'vitest';
import AnalyticsSettingPageComponent from './analytics-setting.page';

function page(answer: boolean) {
    return {
        confirmDialog: { ask: vi.fn(async () => answer) },
        transloco: { translate: vi.fn((key: string) => key) },
        googleOAuthService: { disconnectAnalytics: vi.fn(async () => undefined) },
        notify: { success: vi.fn(), error: vi.fn() },
        isDisconnecting: { set: vi.fn() },
    };
}

const onDisconnect = (self: ReturnType<typeof page>) =>
    (AnalyticsSettingPageComponent.prototype as any).onDisconnect.call(self) as Promise<void>;

describe('AnalyticsSettingPageComponent disconnect', () => {
    it('asks with the dialog, never the browser confirm(), and disconnects on yes', async () => {
        const nativeConfirm = vi.spyOn(window, 'confirm');
        const self = page(true);
        await onDisconnect(self);
        expect(nativeConfirm).not.toHaveBeenCalled();
        expect(self.confirmDialog.ask).toHaveBeenCalledWith(expect.objectContaining({
            titleKey: 'admin.settings.analytics.disconnect',
            dialogMessage: 'admin.settings.analytics.disconnect_confirm',
            panelType: 'warn',
        }));
        expect(self.googleOAuthService.disconnectAnalytics).toHaveBeenCalled();
        expect(self.notify.success).toHaveBeenCalledWith('admin.settings.analytics.disconnected');
        nativeConfirm.mockRestore();
    });

    it('keeps the connection on Cancel', async () => {
        const self = page(false);
        await onDisconnect(self);
        expect(self.googleOAuthService.disconnectAnalytics).not.toHaveBeenCalled();
    });
});
