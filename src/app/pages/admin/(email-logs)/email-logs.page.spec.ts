/**
 * Email logs (RF5): a list that did not load says so, with Retry; a status filter
 * that finds nothing offers to clear it. The drawer's own read never shows as the
 * list's error.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import EmailLogsPage from './email-logs.page';

const proto = EmailLogsPage.prototype as unknown as Record<string, (this: unknown, ...args: unknown[]) => unknown>;

function page() {
    const c: Record<string, any> = {
        emailLogStore: { getAll: vi.fn() },
        statusFilter: signal(''),
        pageSize: signal(10),
        currentPage: signal(0),
        sortField: signal('createdAt'),
        sortOrder: signal('desc'),
        loadError: signal<string | boolean | null>(null),
        awaitingList: false,
        t: (key: string) => key,
    };
    c['fetchData'] = proto['fetchData'].bind(c);
    c['noteListRead'] = proto['noteListRead'].bind(c);
    return c;
}

describe('EmailLogsPage', () => {
    it('shows a failed list read, and clears it when Retry reads again', () => {
        const c = page();
        c['fetchData']();
        expect(c['emailLogStore'].getAll).toHaveBeenCalledTimes(1);
        c['noteListRead'](true, '');
        expect(c['loadError']()).toBeNull();
        c['noteListRead'](false, 'Missing or insufficient permissions.');
        expect(c['loadError']()).toBe(true);

        c['fetchData']();
        expect(c['loadError']()).toBeNull();
        c['noteListRead'](false, '');
        expect(c['loadError']()).toBeNull();
    });

    it('ignores an error from a read that is not the list, such as the drawer opening a log', () => {
        const c = page();
        c['fetchData']();
        c['noteListRead'](false, '');
        c['noteListRead'](false, 'Item not found');
        expect(c['loadError']()).toBeNull();
    });

    it('passes the error, Retry and the filter to the table', () => {
        const html = readFileSync(resolve(__dirname, 'email-logs.html'), 'utf8');
        expect(html).toContain('[error]="loadError()" (retry)="fetchData()"');
        expect(html).toContain(`[filtered]="!!statusFilter()" (clearFilters)="onStatusFilterChange('')"`);
    });

    it('names a status in the admin language, and a missing one as waiting', () => {
        const c = page();
        expect(proto['statusText'].call(c, 'skipped')).toBe('admin.email_logs.status.skipped');
        expect(proto['statusText'].call(c, undefined)).toBe('admin.email_logs.status.pending');
        expect(proto['statusText'].call(c, 'odd')).toBe('Odd');
    });
});
