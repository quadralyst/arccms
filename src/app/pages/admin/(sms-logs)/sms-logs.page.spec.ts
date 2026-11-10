import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SmsLogsComponent from './sms-logs.page';

const proto = SmsLogsComponent.prototype as unknown as Record<string, (this: unknown, ...args: unknown[]) => void>;

function ctx() {
    const c: Record<string, any> = {
        store: { getAll: vi.fn() },
        currentPage: signal(2),
        pageSize: signal(25),
        statusFilter: signal(''),
    };
    c['fetch'] = (proto as any)['fetch'].bind(c);
    c['refresh'] = proto['refresh'].bind(c);
    return c;
}

describe('SmsLogsComponent', () => {
    it('lists newest first', () => {
        const c = ctx();
        c['fetch']();
        expect(c['store'].getAll).toHaveBeenCalledWith(expect.objectContaining({
            orderByField: 'createdAt', orderByDirection: 'desc', whereConditions: [], limitCount: 25,
        }));
    });

    it('filters by status from the first page', () => {
        const c = ctx();
        proto['onStatusFilterChange'].call(c, 'failed');
        expect(c['currentPage']()).toBe(0);
        expect(c['store'].getAll).toHaveBeenCalledWith(expect.objectContaining({
            currentPageNumber: 0,
            whereConditions: [{ field: 'status', operator: '==', value: 'failed' }],
        }));
    });

    it('names a text held back by the daily limit plainly, and offers it as a filter', () => {
        const c: Record<string, any> = { t: (key: string) => key };
        expect((proto as any)['statusLabel'].call(c, 'limited')).toBe('admin.settings.sms.status_limited');
        expect((proto as any)['statusLabel'].call(c, 'failed')).toBe('admin.settings.sms.status_failed');
        const source = readFileSync(resolve(__dirname, 'sms-logs.page.ts'), 'utf8');
        expect(source).toContain('<mat-option value="limited">{{ \'admin.settings.sms.status_limited\' | transloco }}</mat-option>');
    });
});
