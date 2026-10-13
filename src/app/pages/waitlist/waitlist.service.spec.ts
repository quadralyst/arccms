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

/** Default response per callable, so a test only overrides the one it cares about. */
function defaultCallableData(name: string): Record<string, unknown> {
    switch (name) {
        case 'joinForm':
            return { memberId: 'member-1' };
        case 'finalizeFormSignup':
            return { totalSignups: 1, emailVerified: true, alreadyConfirmed: false };
        default:
            // requestFormOtp / verifyFormOtp
            return { sent: true, status: 'pending', verified: true };
    }
}

/**
 * Override selected callables while every other one keeps its default. Returns the map
 * of spies so a test can assert on the call it cares about.
 *
 * Needed because the flow spans several callables: a single blanket spy could not
 * reject the code check while letting the confirmation through.
 */
function mockCallables(overrides: Record<string, (data?: any) => any> = {}) {
    const spies: Record<string, ReturnType<typeof vi.fn>> = {};
    vi.mocked(FunctionsSDK.httpsCallable).mockImplementation(((_fns: unknown, deployedName: string) => {
        // arcCallable() adds the arccms- group prefix; the tests speak in plain names.
        const name = deployedName.replace(/^arccms-/, '');
        if (!spies[name]) {
            spies[name] = vi.fn(async (data?: any) => ({
                data: overrides[name] ? overrides[name](data) : defaultCallableData(name),
            }));
        }
        return spies[name];
    }) as any);
    return spies;
}

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
        // The default mock dispatches by function name, so each callable answers
        // for itself.
        vi.mocked(FunctionsSDK.httpsCallable).mockImplementation(
            ((_fns: unknown, name: string) => vi.fn(async () => ({ data: defaultCallableData(name.replace(/^arccms-/, '')) }))) as any,
        );
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('joinWaitlist — server-authoritative find-or-create (#51)', () => {
        // The browser used to query member docs by email to avoid a duplicate, then
        // create both the member and registry documents itself. Those reads are why the
        // rules had to allow public reads on collections holding raw email addresses,
        // and no rule could narrow them: rules cannot scope a query to the caller's own
        // address without auth. What used to be asserted here — one setDoc, maskedEmail
        // present, no follow-up updateDoc — now lives in functions joinForm.spec.ts.
        let joinSpy: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            joinSpy = vi.fn(async () => ({ data: { memberId: 'member-1' } }));
            vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(joinSpy as any);
        });

        it('delegates to the joinForm callable', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'new@example.com', firstName: 'New' });

            expect(FunctionsSDK.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'arccms-joinForm');
            expect(joinSpy).toHaveBeenCalledWith(expect.objectContaining({
                waitlistId: 'waitlist-1', email: 'new@example.com', firstName: 'New',
            }));
        });

        it('writes no member or registry document from the client', async () => {
            const setDoc = vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
            const addDoc = vi.spyOn(FirestoreSDK, 'addDoc').mockResolvedValue({ id: 'x' } as any);
            const updateDoc = vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);

            await service.joinWaitlist('waitlist-1', { email: 'new@example.com' });

            expect(setDoc).not.toHaveBeenCalled();
            expect(addDoc).not.toHaveBeenCalled();
            expect(updateDoc).not.toHaveBeenCalled();
        });

        it('reads no member documents from the client', async () => {
            const getDocs = vi.spyOn(FirestoreSDK, 'getDocs');

            await service.joinWaitlist('waitlist-1', { email: 'new@example.com' });

            // The whole point: this is the read the rules can now deny.
            expect(getDocs).not.toHaveBeenCalled();
        });

        it('returns the member id the form needs to continue, and sends no referral', async () => {
            const res = await service.joinWaitlist('waitlist-1', { email: 'new@example.com' });

            expect(res.userId).toBe('member-1');
            expect(joinSpy.mock.calls[0][0]).not.toHaveProperty('referredBy');
        });

        it('asks the server to send the code after joining', async () => {
            await service.joinWaitlist('waitlist-1', { email: 'new@example.com' });

            const called = vi.mocked(FunctionsSDK.httpsCallable).mock.calls.map((c) => String(c[1]).replace(/^arccms-/, ''));
            expect(called).toContain('joinForm');
            expect(called).toContain('requestFormOtp');
        });

        it('rejects a call with no email before touching the network', async () => {
            await expect(service.joinWaitlist('waitlist-1', {})).rejects.toThrow(/Missing required parameters/);
            expect(joinSpy).not.toHaveBeenCalled();
        });
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



    describe('resendVerificationCode', () => {
        it('asks the server to send the code to the address it is given', async () => {
            const spies = mockCallables();

            const result = await service.resendVerificationCode('waitlist-1', 'a@b.com', 'Asha');

            expect(spies['requestFormOtp']).toHaveBeenCalledWith({ waitlistId: 'waitlist-1', email: 'a@b.com', name: 'Asha' });
            expect(result.success).toBe(true);
        });

        it('passes on the server\'s message, such as the resend throttle', async () => {
            mockCallables({ requestFormOtp: () => { throw new Error('Please wait a minute before asking again.'); } });

            const result = await service.resendVerificationCode('waitlist-1', 'a@b.com');

            expect(result).toEqual({ success: false, message: 'Please wait a minute before asking again.' });
        });
    });

    describe('verifyAndConfirm, rejected codes (U5: server-authoritative)', () => {
        /**
         * Expiry, the attempt cap and the code comparison all live in `verifyFormOtp`
         * (U5): the client never holds the code. What must hold is that a code the
         * server rejects never confirms the signup, whatever the reason.
         */
        function serverRejects(message: string) {
            return mockCallables({ verifyFormOtp: () => { throw new Error(message); } });
        }

        it('returns the server message when the code has expired, and confirms nothing', async () => {
            const spies = serverRejects('Your code has expired. Please request a new one.');

            const result = await service.verifyAndConfirm('waitlist-1', 'user-1', 'a@b.com', '123456');

            expect(result.success).toBe(false);
            expect(result.message).toContain('expired');
            expect(spies['finalizeFormSignup']).toBeUndefined();
        });

        it('returns the server message on a wrong code', async () => {
            serverRejects('Invalid verification code.');

            const result = await service.verifyAndConfirm('waitlist-1', 'user-1', 'a@b.com', '000000');

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid verification code');
        });

        it('surfaces the attempt-cap lockout rather than verifying', async () => {
            serverRejects('Too many attempts. Please request a new code.');

            const result = await service.verifyAndConfirm('waitlist-1', 'user-1', 'a@b.com', '123456');

            expect(result.success).toBe(false);
            expect(result.message).toContain('Too many attempts');
        });

        it('does not throw when the callables themselves fail', async () => {
            vi.mocked(FunctionsSDK.httpsCallable).mockReturnValue(
                vi.fn(async () => { throw new Error('network down'); }) as any,
            );

            const result = await service.verifyAndConfirm('waitlist-1', 'user-1', 'a@b.com', '123456');

            expect(result.success).toBe(false);
        });
    });

    describe('verifyAndConfirm, accepted codes', () => {
        it('checks the code for the address typed, then confirms through the server', async () => {
            const spies = mockCallables();

            const result = await service.verifyAndConfirm('waitlist-1', 'user-1', 'a@b.com', '123456');

            expect(spies['verifyFormOtp']).toHaveBeenCalledWith({ waitlistId: 'waitlist-1', email: 'a@b.com', code: '123456' });
            expect(spies['finalizeFormSignup']).toHaveBeenCalledWith({ waitlistId: 'waitlist-1', userId: 'user-1' });
            expect(result).toEqual({ success: true, alreadyConfirmed: false });
        });

        it('says when the person was already on the list', async () => {
            mockCallables({ finalizeFormSignup: () => ({ totalSignups: 0, emailVerified: true, alreadyConfirmed: true }) });

            const result = await service.verifyAndConfirm('waitlist-1', 'user-1', 'a@b.com', '123456');

            expect(result.alreadyConfirmed).toBe(true);
        });

        it('reads no member document and calls no member view or referral callable', async () => {
            const getDoc = vi.spyOn(FirestoreSDK, 'getDoc');
            mockCallables();

            await service.verifyAndConfirm('waitlist-1', 'user-1', 'a@b.com', '123456');

            const called = vi.mocked(FunctionsSDK.httpsCallable).mock.calls.map((c) => String(c[1]).replace(/^arccms-/, ''));
            expect(called.sort()).toEqual(['finalizeFormSignup', 'verifyFormOtp']);
            expect(getDoc).not.toHaveBeenCalled();
        });
    });

    // ── U5 item 5: signup completion moved server-side ───────────────────────────
    // The browser used to write emailVerified, isConfirmed, queuePosition and the
    // default tag. Those fields are out of the unauthenticated-update whitelist in
    // firestore.rules, so the client delegates to finalizeFormSignup, which derives
    // whether an OTP was required rather than taking the caller's word for it.

    describe('confirmWithoutOtp, delegates protected writes to finalizeFormSignup (U5)', () => {
        beforeEach(() => {
            vi.spyOn(FirestoreSDK, 'updateDoc').mockResolvedValue(undefined);
            vi.spyOn(FirestoreSDK, 'setDoc').mockResolvedValue(undefined);
        });

        it('should call finalizeFormSignup with the waitlist and member ids only', async () => {
            const spies = mockCallables();

            const result = await service.confirmWithoutOtp('waitlist-1', 'user-1');

            expect(spies['finalizeFormSignup']).toHaveBeenCalledWith({ waitlistId: 'waitlist-1', userId: 'user-1' });
            expect(result).toEqual({ success: true, alreadyConfirmed: false });
        });

        it('should not write any member field from the client', async () => {
            mockCallables();

            await service.confirmWithoutOtp('waitlist-1', 'user-1');

            expect(FirestoreSDK.updateDoc).not.toHaveBeenCalled();
            expect(FirestoreSDK.setDoc).not.toHaveBeenCalled();
        });

        it('passes on an already-confirmed signup from the server', async () => {
            mockCallables({ finalizeFormSignup: () => ({ totalSignups: 0, emailVerified: true, alreadyConfirmed: true }) });

            const result = await service.confirmWithoutOtp('waitlist-1', 'user-1');

            expect(result.alreadyConfirmed).toBe(true);
        });
    });
});
