import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onWaitlistsCreate } from './onWaitlistsCreate.js';
import { db } from '../init.js';
import { ensureFormList } from '../email-core/contacts.js';

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

vi.mock('firebase-functions/v2', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../email-core/contacts.js', () => ({
    ensureFormList: vi.fn().mockResolvedValue('waitlist-wl-123'),
}));

/**
 * The trigger delegates seeding to `ensureWaitlistTemplates` (U5.5), so these run
 * as trigger+helper integration tests: they still pin the canonical doc ids, the
 * body content and the idempotency skip, which is where the value is.
 */
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
            if (name === 'Waitlists') {
                // U5.5: seeding now runs through ensureWaitlistTemplates, which
                // refuses to write templates for a form that does not exist —
                // requestFormOtp is public, so an unknown id must not create docs.
                return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true }) })) };
            }
            if (name === 'EmailTemplate') {
                // U5.5: presence is decided by a (waitlistId, type) query, not by the
                // canonical doc id — real data holds three id schemes, and checking the
                // id alone duplicates templates for the older forms. `existingIds` is
                // still keyed by canonical id, so the query resolves through it.
                const chain = (filters: Record<string, any>): any => ({
                    where: (field: string, _op: string, value: any) =>
                        chain({ ...filters, [field]: value }),
                    limit: () => ({
                        get: async () => {
                            const id = `${filters['waitlistId']}_${filters['type']}`;
                            return { empty: !existingIds.has(id), docs: [] };
                        },
                    }),
                });
                return {
                    doc: vi.fn((id: string) => ({
                        id,
                        get: vi.fn().mockResolvedValue({ exists: existingIds.has(id) }),
                    })),
                    ...chain({}),
                };
            }
            return { doc: vi.fn() };
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        existingIds = new Set();
        vi.mocked(ensureFormList).mockResolvedValue('waitlist-wl-123');
    });

    it('creates the mirrored audience list eagerly, named after the waitlist', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });

        await (onWaitlistsCreate as any)(event);

        // A brand-new form shows up under Audience → Lists before any signup.
        expect(ensureFormList).toHaveBeenCalledWith('wl-123', 'Test Waitlist');
    });

    it('falls back to a placeholder list name when the waitlist has no name', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });

        await (onWaitlistsCreate as any)({ ...event, data: { data: () => ({}) } });

        expect(ensureFormList).toHaveBeenCalledWith('wl-123', 'Waitlist wl-123');
    });

    it('still seeds templates when list creation fails', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });
        vi.mocked(ensureFormList).mockRejectedValue(new Error('lists unavailable'));

        await (onWaitlistsCreate as any)(event);

        expect(batchSet).toHaveBeenCalledTimes(2);
        expect(batchCommit).toHaveBeenCalledTimes(1);
    });

    it('creates both templates with canonical per-waitlist ids using settings', async () => {
        setup({ exists: true, data: () => ({ senderName: 'Test Sender', senderEmail: 'test@example.com' }) });

        await (onWaitlistsCreate as any)(event);

        expect(mockDb.collection).toHaveBeenCalledWith('Settings');
        expect(batchSet).toHaveBeenCalledTimes(2);

        // Canonical `${waitlistId}_${type}` ids — the scheme the admin templates
        // page writes, so the trigger and the UI can no longer diverge.
        const ids = batchSet.mock.calls.map(([ref]: any[]) => ref.id).sort();
        expect(ids).toEqual(['wl-123_waitlist_verify_otp_email', 'wl-123_waitlist_welcome_email']);

        const welcome = batchSet.mock.calls[0][1];
        expect(welcome).toMatchObject({
            waitlistId: 'wl-123',
            senderName: 'Test Sender',
            senderEmail: 'test@example.com',
            createdBy: 'system',
            isActive: true,
            category: 'marketing',
        });
        // The stored `id` matches the deterministic doc id.
        expect(welcome.id).toBe(batchSet.mock.calls[0][0].id);
        expect(batchCommit).toHaveBeenCalledTimes(1);
    });

    it('marks the OTP template transactional and active', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });

        await (onWaitlistsCreate as any)(event);

        const otp = batchSet.mock.calls.find(([, p]: any[]) => p.type === 'waitlist_verify_otp_email')[1];
        expect(otp).toMatchObject({ category: 'transactional', isActive: true });
    });

    it('is idempotent — skips templates whose deterministic doc already exists', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });
        existingIds = new Set(['wl-123_waitlist_welcome_email', 'wl-123_waitlist_verify_otp_email']);

        await (onWaitlistsCreate as any)(event);

        expect(batchSet).not.toHaveBeenCalled();
        expect(batchCommit).not.toHaveBeenCalled();
    });

    it('creates only the missing template when one already exists', async () => {
        setup({ exists: true, data: () => ({ senderName: 'S', senderEmail: 'e@x.com' }) });
        existingIds = new Set(['wl-123_waitlist_welcome_email']);

        await (onWaitlistsCreate as any)(event);

        expect(batchSet).toHaveBeenCalledTimes(1);
        expect(batchSet.mock.calls[0][0].id).toBe('wl-123_waitlist_verify_otp_email');
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
