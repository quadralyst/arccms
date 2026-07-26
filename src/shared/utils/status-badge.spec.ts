import { describe, it, expect } from 'vitest';
import { statusBadgeClass, statusBadgeLabel } from './status-badge';

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

    it('gives every email-log delivery status a distinct tone', () => {
        // These were all falling through to is-neutral, so a failed send and a
        // deliberately-gated one looked identical in the logs table.
        expect(statusBadgeClass('success')).toBe('status-badge is-success');
        expect(statusBadgeClass('retrying')).toBe('status-badge is-warning');
        expect(statusBadgeClass('deferred')).toBe('status-badge is-warning');
        expect(statusBadgeClass('suppressed')).toBe('status-badge is-danger');
        // Withheld by a gate — neither a success nor a delivery failure.
        expect(statusBadgeClass('skipped')).toBe('status-badge is-neutral');
    });
});

describe('statusBadgeLabel', () => {
    it('capitalises a raw status without renaming it', () => {
        expect(statusBadgeLabel('skipped')).toBe('Skipped');
        expect(statusBadgeLabel('sent')).toBe('Sent');
        expect(statusBadgeLabel('SUPPRESSED')).toBe('Suppressed');
    });

    it('reports unknown rather than inventing a state', () => {
        expect(statusBadgeLabel('')).toBe('Unknown');
        expect(statusBadgeLabel(null)).toBe('Unknown');
        expect(statusBadgeLabel(undefined)).toBe('Unknown');
    });
});
