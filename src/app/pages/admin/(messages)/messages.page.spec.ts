/**
 * Admin, Messages (specs/site-sections-spec.md, SS5).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MessagesInboxPage from './messages.page';
import { MessagesAdminService, toContactMessage, type ContactMessageItem } from './messages-admin.service';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../shared/services/notify.service';

const ITEM = toContactMessage('m1', { name: 'Asha', email: 'asha@example.com', subject: 'Delivery', message: 'Do you deliver?', page: '/info/contact', status: 'new' });

describe('MessagesInboxPage', () => {
    let fixture: ComponentFixture<MessagesInboxPage>;
    const items = signal<ContactMessageItem[]>([]);
    const service = {
        items, loading: signal(false), hasMore: signal(false),
        load: vi.fn(async () => undefined), setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    };

    const confirmDialog = { ask: vi.fn(async () => true) };
    const notify = { error: vi.fn(), success: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        items.set([ITEM]);
        await TestBed.configureTestingModule({
            imports: [MessagesInboxPage, NoopAnimationsModule],
            providers: [
                { provide: MessagesAdminService, useValue: service },
                { provide: ConfirmService, useValue: confirmDialog },
                { provide: NotifyService, useValue: notify },
                ...headerTestProviders(),
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(MessagesInboxPage);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    afterEach(() => vi.restoreAllMocks());

    const root = () => fixture.nativeElement as HTMLElement;

    it('loads the new messages first and shows each with its reply link', () => {
        expect(service.load).toHaveBeenCalledWith('new', false);
        const message = root().querySelector('[data-testid="message"]')!;
        expect(message.textContent).toContain('Asha');
        expect(message.textContent).toContain('Do you deliver?');
        expect((message.querySelector('[data-testid="reply"]') as HTMLAnchorElement).getAttribute('href')).toMatch(/^mailto:asha@example\.com\?subject=Re%3A%20Delivery/);
    });

    it('switches tabs', () => {
        fixture.componentInstance.setStatus('spam');
        expect(service.load).toHaveBeenLastCalledWith('spam', false);
    });

    it('marks a message done, and deletes only after asking', async () => {
        const done = Array.from(root().querySelectorAll('button')).find((b) => b.textContent?.includes('Mark done'))!;
        done.click();
        expect(service.setStatus).toHaveBeenCalledWith(ITEM, 'done');

        const nativeConfirm = vi.spyOn(window, 'confirm');
        confirmDialog.ask.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await fixture.componentInstance.remove(ITEM);
        expect(service.remove).not.toHaveBeenCalled();
        await fixture.componentInstance.remove(ITEM);
        expect(service.remove).toHaveBeenCalledWith(ITEM);
        // Arc CMS's own dialog, red Delete, never the browser's confirm().
        expect(nativeConfirm).not.toHaveBeenCalled();
        expect(confirmDialog.ask).toHaveBeenCalledWith(expect.objectContaining({
            dialogMessage: 'Delete this message? This cannot be undone.', btnText: 'Delete', panelType: 'warn',
        }));
    });

    it('says so when a delete fails', async () => {
        service.remove.mockRejectedValueOnce(new Error('denied'));
        await fixture.componentInstance.remove(ITEM);
        expect(notify.error).toHaveBeenCalledWith('admin.messages.delete_failed');
    });

    it('links the page it was sent from only when that is a path on this site', () => {
        expect(root().querySelector('.msg-page a')!.getAttribute('href')).toBe('/info/contact');
        items.set([{ ...ITEM, page: '//evil.example/login' }]);
        fixture.detectChanges();
        expect(root().querySelector('.msg-page a')).toBeNull();
        expect(root().querySelector('[data-testid="page-text"]')!.textContent).toBe('//evil.example/login');
    });

    it('says when there is nothing new', () => {
        items.set([]);
        fixture.detectChanges();
        expect(root().querySelector('[data-testid="messages-empty"]')!.textContent).toContain('No new messages.');
    });

    it('says the list did not load, with Retry, rather than "nothing new"', async () => {
        service.load.mockRejectedValueOnce(new Error('FirebaseError: unavailable'));
        await fixture.componentInstance.load();
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const alert = root.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('This list did not load');
        expect(root.textContent).not.toContain('unavailable');
        expect(root.querySelector('[data-testid="messages-empty"]')).toBeNull();

        service.load.mockClear();
        (alert.querySelector('button') as HTMLButtonElement).click();
        await fixture.whenStable();
        expect(service.load).toHaveBeenCalledWith('new', false);
        expect(fixture.componentInstance.loadError()).toBe(false);
    });

    it('says so when moving a message fails', async () => {
        service.setStatus.mockRejectedValueOnce(new Error('denied'));
        await fixture.componentInstance.move({ id: 'm1', status: 'new' } as any, 'done');
        expect(notify.error).toHaveBeenCalledWith('admin.messages.move_failed');
    });

    it('clears the previous filter when the next one fails, and Retry after a failed Load more asks for the next page', async () => {
        items.set([{ id: 'old', status: 'new', message: 'Hi', email: 'a@b.c' } as any]);
        service.hasMore.set(true);
        service.load.mockRejectedValueOnce(new Error('offline'));
        await fixture.componentInstance.load();
        expect(items()).toEqual([]);
        expect(service.hasMore()).toBe(false);

        items.set([{ id: 'a', status: 'new', message: 'Hi', email: 'a@b.c' } as any]);
        service.load.mockRejectedValueOnce(new Error('offline'));
        await fixture.componentInstance.load(true);
        // The page already shown stays.
        expect(items()).toHaveLength(1);
        service.load.mockClear();
        fixture.componentInstance.retry();
        await fixture.whenStable();
        expect(service.load).toHaveBeenCalledWith('new', true);
        items.set([]);
    });
});
