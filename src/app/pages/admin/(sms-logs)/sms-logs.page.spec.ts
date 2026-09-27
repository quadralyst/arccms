import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
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
});
