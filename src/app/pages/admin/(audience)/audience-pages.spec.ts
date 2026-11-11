/**
 * The audience pages (Lists, a list's page, Contacts, Fields, Tags) tell an
 * admin when their list did not load, with Retry, instead of showing the
 * "nothing yet" state (RF5 5.1); Contacts says "Nothing matches" while a search
 * or filter is on, with Clear filters; and toasts and statuses go through the
 * translation files (5.3).
 */
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { Type } from '@angular/core';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TranslocoService } from '@jsverse/transloco';
import { Functions } from '@angular/fire/functions';

vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn(() => async () => ({ data: { matched: 0, withEmail: 0, subscribed: 0, scanned: 0, truncated: false, rows: [] } })),
}));

import { headerTestProviders } from '../../../../test/header-test-providers';
import { AudienceService } from './audience.service';
import { audienceStatusText } from './audience-status-text';
import { NotifyService } from '../../../../shared/services/notify.service';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { BroadcastService } from '../(broadcasts)/broadcast.service';
import { DripService } from '../(drips)/drip.service';
import ListsPageComponent from '../(lists)/lists.page';
import ContactsPageComponent from '../(contacts)/contacts.page';
import ContactFieldsPageComponent from '../(contact-fields)/contact-fields.page';
import ContactTagsPageComponent from '../(contact-tags)/contact-tags.page';
import ListHubPageComponent from '../(list-hub)/list-hub.page';

const state = { fail: false, listFail: false, rows: [] as unknown[] };

/** A live read: calls the page's error handler when `state.fail`, as the real service does. */
const read = vi.fn((...args: unknown[]) => {
    const onError = args.find((a) => typeof a === 'function') as ((e: unknown) => void) | undefined;
    if (state.fail) {
        onError?.(new Error('permission-denied'));
        return of([]);
    }
    return of(state.rows);
});

const audience = {
    getLists: read,
    getTags: read,
    getFields: read,
    getContacts: read,
    getContactsInList: read,
    getList: vi.fn((_id: string, onError?: (e: unknown) => void) => {
        if (state.listFail) {
            onError?.(new Error('unavailable'));
            return of(null);
        }
        return of({ id: 'l1', name: 'Newsletter', type: 'manual' });
    }),
    deleteList: vi.fn().mockResolvedValue(undefined),
    deleteTag: vi.fn().mockResolvedValue(undefined),
    backfillFormLists: vi.fn().mockRejectedValue(new Error('internal: boom')),
};
const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), raw: vi.fn() };
const confirm = { ask: vi.fn().mockResolvedValue(true) };

async function render<T>(page: Type<T>) {
    await TestBed.configureTestingModule({
        imports: [page, NoopAnimationsModule],
        providers: [
            ...headerTestProviders(),
            provideRouter([]),
            { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {}, paramMap: convertToParamMap({ listId: 'l1' }) } } },
            { provide: AudienceService, useValue: audience },
            { provide: NotifyService, useValue: notify },
            { provide: ConfirmService, useValue: confirm },
            { provide: Functions, useValue: {} },
            { provide: BroadcastService, useValue: { watchRecent: () => of([]) } },
            { provide: DripService, useValue: { watchCampaigns: () => of([]) } },
        ],
    }).compileComponents();
    const fixture = TestBed.createComponent(page);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
}

const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

describe('audience pages: a list that did not load', () => {
    beforeEach(() => {
        state.fail = true;
        state.rows = [];
        read.mockClear();
        Object.values(notify).forEach((f) => f.mockClear());
        confirm.ask.mockClear();
    });

    const pages: Array<[string, Type<unknown>]> = [
        ['Lists', ListsPageComponent],
        ['Contacts', ContactsPageComponent],
        ['Fields', ContactFieldsPageComponent],
        ['Tags', ContactTagsPageComponent],
        ['a list\'s members', ListHubPageComponent],
    ];

    for (const [name, page] of pages) {
        it(`${name}: says so with Retry, and Retry reads again`, async () => {
            const fixture = await render(page);
            const el = fixture.nativeElement as HTMLElement;
            expect(text(el)).toContain('This list did not load');
            const retry = el.querySelector<HTMLButtonElement>('.retry-btn');
            expect(retry).not.toBeNull();

            const before = read.mock.calls.length;
            state.fail = false;
            retry!.click();
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(read.mock.calls.length).toBeGreaterThan(before);
            expect(text(el)).not.toContain('This list did not load');
        });
    }
});

describe("a list's Broadcasts and Sequence tabs", () => {
    beforeEach(() => { state.fail = false; state.rows = []; });

    it('show their own load error, and Retry clears it once a read works', async () => {
        const fixture = await render(ListHubPageComponent);
        const page = fixture.componentInstance as ListHubPageComponent;
        const broadcasts = TestBed.inject(BroadcastService) as unknown as { watchRecent: unknown };
        const drips = TestBed.inject(DripService) as unknown as { watchCampaigns: unknown };
        let fail = true;
        broadcasts.watchRecent = vi.fn((_max: number, opts: { onError?: (e: unknown) => void }) => {
            if (fail) opts.onError?.(new Error('permission-denied'));
            return of([]);
        });
        drips.watchCampaigns = vi.fn((opts: { onError?: (e: unknown) => void }) => {
            if (fail) opts.onError?.(new Error('permission-denied'));
            return of([]);
        });

        page.loadBroadcasts();
        page.loadCampaigns();
        expect(page.broadcastsError()).toBe(true);
        expect(page.campaignsError()).toBe(true);

        fail = false;
        page.loadBroadcasts();
        page.loadCampaigns();
        expect(page.broadcastsError()).toBe(false);
        expect(page.campaignsError()).toBe(false);
    });
});

describe('a list\'s page', () => {
    beforeEach(() => {
        state.fail = false;
        state.listFail = false;
        state.rows = [];
    });

    it('a failed read of the list says it did not load, with Retry, not "List not found"', async () => {
        state.listFail = true;
        const fixture = await render(ListHubPageComponent);
        const el = fixture.nativeElement as HTMLElement;
        expect(text(el)).toContain('This list did not load');
        expect(text(el)).not.toContain('List not found');

        state.listFail = false;
        el.querySelector<HTMLButtonElement>('.list-retry-btn')!.click();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(text(el)).not.toContain('This list did not load');
        expect(text(el)).toContain('Newsletter');
    });

    it('uses the Broadcasts page words for a send\'s status, and escapes status text', async () => {
        const fixture = await render(ListHubPageComponent);
        const page = fixture.componentInstance as ListHubPageComponent;
        const status = page.broadcastColumns.find((c) => c.key === 'status')!.transformFn!;
        expect(status({ status: 'completed' })).toContain('>Sent<');
        expect(status({ status: 'processing' })).toContain('>Sending<');
        expect(status({ status: '<img src=x>' })).toContain('&lt;img src=x&gt;');
    });
});

describe('Contacts: nothing matches', () => {
    beforeEach(() => {
        state.fail = false;
        state.rows = [{ id: 'h1', email: 'ann@example.com', name: 'Ann', consent: { marketing: 'subscribed' } }];
    });

    it('says "Nothing matches" for a search with no rows, and Clear filters brings them back', async () => {
        const fixture = await render(ContactsPageComponent);
        const page = fixture.componentInstance as ContactsPageComponent;
        page.onSearch('zzz');
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(text(el)).toContain('Nothing matches');

        el.querySelector<HTMLButtonElement>('.clear-filters-btn')!.click();
        fixture.detectChanges();
        expect(page.search()).toBe('');
        expect(text(el)).toContain('ann@example.com');
    });

    it('shows the consent status in words from the translation files', async () => {
        const fixture = await render(ContactsPageComponent);
        expect(text(fixture.nativeElement)).toContain('subscribed');
    });
});

describe('audience pages: toasts and dialogs', () => {
    beforeEach(() => {
        state.fail = false;
        state.rows = [];
        Object.values(notify).forEach((f) => f.mockClear());
        confirm.ask.mockClear();
    });

    it('Lists: a failed sync shows a plain sentence, not the server text', async () => {
        const fixture = await render(ListsPageComponent);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await (fixture.componentInstance as ListsPageComponent).syncFormLists();
        expect(notify.error).toHaveBeenCalledWith('admin.audience.lists.sync_failed');
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('Lists: delete asks first, escaping the name, and says when it is done', async () => {
        const fixture = await render(ListsPageComponent);
        await (fixture.componentInstance as ListsPageComponent).confirmDelete({ id: 'l2', name: '<b>VIP</b>', type: 'manual' } as never);
        const asked = confirm.ask.mock.calls[0][0];
        expect(asked.dialogMessage).toContain('&lt;b&gt;VIP&lt;/b&gt;');
        expect(asked.btnText).toBe('Delete');
        expect(audience.deleteList).toHaveBeenCalledWith('l2');
        expect(notify.success).toHaveBeenCalledWith('admin.audience.lists.deleted');
    });

    it('Tags: the delete question counts the contacts that lose the tag', async () => {
        const fixture = await render(ContactTagsPageComponent);
        await (fixture.componentInstance as ContactTagsPageComponent).confirmDelete({ id: 'vip', label: 'VIP', usageCount: 3 } as never);
        expect(confirm.ask.mock.calls[0][0].dialogMessage).toContain('3 contacts have it');
        expect(notify.success).toHaveBeenCalledWith('admin.audience.tags.deleted');
    });
});

describe('audienceStatusText', () => {
    it('translates the statuses it knows and leaves others as stored', () => {
        TestBed.configureTestingModule({});
        const transloco = TestBed.inject(TranslocoService);
        transloco.setActiveLang('hi');
        expect(audienceStatusText(transloco, 'subscribed')).toBe('सदस्यता ली');
        expect(audienceStatusText(transloco, 'something-new')).toBe('something-new');
        transloco.setActiveLang('en');
        expect(audienceStatusText(transloco, 'sent')).toBe('sent');
    });
});
