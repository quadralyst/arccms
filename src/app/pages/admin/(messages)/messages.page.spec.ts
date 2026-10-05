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

const ITEM = toContactMessage('m1', { name: 'Asha', email: 'asha@example.com', subject: 'Delivery', message: 'Do you deliver?', page: '/info/contact', status: 'new' });

describe('MessagesInboxPage', () => {
    let fixture: ComponentFixture<MessagesInboxPage>;
    const items = signal<ContactMessageItem[]>([]);
    const service = {
        items, loading: signal(false), hasMore: signal(false),
        load: vi.fn(async () => undefined), setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        items.set([ITEM]);
        await TestBed.configureTestingModule({
            imports: [MessagesInboxPage, NoopAnimationsModule],
            providers: [{ provide: MessagesAdminService, useValue: service }, ...headerTestProviders()],
        }).compileComponents();
        fixture = TestBed.createComponent(MessagesInboxPage);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    afterEach(() => vi.restoreAllMocks());

    const root = () => fixture.nativeElement as HTMLElement;

    it('loads the new messages first and shows each with its reply link', () => {
        expect(service.load).toHaveBeenCalledWith('new');
        const message = root().querySelector('[data-testid="message"]')!;
        expect(message.textContent).toContain('Asha');
        expect(message.textContent).toContain('Do you deliver?');
        expect((message.querySelector('[data-testid="reply"]') as HTMLAnchorElement).getAttribute('href')).toMatch(/^mailto:asha@example\.com\?subject=Re%3A%20Delivery/);
    });

    it('switches tabs', () => {
        fixture.componentInstance.setStatus('spam');
        expect(service.load).toHaveBeenLastCalledWith('spam');
    });

    it('marks a message done, and deletes only after asking', async () => {
        const done = Array.from(root().querySelectorAll('button')).find((b) => b.textContent?.includes('Mark done'))!;
        done.click();
        expect(service.setStatus).toHaveBeenCalledWith(ITEM, 'done');

        vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        await fixture.componentInstance.remove(ITEM);
        expect(service.remove).not.toHaveBeenCalled();
        await fixture.componentInstance.remove(ITEM);
        expect(service.remove).toHaveBeenCalledWith(ITEM);
    });

    it('says when there is nothing new', () => {
        items.set([]);
        fixture.detectChanges();
        expect(root().querySelector('[data-testid="messages-empty"]')!.textContent).toContain('No new messages.');
    });
});
