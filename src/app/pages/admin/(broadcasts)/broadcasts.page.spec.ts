/**
 * The broadcast composer's `#` tags (App audience test, 2026-09-29): with an App
 * users (live) list in the audience, the App audience fields are offered as
 * `##APP.<field>##`, never one that looks like a credential.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';

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
