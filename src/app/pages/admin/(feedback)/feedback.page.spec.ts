/**
 * Admin, Feedback: deleting asks with Arc CMS's own dialog and says when it fails (RF4, 4.10 and 4.11).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FeedbackInboxPage from './feedback.page';
import { FeedbackAdminService, type FeedbackItem } from './feedback-admin.service';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../shared/services/notify.service';

const ITEM = { id: 'f1', text: 'The button is hidden', status: 'new' } as unknown as FeedbackItem;

describe('FeedbackInboxPage delete', () => {
    let fixture: ComponentFixture<FeedbackInboxPage>;
    const service = {
        items: signal<FeedbackItem[]>([]), loading: signal(false), hasMore: signal(false), enabled: signal(true),
        load: vi.fn(async () => undefined), loadSetting: vi.fn(async () => undefined),
        setEnabled: vi.fn(async () => undefined), setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    };
    const confirmDialog = { ask: vi.fn(async () => true) };
    const notify = { error: vi.fn(), success: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        await TestBed.configureTestingModule({
            imports: [FeedbackInboxPage, NoopAnimationsModule],
            providers: [
                { provide: FeedbackAdminService, useValue: service },
                { provide: ConfirmService, useValue: confirmDialog },
                { provide: NotifyService, useValue: notify },
                ...headerTestProviders(),
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(FeedbackInboxPage);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    afterEach(() => vi.restoreAllMocks());

    it('asks first with the dialog, never the browser confirm(), and says what goes with it', async () => {
        const nativeConfirm = vi.spyOn(window, 'confirm');
        confirmDialog.ask.mockResolvedValueOnce(false);
        await fixture.componentInstance.remove(ITEM);
        expect(service.remove).not.toHaveBeenCalled();

        await fixture.componentInstance.remove(ITEM);
        expect(service.remove).toHaveBeenCalledWith(ITEM);
        expect(nativeConfirm).not.toHaveBeenCalled();
        expect(confirmDialog.ask).toHaveBeenCalledWith(expect.objectContaining({
            dialogMessage: 'Delete this feedback, with its screenshot and voice note?', panelType: 'warn',
        }));
    });

    it('says so when the delete fails', async () => {
        service.remove.mockRejectedValueOnce(new Error('denied'));
        await fixture.componentInstance.remove(ITEM);
        expect(notify.error).toHaveBeenCalledWith('admin.feedback.delete_failed');
    });

    it('says the list did not load, with Retry, rather than "no feedback"', async () => {
        service.load.mockRejectedValueOnce(new Error('FirebaseError: permission-denied'));
        await fixture.componentInstance.load();
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const alert = root.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('This list did not load');
        expect(root.textContent).not.toContain('permission-denied');
        expect(root.querySelector('.fb-empty')).toBeNull();

        service.load.mockClear();
        (alert.querySelector('button') as HTMLButtonElement).click();
        await fixture.whenStable();
        expect(service.load).toHaveBeenCalledWith('new', false);
        expect(fixture.componentInstance.loadError()).toBe(false);
    });

    it('says so when the switch or a mark does not save', async () => {
        service.setEnabled.mockRejectedValueOnce(new Error('denied'));
        await fixture.componentInstance.toggle(false);
        expect(notify.error).toHaveBeenCalledWith('admin.feedback.toggle_failed');
        expect(fixture.componentInstance.saving()).toBe(false);

        service.setStatus.mockRejectedValueOnce(new Error('denied'));
        await fixture.componentInstance.mark(ITEM, 'done');
        expect(notify.error).toHaveBeenCalledWith('admin.feedback.status_failed');
    });

    it('clears the previous filter when the next one fails, and Retry after a failed Load more asks for the next page', async () => {
        service.items.set([{ id: 'old', status: 'new' } as any]);
        service.hasMore.set(true);
        service.load.mockRejectedValueOnce(new Error('offline'));
        await fixture.componentInstance.load();
        expect(service.items()).toEqual([]);
        expect(service.hasMore()).toBe(false);

        service.items.set([{ id: 'a', status: 'new' } as any]);
        service.load.mockRejectedValueOnce(new Error('offline'));
        await fixture.componentInstance.load(true);
        // The page already shown stays.
        expect(service.items()).toHaveLength(1);
        service.load.mockClear();
        fixture.componentInstance.retry();
        await fixture.whenStable();
        expect(service.load).toHaveBeenCalledWith('new', true);
        service.items.set([]);
    });
});
