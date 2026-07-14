import { describe, it, expect } from 'vitest';
import { statusBadgeClass } from './status-badge';

describe('statusBadgeClass', () => {
    it('maps positive/delivered statuses to is-success', () => {
        for (const s of ['active', 'sent', 'completed', 'delivered', 'subscribed']) {
            expect(statusBadgeClass(s)).toBe(`status-badge is-success`);
        }
    });

    it('maps pending/paused statuses to is-warning', () => {
        for (const s of ['paused', 'scheduled', 'pending', 'processing']) {
            expect(statusBadgeClass(s)).toBe('status-badge is-warning');
        }
    });

    it('maps failed/suppressed statuses to is-danger', () => {
        for (const s of ['failed', 'bounced', 'unsubscribed', 'cancelled', 'canceled']) {
            expect(statusBadgeClass(s)).toBe('status-badge is-danger');
        }
    });

    it('maps queued/draft statuses to is-info and archived to is-dark', () => {
        expect(statusBadgeClass('queued')).toBe('status-badge is-info');
        expect(statusBadgeClass('draft')).toBe('status-badge is-info');
        expect(statusBadgeClass('archived')).toBe('status-badge is-dark');
    });

    it('is case-insensitive', () => {
        expect(statusBadgeClass('ACTIVE')).toBe('status-badge is-success');
        expect(statusBadgeClass('Failed')).toBe('status-badge is-danger');
    });

    it('falls back to is-neutral for unknown/empty/nullish input', () => {
        expect(statusBadgeClass('something-else')).toBe('status-badge is-neutral');
        expect(statusBadgeClass('')).toBe('status-badge is-neutral');
        expect(statusBadgeClass(null)).toBe('status-badge is-neutral');
        expect(statusBadgeClass(undefined)).toBe('status-badge is-neutral');
    });
});
