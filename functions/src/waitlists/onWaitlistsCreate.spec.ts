import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onWaitlistsCreate } from './onWaitlistsCreate.js'; // Adjust import based on your structure
import { db } from '../init.js';
// import * as firestoreFunctions from 'firebase-functions/v2/firestore';

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

    beforeEach(() => {
        vi.clearAllMocks();

        // Default mocks
        mockDb.batch.mockReturnValue({
            set: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        });
    });

    it('should create templates with settings from Firestore', async () => {
        // Mock settings fetch
        const mockSettingsData = {
            senderName: 'Test Sender',
            senderEmail: 'test@example.com',
        };

        const mockSettingsGet = vi.fn().mockResolvedValue({
            exists: true,
            data: () => mockSettingsData,
        });

        const mockDoc = vi.fn().mockReturnValue({
            id: 'new-doc-id', // For templates
            get: mockSettingsGet // For Settings
        });

        mockDb.collection.mockImplementation((name: any) => {
            if (name === 'Settings') return { doc: mockDoc };
            if (name === 'EmailTemplate') return { doc: mockDoc };
            return { doc: mockDoc };
        });

        const mockEvent = {
            data: {
                data: () => ({ name: 'Test Waitlist' }),
            },
            params: {
                waitlistsId: 'wl-123',
            },
        };

        // Call the function
        await (onWaitlistsCreate as any)(mockEvent);

        // Verify settings were fetched
        expect(mockDb.collection).toHaveBeenCalledWith('Settings');
        expect(mockDoc).toHaveBeenCalledWith('email');

        // Verify batch set was called with correct data
        const batchSet = mockDb.batch().set;
        expect(batchSet).toHaveBeenCalledTimes(2);

        // Check second call (args[1]) for one of the templates to see if it used the settings
        const callArgs = batchSet.mock.calls[0][1];
        expect(callArgs).toMatchObject({
            waitlistId: 'wl-123',
            senderName: 'Test Sender',
            senderEmail: 'test@example.com',
            createdBy: 'system',
        });

        // Check if company name is in the footer of the template
        expect(callArgs.template).not.toContain('© 2025');
    });

    it('should fallback to defaults if settings missing', async () => {
        // Mock settings fetch returning empty
        const mockSettingsGet = vi.fn().mockResolvedValue({
            exists: false,
            data: () => ({}),
        });

        const mockDoc = vi.fn().mockReturnValue({
            id: 'new-doc-id',
            get: mockSettingsGet
        });

        mockDb.collection.mockImplementation((name: any) => {
            if (name === 'Settings') return { doc: mockDoc };
            if (name === 'EmailTemplate') return { doc: mockDoc };
            return { doc: mockDoc };
        });

        const mockEvent = {
            data: {
                data: () => ({ name: 'Test Waitlist' }),
            },
            params: {
                waitlistsId: 'wl-123',
            },
        };

        await (onWaitlistsCreate as any)(mockEvent);

        const batchSet = mockDb.batch().set;
        const callArgs = batchSet.mock.calls[0][1];

        expect(callArgs).toMatchObject({
            senderName: '',
            senderEmail: '',
        });

        const callArgs2 = batchSet.mock.calls[1][1];
        expect(callArgs2.template).toContain('Arc CMS'); // Default company name
    });

    it('OTP template should state 15 minutes validity (not 10)', async () => {
        const mockSettingsGet = vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ senderName: 'Test', senderEmail: 'test@x.com' }),
        });

        const mockDoc = vi.fn().mockReturnValue({
            id: 'new-doc-id',
            get: mockSettingsGet
        });

        mockDb.collection.mockImplementation((name: any) => {
            if (name === 'Settings') return { doc: mockDoc };
            if (name === 'EmailTemplate') return { doc: mockDoc };
            return { doc: mockDoc };
        });

        const mockEvent = {
            data: { data: () => ({ name: 'Test Waitlist' }) },
            params: { waitlistsId: 'wl-123' },
        };

        await (onWaitlistsCreate as any)(mockEvent);

        const batchSet = mockDb.batch().set;
        // Find the OTP template (type: waitlist_verify_otp_email)
        const otpCall = batchSet.mock.calls.find(
            ([, payload]: any[]) => payload?.type === 'waitlist_verify_otp_email'
        );
        expect(otpCall).toBeDefined();
        expect(otpCall[1].template).toContain('15 minutes');
        expect(otpCall[1].template).not.toContain('10 minutes');
    });
});
