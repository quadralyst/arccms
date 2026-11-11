/**
 * The broadcast composer's `#` tags (App audience test, 2026-09-29): with an App
 * users (live) list in the audience, the App audience fields are offered as
 * `##APP.<field>##`, never one that looks like a credential.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sampleAppUsers = vi.hoisted(() => vi.fn());
vi.mock('../../../core/config/arc-functions', () => ({ arcCallable: () => sampleAppUsers }));

import BroadcastsPage from './broadcasts.page';

const proto = BroadcastsPage.prototype as unknown as Record<string, (this: unknown) => Promise<void>>;
const BASE = ['##NAME##', '##EMAIL##', '##UNSUBSCRIBE_LINK##', '##PREFERENCES_LINK##'];

function page(includeListIds: string[]) {
    const c: Record<string, any> = {
        baseTags: BASE,
        appTags: signal<string[] | null>(null),
        loadingAppTags: false,
        broadcastTags: signal<string[]>([...BASE]),
        lists: signal([{ id: 'live', type: 'app', name: 'Live' }, { id: 'news', type: 'manual', name: 'News' }]),
        includeListIds,
        functions: {},
    };
    c['includesAppList'] = (proto as any)['includesAppList'].bind(c);
    return c;
}

describe('BroadcastsPage tags', () => {
    it('adds the App audience fields while a live list is in the audience, without hidden ones', async () => {
        sampleAppUsers.mockResolvedValue({ data: { fields: [{ path: 'name' }, { path: 'password', hidden: true }, { path: 'product.name' }] } });
        const c = page(['live']);
        await proto['refreshTags'].call(c);
        expect(c['broadcastTags']()).toEqual([...BASE, '##APP.name##', '##APP.product.name##']);

        c['includeListIds'] = ['news'];
        await proto['refreshTags'].call(c);
        expect(c['broadcastTags']()).toEqual(BASE);
        expect(sampleAppUsers).toHaveBeenCalledTimes(1);
    });

    it('keeps the usual tags when the fields cannot be read', async () => {
        sampleAppUsers.mockRejectedValue(new Error('offline'));
        const c = page(['live']);
        await proto['refreshTags'].call(c);
        expect(c['broadcastTags']()).toEqual(BASE);
    });
});

describe('BroadcastsPage list (RF5)', () => {
    function list() {
        const streams: Subject<unknown[]>[] = [];
        const c: Record<string, any> = {
            service: { watchRecent: vi.fn(() => { const s = new Subject<unknown[]>(); streams.push(s); return s; }) },
            destroyRef: { onDestroy: () => () => undefined },
            recent: signal<unknown[]>([]),
            loading: signal(true),
            loadError: signal<string | boolean | null>(null),
        };
        return { c, streams };
    }

    it('shows a failed read with Retry, and reads again on Retry', () => {
        const { c, streams } = list();
        (proto as any)['load'].call(c);
        expect(c['service'].watchRecent).toHaveBeenCalledWith(20, { surfaceErrors: true });
        streams[0].error(new Error('offline'));
        expect(c['loadError']()).toBe(true);
        expect(c['loading']()).toBe(false);
        (proto as any)['load'].call(c);
        expect(c['loadError']()).toBeNull();
        streams[1].next([{ id: 'b1' }]);
        expect(c['recent']()).toEqual([{ id: 'b1' }]);
        expect(streams[0].observed).toBe(false);
    });

    it('passes the error and Retry to the table, and names the back button', () => {
        const html = readFileSync(resolve(__dirname, 'broadcasts.page.html'), 'utf8');
        expect(html).toContain('[error]="loadError()" (retry)="load()"');
        expect(html).toContain(`[attr.aria-label]="'admin.broadcasts.back' | transloco"`);
    });

    it('names a status in the admin language', () => {
        const c = { t: (key: string) => key };
        expect((proto as any)['statusText'].call(c, 'completed')).toBe('admin.broadcasts.status.completed');
        expect((proto as any)['statusText'].call(c, 'odd')).toBe('Odd');
    });
});
