/**
 * Waitlist Service
 *
 * The signup form's steps, through the same callables as arc-site.js on
 * published pages: join, the emailed code, then confirming the signup.
 * Signup forms are plain: no queue position, referrals or leaderboard
 * (specs/form-gamification-spec.md).
 */

import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { addDoc, collection, doc, Firestore, getDoc, getDocs, query, setDoc, updateDoc, where } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import {
    IWaitlist,
    IWaitlistUser,
    IJoinWaitlistResult,
    DEFAULT_UI_CONFIG,
} from './waitlist.model';
import { arcCallable } from '../../core/config/arc-functions';

/** How a code check and confirmation ended. */
export interface IConfirmResult {
    success: boolean;
    message?: string;
    /** The person was already on the list before this signup. */
    alreadyConfirmed?: boolean;
}

@Injectable({
    providedIn: 'root',
})
export class WaitlistService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private injector = inject(Injector);

    /**
     * Get waitlist by ID
     */
    async getWaitlist(waitlistId: string): Promise<IWaitlist | null> {
        const waitlistDoc = await runInInjectionContext(this.injector, () => {
            const waitlistDocRef = doc(this.firestore, 'Waitlists', waitlistId);
            return getDoc(waitlistDocRef);
        });
        return waitlistDoc.exists() ? { id: waitlistDoc.id, ...waitlistDoc.data() } as IWaitlist : null;
    }

    /**
     * Get waitlist by Slug
     */
    async getWaitlistBySlug(slug: string): Promise<IWaitlist | null> {
        const querySnapshot = await runInInjectionContext(this.injector, () => {
            const waitlistsCollectionRef = collection(this.firestore, 'Waitlists');
            const q = query(waitlistsCollectionRef, where('slug', '==', slug));
            return getDocs(q);
        });

        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            return { id: docSnap.id, ...docSnap.data() } as IWaitlist;
        }
        return null;
    }

    /**
     * Create a new waitlist with auto-generated ID
     */
    async createWaitlist(waitlistData: Partial<IWaitlist>): Promise<string> {
        const waitlistCollectionRef = collection(this.firestore, 'Waitlists');
        const docRef = await addDoc(waitlistCollectionRef, {
            ...waitlistData,
            uiConfig: waitlistData.uiConfig || DEFAULT_UI_CONFIG,
            createdAt: new Date(),
        });
        return docRef.id;
    }

    /**
     * Create a new waitlist with a specific ID
     */
    async createWaitlistWithId(waitlistId: string, waitlistData: Partial<IWaitlist>): Promise<string> {
        const waitlistDocRef = doc(this.firestore, 'Waitlists', waitlistId);
        await setDoc(waitlistDocRef, {
            id: waitlistId,
            ...waitlistData,
            uiConfig: waitlistData.uiConfig || DEFAULT_UI_CONFIG,
            createdAt: new Date(),
        });
        return waitlistId;
    }

    /**
     * Update an existing waitlist
     */
    async updateWaitlist(waitlistId: string, waitlistData: Partial<IWaitlist>): Promise<void> {
        const waitlistDocRef = doc(this.firestore, 'Waitlists', waitlistId);
        await updateDoc(waitlistDocRef, { ...waitlistData, modifiedAt: new Date() });
    }

    /**
     * Soft delete a waitlist
     */
    async deleteWaitlist(waitlistId: string): Promise<void> {
        const waitlistDocRef = doc(this.firestore, 'Waitlists', waitlistId);
        await updateDoc(waitlistDocRef, { isActive: false });
    }

    /**
     * Join a waitlist. Server-authoritative find-or-create (#51).
     *
     * The browser used to do this itself: query `Waitlists/{id}/users` by email to
     * avoid a duplicate, then fall back to a second query on the global
     * `WaitlistedUsers` registry, then create both documents. Those two reads are why
     * `firestore.rules` had to allow public reads on collections holding raw email
     * addresses, and no rule could narrow them — rules cannot scope a query to the
     * caller's own address without auth.
     *
     * `joinForm` now does the find-or-create, which also makes deduplication atomic;
     * the client-side version was a read-then-write race between concurrent submits.
     *
     * The cross-form "already verified on another form" branch is gone rather than
     * moved (U6 option C): its outcome — a member document plus a verification code —
     * was identical to the new-member path, and cross-form identity is deduplicated by
     * `Contacts/{emailHash}` server-side regardless of what the form believes.
     */
    async joinWaitlist(waitlistId: string, userData: Partial<IWaitlistUser>): Promise<IJoinWaitlistResult & Record<string, unknown>> {
        if (!waitlistId || !userData?.email) {
            throw new Error('Missing required parameters: waitlistId, email');
        }

        try {
            const callable = runInInjectionContext(this.injector, () =>
                arcCallable<Record<string, unknown>, { memberId: string }>(this.functions, 'joinForm'));

            const res = await callable({
                waitlistId,
                email: userData.email,
                firstName: userData.firstName || '',
                source: userData.source || '',
                formData: userData.formData || {},
                signupMetadata: userData.signupMetadata || {},
                origin: typeof window !== 'undefined' ? window.location.origin : '',
            });
            const joined = res.data;

            // Ask for the code. The server owns generation, expiry and the resend
            // throttle, and decides whether this form verifies at all.
            await this.sendFormOtp(waitlistId, userData.email, userData.firstName);

            return {
                exists: false,
                verified: false,
                userId: joined.memberId,
                email: userData.email,
            };
        } catch (error) {
            console.error('Error in joinWaitlist:', error);
            throw new Error(`Failed to join waitlist: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check the emailed code, then confirm the signup.
     *
     * The code is checked server-side (expiry, attempt cap, hash), so the browser
     * can neither read a code off a document nor skip the check, and
     * `finalizeFormSignup` checks the verified record again before confirming.
     */
    async verifyAndConfirm(waitlistId: string, userId: string, email: string, otp: string): Promise<IConfirmResult> {
        try {
            const check = await this.checkFormOtp(waitlistId, email, otp);
            if (!check.ok) {
                return { success: false, message: check.message || 'Invalid or expired OTP' };
            }
            const finalized = await this.finalizeSignup(waitlistId, userId);
            return { success: true, alreadyConfirmed: finalized.alreadyConfirmed };
        } catch (error) {
            console.error('Error in verifyAndConfirm:', error);
            return { success: false, message: 'Verification failed' };
        }
    }

    /**
     * Confirm a signup that needs no code: email is not set up, or the form's
     * verification template is off. The server decides that, not the browser.
     */
    async confirmWithoutOtp(waitlistId: string, userId: string): Promise<IConfirmResult> {
        const finalized = await this.finalizeSignup(waitlistId, userId);
        return { success: true, alreadyConfirmed: finalized.alreadyConfirmed };
    }

    /**
     * Send the code again. The server owns the 60s resend throttle and returns a
     * clear error when asked too soon.
     */
    async resendVerificationCode(waitlistId: string, email: string, firstName?: string): Promise<{ success: boolean; message: string }> {
        const sent = await this.sendFormOtp(waitlistId, email, firstName);
        if (!sent.ok) {
            return { success: false, message: sent.message || 'Failed to resend verification code' };
        }
        return { success: true, message: 'Verification code sent successfully' };
    }

    /**
     * Ask the server to send this form's verification code (U5).
     *
     * The code is generated, stored hashed and emailed by `requestFormOtp` — the
     * browser never sees or stores it. Errors are returned rather than thrown so
     * callers can surface the server's message (e.g. the resend throttle).
     */
    private async sendFormOtp(
        waitlistId: string,
        email: string,
        name?: string,
    ): Promise<{ ok: boolean; message?: string }> {
        try {
            const call = arcCallable<
                { waitlistId: string; email: string; name?: string },
                { sent: boolean; status: string }
            >(this.functions, 'requestFormOtp');
            const res = await call({ waitlistId, email, name });
            return { ok: !!res.data?.sent, message: res.data?.sent ? undefined : `Email not sent (${res.data?.status}).` };
        } catch (error: any) {
            console.error('requestFormOtp failed:', error);
            return { ok: false, message: error?.message || 'Could not send the verification code.' };
        }
    }

    /**
     * Complete a signup server-side (U5 item 5): confirmation and verification
     * state. The browser used to write those fields itself, which is exactly why
     * the rules had to allow unauthenticated updates to them.
     *
     * The server decides whether a verified OTP is required: it is not told.
     */
    private async finalizeSignup(
        waitlistId: string,
        userId: string,
    ): Promise<{ totalSignups: number; emailVerified: boolean; alreadyConfirmed: boolean }> {
        const call = arcCallable<
            { waitlistId: string; userId: string },
            { totalSignups: number; emailVerified: boolean; alreadyConfirmed: boolean }
        >(this.functions, 'finalizeFormSignup');
        const res = await call({ waitlistId, userId });
        return {
            totalSignups: res.data?.totalSignups ?? 0,
            emailVerified: !!res.data?.emailVerified,
            alreadyConfirmed: !!res.data?.alreadyConfirmed,
        };
    }

    /** Server-authoritative code check (U5). Throws are converted to a result. */
    private async checkFormOtp(
        waitlistId: string,
        email: string,
        code: string,
    ): Promise<{ ok: boolean; message?: string }> {
        try {
            const call = arcCallable<
                { waitlistId: string; email: string; code: string },
                { verified: boolean }
            >(this.functions, 'verifyFormOtp');
            const res = await call({ waitlistId, email, code });
            return { ok: !!res.data?.verified };
        } catch (error: any) {
            // The callable's HttpsError message is user-facing (expired, wrong
            // code, too many attempts) — pass it through rather than flattening it.
            return { ok: false, message: error?.message || 'Invalid or expired OTP' };
        }
    }

    /**
     * Get first name from email
     */
    getFirstNameFromEmail(email: string): string {
        if (!email || !email.includes('@')) return '';
        const [username] = email.split('@');
        return username.charAt(0).toUpperCase() + username.slice(1).split(/[._-]/)[0];
    }
}
