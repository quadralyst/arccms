/**
 * Drip campaigns (RF5): a list that did not load says so, with Retry, instead of
 * looking empty; statuses read in the admin's language.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import DripsPage from './drips.page';

const proto = DripsPage.prototype as unknown as Record<string, (this: unknown, ...args: unknown[]) => unknown>;

function page() {
    const streams: Subject<unknown[]>[] = [];
    const c: Record<string, any> = {
        service: {
            watchCampaigns: vi.fn(() => {
                const s = new Subject<unknown[]>();
                streams.push(s);
                return s;
            }),
        },
        destroyRef: { onDestroy: () => () => undefined },
        campaigns: signal<unknown[]>([]),
        loading: signal(true),
        loadError: signal<string | boolean | null>(null),
        t: (key: string) => key,
    };
    c['load'] = proto['load'].bind(c);
    return { c, streams };
}

describe('DripsPage', () => {
    it('asks for the failure, and shows it with Retry when the campaigns do not load', () => {
        const { c, streams } = page();
        c['load']();
        expect(c['service'].watchCampaigns).toHaveBeenCalledWith({ surfaceErrors: true });
        streams[0].error(new Error('permission-denied'));
        expect(c['loadError']()).toBe(true);
        expect(c['loading']()).toBe(false);
    });

    it('reads again on Retry, dropping the failed read', () => {
        const { c, streams } = page();
        c['load']();
        streams[0].error(new Error('offline'));
        c['load']();
        expect(c['loadError']()).toBeNull();
        expect(c['loading']()).toBe(true);
        streams[1].next([{ id: 'c1' }]);
        expect(c['campaigns']()).toEqual([{ id: 'c1' }]);
        expect(c['loading']()).toBe(false);
        expect(streams[0].observed).toBe(false);
    });

    it('passes the error and Retry to the table', () => {
        const html = readFileSync(resolve(__dirname, 'drips.page.html'), 'utf8');
        expect(html).toContain('[error]="loadError()" (retry)="load()"');
        expect(html).toContain("'admin.drips.title' | transloco");
    });

    it('names a status in the admin language, and an unknown one as it is', () => {
        const { c } = page();
        expect(proto['statusText'].call(c, 'paused')).toBe('admin.drips.status.paused');
        expect(proto['statusText'].call(c, 'odd')).toBe('Odd');
    });
});
