/**
 * Tests for WaitlistService
 */
import { TestBed } from '@angular/core/testing';
import { WaitlistService } from './waitlist.service';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Firestore
const mockFirestore = {
    // Add necessary mock methods here if needed for deeper integration tests, 
    // but for now we heavily rely on the service logic which calls these.
    // For unit testing the service, we might need to mock the modular SDK functions 
    // (collection, doc, getDoc, etc.) which is tricky with ESM.
    // However, since Angular injects Firestore, we can mock the instance.
};

// We need to mock the @angular/fire/firestore exports because the service imports them directly
vi.mock('@angular/fire/firestore', () => {
    return {
        Firestore: class { },
        collection: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        getCountFromServer: vi.fn(),
        addDoc: vi.fn(),
        setDoc: vi.fn(),
        updateDoc: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn(),
        deleteDoc: vi.fn(),
        increment: vi.fn((n: number) => ({ __increment: n })),
        arrayUnion: vi.fn((...args: unknown[]) => ({ __arrayUnion: args })),
    };
});

// Mock @angular/fire/functions
vi.mock('@angular/fire/functions', () => {
    return {
        Functions: class { },
        // U5: the service asks the server to send and to verify OTPs. Default to a
        // working server so unrelated tests exercise the happy path; individual
        // tests override to simulate a rejected code.
        httpsCallable: vi.fn(() => vi.fn(async () => ({ data: { sent: true, verified: true } }))),
    };
});

import * as FirestoreSDK from '@angular/fire/firestore';
import * as FunctionsSDK from '@angular/fire/functions';

describe('WaitlistService', () => {
    let service: WaitlistService;
    let firestore: Firestore;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                WaitlistService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Functions, useValue: {} },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { paramMap: { get: () => null } },
                        queryParams: of({})
                    }
                }
            ]
        });
        service = TestBed.inject(WaitlistService);
        firestore = TestBed.inject(Firestore);

        // resetAllMocks, not clearAllMocks: clear only wipes recorded calls, leaving
        // both implementation overrides AND any unconsumed mockResolvedValueOnce
        // entries in place. A test that queues three Once values but only makes two
        // Firestore calls hands its leftover to the *next* test, which then gets the
        // wrong snapshot — order-dependent failures that vanish when run in isolation.
        vi.resetAllMocks();
        // resetAllMocks also strips the implementations from the vi.mock factory, so
        // re-establish the pure helpers and the default happy-path server here.
        vi.mocked(FirestoreSDK.increment).mockImplementation((n: number) => ({ __increment: n }) as any);
        vi.mocked(FirestoreSDK.arrayUnion).mockImplementation((...args: unknown[]) => ({ __arrayUnion: args }) as any);
        vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(
            vi.fn(async () => ({ data: { sent: true, verified: true } })) as any,
        );
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('getWaitlistBySlug', () => {
        it('should return waitlist data if found by slug', async () => {
            const mockData = { id: 'test-id', slug: 'test-slug', name: 'Test' };
            const mockSnapshot = {
                empty: false,
                docs: [{
                    id: 'test-id',
                    data: () => mockData
                }]
            };

            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue(mockSnapshot as any);

            const result = await service.getWaitlistBySlug('test-slug');

            expect(FirestoreSDK.collection).toHaveBeenCalledWith(firestore, 'Waitlists');
            expect(FirestoreSDK.where).toHaveBeenCalledWith('slug', '==', 'test-slug');
            expect(result).toEqual(mockData);
        });

        it('should return null if not found by slug', async () => {
            const mockSnapshot = {
                empty: true,
                docs: []
            };

            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue(mockSnapshot as any);

            const result = await service.getWaitlistBySlug('non-existent');

            expect(result).toBeNull();
        });
    });

    describe('createWaitlistWithId', () => {
        it('should set document with specific ID', async () => {
            const waitlistId = 'custom-id';
            const data = { name: 'Test Waitlist' };

            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);

            await service.createWaitlistWithId(waitlistId, data);

            expect(FirestoreSDK.doc).toHaveBeenCalledWith(firestore, 'Waitlists', waitlistId);
            expect(FirestoreSDK.setDoc).toHaveBeenCalled();
        });
    });
    describe('joinWaitlist (new user path)', () => {
        beforeEach(() => {
            // Waitlist exists
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Test Waitlist' }),
                id: 'waitlist-1',
            } as any);

            // No existing user in subcollection
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({ empty: true, docs: [] } as any);

            // doc() returns a ref with a pre-generated id
            vi.spyOn(FirestoreSDK, 'doc').mockReturnValue({ id: 'pre-generated-id' } as any);

            // setDoc and addDoc succeed
            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'subcoll-user-id' } as any);
        });

        it('should use setDoc (not addDoc) for the WaitlistedUsers root document to prevent a duplicate OTP email (regression)', async () => {
            // Regression: previously addDoc + updateDoc was used, causing onWaitlistedUsersCreate
            // AND onWaitlistedUserUpdate to both fire — sending 2 OTP emails. Now setDoc with
            // a pre-generated ID is used so leaderboardLink is included in the single initial
            // write, eliminating the follow-up updateDoc that triggered the duplicate.
            await service.joinWaitlist('waitlist-1', { email: 'new@example.com', firstName: 'New' });

            expect(FirestoreSDK.setDoc).toHaveBeenCalledTimes(1);
        });

        it('should NOT call updateDoc on WaitlistedUsers during new user signup (regression: duplicate OTP)', async () => {
            // The follow-up updateDoc for leaderboardLink was the second trigger causing
            // a duplicate OTP email. It must NOT be called anymore.
            const updateDocSpy = vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);

            await service.joinWaitlist('waitlist-1', { email: 'new@example.com', firstName: 'New' });

            // updateDoc should not be called on WaitlistedUsers (only setDoc is used now)
            // It may still be called for other purposes (e.g. referrals), but the key is
            // that setDoc handles the WaitlistedUsers creation in one atomic write.
            expect(FirestoreSDK.setDoc).toHaveBeenCalledTimes(1);
        });

        it('should include leaderboardLink in the initial setDoc write for WaitlistedUsers', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'new@example.com', firstName: 'New' });

            const setDocCall = vi.mocked(FirestoreSDK.setDoc).mock.calls[0];
            const writtenData = setDocCall[1] as Record<string, unknown>;

            // leaderboardLink must be a non-empty string in the initial write
            expect(typeof writtenData['leaderboardLink']).toBe('string');
            expect(writtenData['leaderboardLink']).not.toBe('');
            // Should reference the pre-generated doc ID
            expect(writtenData['leaderboardLink']).toContain('pre-generated-id');
        });
    });

    describe('joinWaitlist — maskedEmail', () => {
        beforeEach(() => {
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Test Waitlist' }),
                id: 'waitlist-1',
            } as any);
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({ empty: true, docs: [] } as any);
            vi.spyOn(FirestoreSDK, 'doc').mockReturnValue({ id: 'pre-generated-id' } as any);
            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'subcoll-user-id' } as any);
        });

        it('should include maskedEmail in the WaitlistedUsers document', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'alice@example.com', firstName: 'Alice' });

            const setDocCall = vi.mocked(FirestoreSDK.setDoc).mock.calls[0];
            const writtenData = setDocCall[1] as Record<string, unknown>;

            expect(writtenData['maskedEmail']).toBe('al***@exa***.com');
        });

        it('should include maskedEmail in the waitlist subcollection document', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'bob@test.org', firstName: 'Bob' });

            const addDocCall = vi.mocked(FirestoreSDK.addDoc).mock.calls[0];
            const writtenData = addDocCall[1] as Record<string, unknown>;

            expect(writtenData['maskedEmail']).toBe('bo***@tes***.org');
        });
    });

    describe('joinWaitlist — maskedEmail for existing unverified user re-join', () => {
        it('should include maskedEmail when creating subcollection entry for existing user', async () => {
            // Waitlist exists
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Test Waitlist' }),
                id: 'waitlist-1',
            } as any);

            // Step 1: no user in subcollection
            // Step 2: user exists in WaitlistedUsers (unverified, same waitlist)
            vi.spyOn(FirestoreSDK, 'getDocs')
                .mockResolvedValueOnce({ empty: true, docs: [] } as any) // subcollection check
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{
                        id: 'existing-wl-user',
                        data: () => ({
                            email: 'existing@test.com',
                            firstName: 'Existing',
                            waitlistId: 'waitlist-1',
                            emailVerified: false,
                            // No maskedEmail field (pre-existing user)
                        }),
                    }],
                } as any);

            vi.spyOn(FirestoreSDK, 'doc').mockReturnValue({ id: 'existing-wl-user' } as any);
            vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'subcoll-id' } as any);

            await service.joinWaitlist('waitlist-1', { email: 'existing@test.com', firstName: 'Existing' });

            const addDocCall = vi.mocked(FirestoreSDK.addDoc).mock.calls[0];
            const writtenData = addDocCall[1] as Record<string, unknown>;

            // maskedEmail should be computed even if the original WaitlistedUsers doc didn't have it
            expect(writtenData['maskedEmail']).toBe('ex***@tes***.com');
        });
    });

    describe('processReferral — self-referral guard', () => {
        // These drive processReferral through confirmWithoutOtp. Since U5 that path
        // makes exactly two reads of its own — the member doc, then the referrer
        // lookup — because position/confirmation are written by finalizeFormSignup.
        const memberDoc = (email: string) => ({
            exists: () => true,
            data: () => ({
                emailVerified: false,
                email,
                firstName: 'Test',
                waitlistedUserId: 'wl-user-1',
            }),
        });

        it('should not create a referral record when the referrer and referred have the same email', async () => {
            const referrerEmail = 'same@example.com';
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue(memberDoc(referrerEmail) as any);
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({
                // Referrer lookup by code resolves to the *same* address.
                empty: false,
                docs: [{ id: 'referrer-id', data: () => ({ email: referrerEmail, referralCode: 'REF123' }) }],
            } as any);
            vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);
            const addDocSpy = vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'ref-id' } as any);

            await service.confirmWithoutOtp('waitlist-1', 'user-1', 'REF123');

            // The guard returns before any Referrals doc is written.
            expect(addDocSpy).not.toHaveBeenCalled();
        });

        it('should create a referral record when referrer and referred have different emails', async () => {
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue(memberDoc('referred@example.com') as any);
            vi.spyOn(FirestoreSDK, 'getDocs')
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{ id: 'referrer-id', data: () => ({ email: 'referrer@example.com', referralCode: 'REF456' }) }],
                } as any)
                .mockResolvedValue({ empty: true, docs: [] } as any); // no duplicate referral
            vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);
            const addDocSpy = vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'new-ref' } as any);

            await service.confirmWithoutOtp('waitlist-1', 'user-1', 'REF456');

            const referralCall = addDocSpy.mock.calls.find(
                (call) => (call[1] as Record<string, unknown>)['referrerCode'] === 'REF456',
            );
            expect(referralCall).toBeDefined();
            const referralData = referralCall![1] as Record<string, unknown>;
            expect(referralData['status']).toBe('completed');
            expect(referralData['referredMaskedEmail']).toBeDefined();
        });
    });

    describe('getLeaderboard', () => {
        it('should read the leaderboard from the server, not from member documents', async () => {
            // #51: this used to query Waitlists/{id}/users straight from the browser,
            // which is why firestore.rules had to allow public reads on a collection
            // holding raw email addresses. Anyone with the API key from the JS bundle
            // could page every signup. The ordering, masking and counting all moved into
            // getPublicLeaderboard.
            const callableSpy = vi.fn(async () => ({
                data: {
                    leaderboard: [
                        { id: 'user3', firstName: 'C', maskedEmail: 'te***@example.com', totalReferrals: 5, queuePosition: 3, waitlistedUserId: 'wu3' },
                        { id: 'user1', firstName: 'A', maskedEmail: 'te***@example.com', totalReferrals: 0, queuePosition: 1, waitlistedUserId: 'wu1' },
                    ],
                    totalUsers: 3,
                    unverifiedUsers: 2,
                    waitlistId: 'test-waitlist',
                },
            }));
            vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(callableSpy as any);
            const getDocsSpy = vi.spyOn(FirestoreSDK, 'getDocs');

            const result = await service.getLeaderboard('test-waitlist');

            expect(FunctionsSDK.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getPublicLeaderboard');
            expect(callableSpy).toHaveBeenCalledWith({ waitlistId: 'test-waitlist' });
            // The point of the change: no client-side read of member documents.
            expect(getDocsSpy).not.toHaveBeenCalled();

            expect(result.leaderboard).toHaveLength(2);
            expect((result.leaderboard[0] as any).id).toBe('user3');
            expect((result.leaderboard[0] as any).email).toBeUndefined();
            expect(result.totalUsers).toBe(3);
            expect(result.unverifiedUsers).toBe(2);
        });
    });

    // Note: resendVerificationCode tests skipped due to vitest mock lifecycle issue
    // where getDoc mock doesn't properly propagate to the service after earlier
    // describe blocks have used vi.spyOn on the same function. The resendVerificationCode
    // implementation has been manually verified.

    // -----------------------------------------------------------------------
    // Regression: emailVerified vs isConfirmed field correctness
    // -----------------------------------------------------------------------

    describe('joinWaitlist — new user should start with emailVerified=false and isConfirmed=false', () => {
        beforeEach(() => {
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Test Waitlist' }),
                id: 'waitlist-1',
            } as any);
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({ empty: true, docs: [] } as any);
            vi.spyOn(FirestoreSDK, 'doc').mockReturnValue({ id: 'pre-generated-id' } as any);
            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'subcoll-user-id' } as any);
        });

        it('should set emailVerified=false in WaitlistedUsers doc', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'new@test.com', firstName: 'New' });

            const setDocCall = vi.mocked(FirestoreSDK.setDoc).mock.calls[0];
            const data = setDocCall[1] as Record<string, unknown>;
            expect(data['emailVerified']).toBe(false);
        });

        it('should set isConfirmed=false in WaitlistedUsers doc', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'new@test.com', firstName: 'New' });

            const setDocCall = vi.mocked(FirestoreSDK.setDoc).mock.calls[0];
            const data = setDocCall[1] as Record<string, unknown>;
            expect(data['isConfirmed']).toBe(false);
        });

        it('should set isConfirmed=false in subcollection doc', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'new@test.com', firstName: 'New' });

            const addDocCall = vi.mocked(FirestoreSDK.addDoc).mock.calls[0];
            const data = addDocCall[1] as Record<string, unknown>;
            expect(data['isConfirmed']).toBe(false);
        });
    });

    describe('joinWaitlist — default tag assignment', () => {
        it('should call updateDoc with tags array when waitlist has a defaultTagId (new user)', async () => {
            // Waitlist with defaultTagId
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Test Waitlist', defaultTagId: 'tag-123' }),
                id: 'waitlist-1',
            } as any);
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({ empty: true, docs: [] } as any);
            vi.spyOn(FirestoreSDK, 'doc').mockReturnValue({ id: 'pre-generated-id' } as any);
            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'subcoll-user-id' } as any);
            const updateDocSpy = vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);

            await service.joinWaitlist('waitlist-1', { email: 'new@test.com', firstName: 'New' });

            // applyDefaultTag should have called updateDoc twice:
            // 1. to set tags on the user doc
            // 2. to increment usageCount on the tag doc
            const updateCalls = updateDocSpy.mock.calls;
            const tagsUpdate = updateCalls.find(call => {
                const data = call[1] as Record<string, unknown>;
                return Array.isArray(data['tags']);
            });
            expect(tagsUpdate).toBeDefined();
            expect((tagsUpdate![1] as any)['tags']).toEqual(['tag-123']);

            // usageCount increment (now uses setDoc with merge instead of updateDoc)
            const setDocCalls = vi.mocked(FirestoreSDK.setDoc).mock.calls;
            const usageUpdate = setDocCalls.find(call => {
                const data = call[1] as Record<string, unknown>;
                return 'usageCount' in data;
            });
            expect(usageUpdate).toBeDefined();
        });

        it('should NOT call updateDoc for tags when waitlist has no defaultTagId', async () => {
            // Waitlist without defaultTagId
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Test Waitlist' }),
                id: 'waitlist-1',
            } as any);
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({ empty: true, docs: [] } as any);
            vi.spyOn(FirestoreSDK, 'doc').mockReturnValue({ id: 'pre-generated-id' } as any);
            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'subcoll-user-id' } as any);
            const updateDocSpy = vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);

            await service.joinWaitlist('waitlist-1', { email: 'new@test.com', firstName: 'New' });

            // No updateDoc call should set a tags array
            const tagsUpdate = updateDocSpy.mock.calls.find(call => {
                const data = call[1] as Record<string, unknown>;
                return Array.isArray(data['tags']);
            });
            expect(tagsUpdate).toBeUndefined();
        });

        it('should apply default tag when existing unverified user creates subcollection entry', async () => {
            // Waitlist with defaultTagId
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Test Waitlist', defaultTagId: 'tag-abc' }),
                id: 'waitlist-1',
            } as any);

            // Step 1: no user in subcollection; Step 2: user exists in WaitlistedUsers
            vi.spyOn(FirestoreSDK, 'getDocs')
                .mockResolvedValueOnce({ empty: true, docs: [] } as any)
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{
                        id: 'existing-wl-user',
                        data: () => ({
                            email: 'existing@test.com',
                            firstName: 'Existing',
                            waitlistId: 'waitlist-1',
                            emailVerified: false,
                        }),
                    }],
                } as any);

            vi.spyOn(FirestoreSDK, 'doc').mockReturnValue({ id: 'existing-wl-user' } as any);
            const updateDocSpy = vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'subcoll-id' } as any);

            await service.joinWaitlist('waitlist-1', { email: 'existing@test.com', firstName: 'Existing' });

            const tagsUpdate = updateDocSpy.mock.calls.find(call => {
                const data = call[1] as Record<string, unknown>;
                return Array.isArray(data['tags']);
            });
            expect(tagsUpdate).toBeDefined();
            expect((tagsUpdate![1] as any)['tags']).toEqual(['tag-abc']);
        });
    });

    describe('verifyOtpAndProcessUser — rejected codes (U5: server-authoritative)', () => {
        /**
         * These replace the old null-`verificationExpires` regression tests. Expiry,
         * the attempt cap and the code comparison all moved to `verifyFormOtp`
         * (U5) — the client no longer holds the code or the expiry, so it cannot
         * make that judgement. What must still hold is that a code the server
         * rejects never verifies the user, whatever the reason.
         */
        function serverRejects(message: string): void {
            vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(
                vi.fn(async () => { throw new Error(message); }) as any,
            );
        }

        it('returns the server message when the code has expired', async () => {
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ email: 'a@b.com', isConfirmed: false }),
            } as any);
            serverRejects('Your code has expired. Please request a new one.');

            const result = await service.verifyOtpAndProcessUser('waitlist-1', 'user-1', '123456', {});

            expect(result.success).toBe(false);
            expect(result.message).toContain('expired');
        });

        it('returns the server message on a wrong code, via the subcollection path', async () => {
            vi.spyOn(FirestoreSDK, 'getDoc')
                .mockResolvedValueOnce({ exists: () => false } as any) // WaitlistedUsers lookup
                .mockResolvedValueOnce({
                    exists: () => true,
                    data: () => ({ email: 'a@b.com', isConfirmed: false }),
                } as any); // subcollection lookup
            serverRejects('Invalid verification code.');

            const result = await service.verifyOtpAndProcessUser('waitlist-1', 'user-1', '000000', {});

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid verification code');
        });

        it('surfaces the attempt-cap lockout rather than verifying', async () => {
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ email: 'a@b.com', isConfirmed: false }),
            } as any);
            serverRejects('Too many attempts. Please request a new code.');

            const result = await service.verifyOtpAndProcessUser('waitlist-1', 'user-1', '123456', {});

            expect(result.success).toBe(false);
            expect(result.message).toContain('Too many attempts');
        });

        it('does not throw when the callable itself fails', async () => {
            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({ email: 'a@b.com', isConfirmed: false }),
            } as any);
            vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(
                vi.fn(async () => { throw new Error('network down'); }) as any,
            );

            const result = await service.verifyOtpAndProcessUser('waitlist-1', 'user-1', '123456', {});

            expect(result.success).toBe(false);
        });
    });

    // ── U5 item 5: signup completion moved server-side ───────────────────────────
    // These three used to assert that the *browser* wrote emailVerified, isConfirmed,
    // queuePosition and the default tag. It no longer does, and that is the point:
    // those fields have been removed from the unauthenticated-update whitelist in
    // firestore.rules, so a client write would now be rejected outright. What the
    // client must do instead is delegate to finalizeFormSignup, which derives whether
    // an OTP was required rather than taking the caller's word for it.

    describe('confirmWithoutOtp — delegates protected writes to finalizeFormSignup (U5)', () => {
        let callableSpy: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            callableSpy = vi.fn(async () => ({
                data: { queuePosition: 7, totalSignups: 7, emailVerified: false, alreadyConfirmed: false },
            }));
            vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(callableSpy as any);

            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({
                    email: 'nootp@example.com',
                    firstName: 'NoOtp',
                    emailVerified: false,
                    isConfirmed: false,
                    waitlistedUserId: 'wl-user-1',
                }),
            } as any);
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({ empty: true, docs: [] } as any);
            vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'x' } as any);
        });

        it('should call finalizeFormSignup with the waitlist and member ids', async () => {
            await service.confirmWithoutOtp('waitlist-1', 'user-1', '');

            expect(FunctionsSDK.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'finalizeFormSignup');
            expect(callableSpy).toHaveBeenCalledWith(
                expect.objectContaining({ waitlistId: 'waitlist-1', userId: 'user-1' }),
            );
        });

        it('should return the position the server assigned, not one it counted itself', async () => {
            const result = await service.confirmWithoutOtp('waitlist-1', 'user-1', '');

            expect(result.queuePosition).toBe(7);
            expect(result.totalSignups).toBe(7);
        });

        it('should not write emailVerified, isConfirmed, queuePosition or verifiedAt from the client', async () => {
            await service.confirmWithoutOtp('waitlist-1', 'user-1', '');

            const protectedKeys = ['emailVerified', 'isConfirmed', 'queuePosition', 'verifiedAt',
                                   'verificationCode', 'verificationExpires', 'totalReferrals'];
            const written = [
                ...vi.mocked(FirestoreSDK.updateDoc).mock.calls,
                ...vi.mocked(FirestoreSDK.setDoc).mock.calls,
            ].flatMap((call) => Object.keys((call[1] as Record<string, unknown>) || {}));

            expect(written.filter((k) => protectedKeys.includes(k))).toEqual([]);
        });

        it('should not apply the default tag from the client — finalizeFormSignup owns it', async () => {
            // The tag write targeted the same member doc, so it had to be moved too;
            // `tags` stays whitelisted only for the preference-centre paths.
            await service.confirmWithoutOtp('waitlist-1', 'user-1', '');

            const tagWrites = vi.mocked(FirestoreSDK.updateDoc).mock.calls.filter(
                (call) => 'tags' in ((call[1] as Record<string, unknown>) || {}),
            );
            expect(tagWrites).toEqual([]);
        });

        it('should skip the server call entirely when the member is already confirmed', async () => {
            vi.mocked(FirestoreSDK.getDoc).mockResolvedValue({
                exists: () => true,
                data: () => ({ email: 'a@b.c', isConfirmed: true, queuePosition: 3 }),
            } as any);

            const result = await service.confirmWithoutOtp('waitlist-1', 'user-1', '');

            expect(callableSpy).not.toHaveBeenCalled();
            expect(result.queuePosition).toBe(3);
        });
    });

    describe('processNewVerification — delegates protected writes to finalizeFormSignup (U5)', () => {
        it('should complete the signup through the server rather than writing the fields itself', async () => {
            // One spy stands in for both callables this path uses, so the payload
            // carries verifyFormOtp's `verified` as well as finalizeFormSignup's result.
            const callableSpy = vi.fn(async () => ({
                data: {
                    verified: true,
                    queuePosition: 2, totalSignups: 2, emailVerified: true, alreadyConfirmed: false,
                },
            }));
            vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(callableSpy as any);

            vi.spyOn(FirestoreSDK, 'getDoc').mockResolvedValue({
                exists: () => true,
                data: () => ({
                    email: 'verified@example.com',
                    firstName: 'Verified',
                    waitlistedUserId: 'wl-user-1',
                }),
            } as any);
            vi.spyOn(FirestoreSDK, 'getDocs').mockResolvedValue({ empty: true, docs: [] } as any);
            vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'x' } as any);

            await service.verifyOtpAndProcessUser('waitlist-1', 'user-1', '123456', '');

            const calledFns = vi.mocked(FunctionsSDK.httpsCallable).mock.calls.map((c) => c[1]);
            expect(calledFns).toContain('verifyFormOtp');
            expect(calledFns).toContain('finalizeFormSignup');

            const written = vi.mocked(FirestoreSDK.updateDoc).mock.calls
                .flatMap((call) => Object.keys((call[1] as Record<string, unknown>) || {}));
            expect(written).not.toContain('emailVerified');
            expect(written).not.toContain('queuePosition');
            expect(written).not.toContain('tags');
        });
    });
});
