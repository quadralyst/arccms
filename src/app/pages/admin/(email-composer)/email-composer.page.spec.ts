/** Composer (RF5): the templates list says when it did not load, with Retry. */
import { describe, expect, it, vi } from 'vitest';
import { Injector, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const streams = vi.hoisted(() => [] as Array<import('rxjs').Subject<unknown[]>>);
vi.mock('@angular/fire/firestore', async (orig) => {
    const { Subject: S } = await import('rxjs');
    return {
        ...(await orig<object>()),
        collection: vi.fn(() => ({})),
        query: vi.fn(() => ({})),
        orderBy: vi.fn(() => ({})),
        collectionData: vi.fn(() => { const s = new S<unknown[]>(); streams.push(s); return s; }),
    };
});

import EmailComposerPage from './email-composer.page';

const proto = EmailComposerPage.prototype as unknown as Record<string, (this: unknown) => void>;

function page() {
    return {
        firestore: {},
        injector: Injector.create({ providers: [] }),
        templates: signal<unknown[]>([]),
        loading: signal(true),
        loadError: signal<string | boolean | null>(null),
    } as Record<string, any>;
}

describe('EmailComposerPage list', () => {
    it('shows a failed read with Retry, and reads again on Retry', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const c = page();
        proto['load'].call(c);
        streams[0].error(new Error('permission-denied'));
        expect(c['loadError']()).toBe(true);
        expect(c['loading']()).toBe(false);

        proto['load'].call(c);
        expect(c['loadError']()).toBeNull();
        streams[1].next([{ id: 't1', type: 'welcome_email' }]);
        expect(c['templates']()).toEqual([{ id: 't1', type: 'welcome_email' }]);
        expect(c['loading']()).toBe(false);
    });

    it('passes the error and Retry to the table', () => {
        const html = readFileSync(resolve(__dirname, 'email-composer.page.html'), 'utf8');
        expect(html).toContain('[error]="loadError()"');
        expect(html).toContain('(retry)="load()"');
    });
});
