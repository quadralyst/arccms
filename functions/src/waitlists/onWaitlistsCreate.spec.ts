import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onWaitlistsCreate } from './onWaitlistsCreate.js';
import { db } from '../init.js';

// Mock dependencies
vi.mock('../init', () => ({
    db: {
        collection: vi.fn(),
        batch: vi.fn(),
    },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: vi.fn((opts, handler) => handler),
}));

describe('onWaitlistsCreate', () => {
    const mockDb = db as any;
    let batchSet: any;
    let batchCommit: any;
    // Doc ids that already exist in EmailTemplate (drives the idempotency skip).
    let existingIds: Set<string>;

    const event = {
        data: { data: () => ({ name: 'Test Waitlist' }) },
        params: { waitlistsId: 'wl-123' },
    };

    function setup(settings: { exists: boolean; data: () => any }): void {
        batchSet = vi.fn();
        batchCommit = vi.fn().mockResolvedValue(undefined);
        mockDb.batch.mockReturnValue({ set: batchSet, commit: batchCommit });

        mockDb.collection.mockImplementation((name: string) => {
            if (name === 'Settings') {
                return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(settings) })) };
            }
            if (name === 'EmailTemplate') {
                return {
                    doc: vi.fn((id: string) => ({
                        id,
                        get: vi.fn().mockResolvedValue({ exists: existingIds.has(id) }),
                    })),
                };
            }
            return { doc: vi.fn() };
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        existingIds = new Set();
    });

    it('creates both templates with deterministic per-waitlist ids using settings', async () => {
        setup({ exists: true, data: () => ({ senderName: 'Test Sender', senderEmail: 'test@example.com' }) });

        await (onWaitlistsCreate as any)(event);

        expect(mockDb.collection).toHaveBeenCalledWith('Settings');
        expect(batchSet).toHaveBeenCalledTimes(2);

        // Deterministic ids scoped by waitlist — re-running upserts the same docs.
        const ids = batchSet.mock.calls.map(([ref]: any[]) => ref.id).sort();
        expect(ids).toEqual(['waitlist_verify_otp_email_wl-123', 'waitlist_welcome_email_wl-123']);

        const welcome = batchSet.mock.calls[0][1];
        expect(welcome).toMatchObject({
            waitlistId: 'wl-123',
            senderName: 'Test Sender',
            senderEmail: 'test@example.com',
            createdBy: 'system',
        });
        // The stored `id` matches the deterministic doc id.
        expect(welcome.id).toBe(batchSet.mock.calls[0][0].id);
        expect(batchCommit).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — skips templates whose deterministic doc already exists', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });
        existingIds = new Set(['waitlist_welcome_email_wl-123', 'waitlist_verify_otp_email_wl-123']);

        await (onWaitlistsCreate as any)(event);

        expect(batchSet).not.toHaveBeenCalled();
        expect(batchCommit).not.toHaveBeenCalled();
    });

    it('creates only the missing template when one already exists', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });
        existingIds = new Set(['waitlist_welcome_email_wl-123']);

        await (onWaitlistsCreate as any)(event);

        expect(batchSet).toHaveBeenCalledTimes(1);
        expect(batchSet.mock.calls[0][0].id).toBe('waitlist_verify_otp_email_wl-123');
        expect(batchCommit).toHaveBeenCalledTimes(1);
    });

    it('falls back to default sender identity if settings missing', async () => {
        setup({ exists: false, data: () => ({}) });

        await (onWaitlistsCreate as any)(event);

        const welcome = batchSet.mock.calls.find(([, p]: any[]) => p.type === 'waitlist_welcome_email')[1];
        expect(welcome).toMatchObject({ senderName: '', senderEmail: '' });

        const otp = batchSet.mock.calls.find(([, p]: any[]) => p.type === 'waitlist_verify_otp_email')[1];
        expect(otp.template).toContain('Arc CMS'); // Default company name in footer
    });

    it('OTP template should state 15 minutes validity (not 10)', async () => {
        setup({ exists: true, data: () => ({ senderName: 'Test', senderEmail: 'test@x.com' }) });

        await (onWaitlistsCreate as any)(event);

        const otpCall = batchSet.mock.calls.find(
            ([, payload]: any[]) => payload?.type === 'waitlist_verify_otp_email',
        );
        expect(otpCall).toBeDefined();
        expect(otpCall[1].template).toContain('15 minutes');
        expect(otpCall[1].template).not.toContain('10 minutes');
    });
});
