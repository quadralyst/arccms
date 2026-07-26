/**
 * Waitlist Service
 * 
 * Core business logic for waitlist operations:
 * - Join waitlist and handle OTP verification
 * - Process referrals
 * - Manage leaderboard data
 * - Handle localStorage for referral tracking
 */

import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { addDoc, arrayUnion, collection, doc, Firestore, getCountFromServer, getDoc, getDocs, increment, limit, orderBy, query, setDoc, updateDoc, where } from '@angular/fire/firestore';
import { getWaitlistUserTagsCollectionName } from '../admin/(waitlists)/joined-users/waitlist-user-tags.model';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ActivatedRoute } from '@angular/router';
import {
    IWaitlist,
    IWaitlistUser,
    IJoinWaitlistResult,
    IVerifyOtpResult,
    IStoredReferral,
    ILeaderboardResponse,
    OTP_EXPIRATION_MINUTES,
    REFERRAL_EXPIRATION_HOURS,
    DEFAULT_UI_CONFIG,
} from './waitlist.model';

@Injectable({
    providedIn: 'root',
})
export class WaitlistService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private route = inject(ActivatedRoute);
    private injector = inject(Injector);

    private readonly DEBOUNCE_DELAY = 500;

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
     * Get all waitlists
     */
    async getWaitlists(): Promise<IWaitlist | null> {
        const waitlistsCollectionRef = collection(this.firestore, 'Waitlists');
        const querySnapshot = await getDocs(waitlistsCollectionRef);

        if (querySnapshot.docs.length > 0) {
            const docSnap = querySnapshot.docs[0];
            return { id: docSnap.id, ...docSnap.data() } as IWaitlist;
        }
        return null;
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
     * Join a waitlist - returns user data for OTP verification
     */
    async joinWaitlist(waitlistId: string, userData: Partial<IWaitlistUser>): Promise<IJoinWaitlistResult & Record<string, unknown>> {
        try {
            // Validate inputs
            if (!waitlistId || !userData?.email) {
                throw new Error('Missing required parameters: waitlistId, email');
            }

            // Check if waitlist exists
            const waitlistDocRef = doc(this.firestore, 'Waitlists', waitlistId);
            const waitlistDoc = await getDoc(waitlistDocRef);
            if (!waitlistDoc.exists()) {
                throw new Error(`Waitlist with ID ${waitlistId} does not exist`);
            }
            const waitlistData = waitlistDoc.data();
            const defaultTagId = (waitlistData?.['defaultTagId'] as string) || '';

            // Step 1: Check if user exists in waitlist subcollection
            const waitlistUsersRef = collection(this.firestore, `Waitlists/${waitlistId}/users`);
            const waitlistUserQuery = query(waitlistUsersRef, where('email', '==', userData.email));
            const waitlistUserSnapshot = await getDocs(waitlistUserQuery);

            if (!waitlistUserSnapshot.empty) {
                // User exists in subcollection
                const subCollectionUser = waitlistUserSnapshot.docs[0];
                const subCollectionUserData = subCollectionUser.data();

                // U5: the code is generated, stored hashed and emailed server-side.
                const userDocRef = doc(this.firestore, `Waitlists/${waitlistId}/users`, subCollectionUser.id);
                await updateDoc(userDocRef, {
                    firstName: subCollectionUserData['isConfirmed']
                        ? subCollectionUserData['firstName']
                        : userData?.firstName || '',
                });

                // Update WaitlistedUsers if user is NOT confirmed
                if (!subCollectionUserData['isConfirmed'] && subCollectionUserData['waitlistedUserId']) {
                    const waitlistedUserDocRef = doc(
                        this.firestore,
                        'WaitlistedUsers',
                        subCollectionUserData['waitlistedUserId'],
                    );
                    await updateDoc(waitlistedUserDocRef, {
                        firstName: userData?.firstName || '',
                    });
                }

                await this.sendFormOtp(waitlistId, subCollectionUserData['email'] as string, userData?.firstName);

                return {
                    exists: true,
                    verified: subCollectionUserData['isConfirmed'] || false,
                    userId: subCollectionUser.id,
                    email: subCollectionUserData['email'],
                    ...subCollectionUserData,
                    isExisting: true,
                };
            }

            // Step 2: Check if user exists in WaitlistedUsers collection (global check)
            const waitlistedUsersRef = collection(this.firestore, 'WaitlistedUsers');
            const existingUserQuery = query(waitlistedUsersRef, where('email', '==', userData.email));
            const existingUserSnapshot = await getDocs(existingUserQuery);

            if (!existingUserSnapshot.empty) {
                const existingUser = existingUserSnapshot.docs[0];
                const existingUserData = existingUser.data();

                // If confirmed user joining a new waitlist
                if (existingUserData['isConfirmed']) {
                    const waitlistedUserDocRef = doc(this.firestore, 'WaitlistedUsers', existingUser.id);
                    await updateDoc(waitlistedUserDocRef, {
                        firstName: userData?.firstName || '',
                    });

                    await this.sendFormOtp(waitlistId, existingUserData['email'] as string, userData?.firstName);

                    return {
                        exists: true,
                        verified: true,
                        userId: existingUser.id,
                        email: existingUserData['email'],
                        ...existingUserData,
                        isExisting: true,
                        requiresOtpForNewWaitlist: true,
                        targetWaitlistId: waitlistId,
                    };
                }

                // Unverified user trying to join different waitlist
                const existingWaitlistIds = (existingUserData['waitlistIds'] as string[]) || [existingUserData['waitlistId']];
                if (!existingWaitlistIds.includes(waitlistId)) {
                    return {
                        exists: true,
                        verified: false,
                        error: true,
                        message: `This email is already registered in another waitlist. Please verify your email in the original waitlist first.`,
                        existingWaitlistId: existingUserData['waitlistId'],
                    } as IJoinWaitlistResult & Record<string, unknown>;
                }

                // Create subcollection entry for existing user
                const userDataToCreate = {
                    ...existingUserData,
                    maskedEmail: existingUserData['maskedEmail'] || this.maskEmail((existingUserData['email'] as string) || ''),
                };
                const userRef = await addDoc(collection(this.firestore, `Waitlists/${waitlistId}/users`), {
                    ...userDataToCreate,
                    waitlistedUserId: existingUser.id,
                });

                // Apply default tag if configured
                if (defaultTagId) {
                    await this.applyDefaultTag(waitlistId, userRef.id, defaultTagId);
                }

                await this.sendFormOtp(waitlistId, existingUserData['email'] as string, userData?.firstName);

                return {
                    exists: true,
                    verified: false,
                    userId: userRef.id,
                    email: existingUserData['email'],
                    ...userDataToCreate,
                    isExisting: true,
                };
            }

            // Step 3: New user - create entries in both collections
            const referralCode = this.generateReferralCode();
            const referralLink = this.generateUrl(this.getCurrentPath(), { ref: referralCode });

            // Pre-generate the WaitlistedUsers doc ID so leaderboardLink can be included
            // in the initial setDoc — avoiding a separate updateDoc that would trigger
            // onWaitlistedUserUpdate and cause a duplicate OTP email.
            const waitlistedUserDocRef = doc(collection(this.firestore, 'WaitlistedUsers'));
            const leaderboardLink = typeof window !== 'undefined'
                ? `${window.location.origin}/leaderboard/${waitlistId}/${waitlistedUserDocRef.id}`
                : `/leaderboard/${waitlistId}/${waitlistedUserDocRef.id}`;

            const newUser = {
                ...userData,
                referralCode: referralCode,
                referralLink: referralLink,
                maskedEmail: this.maskEmail(userData.email || ''),
                queuePosition: 0,
                totalReferrals: 0,
                signupTimestamp: new Date(),
                emailVerified: false,
                isConfirmed: false,
                ipAddress: '',
                leaderboardLink: leaderboardLink,
                createdAt: new Date(),
                isSubscribed: true,
            };

            // Create in root WaitlistedUsers collection (single write — no follow-up updateDoc
            // needed, which previously caused a duplicate OTP email via onWaitlistedUserUpdate)
            await setDoc(waitlistedUserDocRef, {
                ...newUser,
                waitlistId: waitlistId,
                waitlistIds: [waitlistId],
            });

            // Create in waitlist subcollection
            const userRef = await addDoc(collection(this.firestore, `Waitlists/${waitlistId}/users`), {
                ...newUser,
                leaderboardLink,
                waitlistedUserId: waitlistedUserDocRef.id,
                waitlistId: waitlistId,
            });

            // Apply default tag if configured
            if (defaultTagId) {
                await this.applyDefaultTag(waitlistId, userRef.id, defaultTagId);
            }

            // Handle referral if provided
            if (userData.referredBy) {
                await this.createPendingReferral(userData.referredBy, userData.email || '', waitlistId, userRef.id);
            }

            // U5: request the code. Previously the OTP email rode on the
            // `verificationCode` write via onWaitlistedUsersCreate; that field is
            // gone, so the send has to be asked for explicitly — and this is the
            // most-travelled path, a brand-new signup.
            await this.sendFormOtp(waitlistId, newUser.email || '', newUser.firstName);

            return {
                exists: false,
                verified: false,
                userId: userRef.id,
                email: newUser.email,
                ...newUser,
                isExisting: false,
            };
        } catch (error) {
            console.error('Error in joinWaitlist:', error);
            throw new Error(`Failed to join waitlist: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Verify OTP and process user
     */
    async verifyOtpAndProcessUser(
        waitlistId: string,
        userId: string,
        otp: string,
        userData: Partial<IWaitlistUser>,
    ): Promise<{ success: boolean; message?: string; data?: IVerifyOtpResult & Record<string, unknown>; isExistingVerifiedUser?: boolean }> {
        try {
            // U5: the code is checked server-side (expiry, attempt cap, hash), so the
            // browser can neither read the code off a doc nor skip the check. The
            // check sits exactly where the old plaintext comparison did, and takes
            // the address from whichever record we already loaded — callers do not
            // always pass one.
            let otpVerified = false;

            // Check if this is a verified user from WaitlistedUsers trying to join a new waitlist
            const waitlistedUserDocRef = doc(this.firestore, 'WaitlistedUsers', userId);
            const waitlistedUserDoc = await getDoc(waitlistedUserDocRef);

            if (waitlistedUserDoc.exists()) {
                const waitlistedUserData = waitlistedUserDoc.data();

                const check = await this.checkFormOtp(
                    waitlistId,
                    (userData?.email || waitlistedUserData['email'] || '') as string,
                    otp,
                );
                if (!check.ok) {
                    return { success: false, message: check.message || 'Invalid or expired OTP' };
                }
                otpVerified = true;

                // If user is confirmed and trying to join a new waitlist
                if (waitlistedUserData['isConfirmed']) {
                    return await this.processVerifiedUserJoiningNewWaitlist(
                        waitlistId,
                        userId,
                        waitlistedUserData,
                        userData,
                    );
                }
            }

            // Check if user exists in waitlist subcollection
            const userDocRef = doc(this.firestore, `Waitlists/${waitlistId}/users`, userId);
            const userDoc = await getDoc(userDocRef);

            if (!userDoc.exists()) {
                return { success: false, message: 'User not found in waitlist' };
            }

            const user = userDoc.data();

            // Same server-side check for the subcollection path (skipped if the
            // WaitlistedUsers branch above already verified this code).
            if (!otpVerified) {
                const check = await this.checkFormOtp(
                    waitlistId,
                    (userData?.email || user['email'] || '') as string,
                    otp,
                );
                if (!check.ok) {
                    return { success: false, message: check.message || 'Invalid or expired OTP' };
                }
            }

            // If already confirmed, return existing data
            if (user['isConfirmed']) {
                return {
                    success: true,
                    isExistingVerifiedUser: true,
                    data: {
                        ...user,
                        queuePosition: user['queuePosition'] as number,
                        waitlistedUserId: user['waitlistedUserId'] as string,
                        totalSignups: 0,
                        referralCode: user['referralCode'] as string,
                        referralLink: this.generateUrl(this.getCurrentPath(), { ref: user['referralCode'] as string }),
                        leaderboardLink: this.generateUrl(`/leaderboard`),
                    },
                };
            }

            // Process new verification
            return await this.processNewVerification(waitlistId, userId, user, userData);
        } catch (error) {
            console.error('Error in verifyOtpAndProcessUser:', error);
            return { success: false, message: 'Verification failed' };
        }
    }

    /**
     * Process verified user joining a new waitlist
     */
    private async processVerifiedUserJoiningNewWaitlist(
        waitlistId: string,
        userId: string,
        waitlistedUserData: Record<string, unknown>,
        userData: Partial<IWaitlistUser>,
    ): Promise<{ success: boolean; message?: string; data?: IVerifyOtpResult & Record<string, unknown>; isExistingVerifiedUser?: boolean }> {
        // Calculate queue position
        const usersCollectionRef = collection(this.firestore, `Waitlists/${waitlistId}/users`);
        const confirmedUsersQuery = query(usersCollectionRef, where('isConfirmed', '==', true));
        const confirmedUsersSnapshot = await getDocs(confirmedUsersQuery);
        const queuePosition = confirmedUsersSnapshot.size + 1;

        // Get waitlist data
        const waitlistDocRef = doc(this.firestore, 'Waitlists', waitlistId);
        const waitlistDoc = await getDoc(waitlistDocRef);
        const waitlistData = waitlistDoc.data();
        const newTotalSignups = confirmedUsersSnapshot.size + 1;
        // const newTotalSignups = (waitlistData?.['startingPoint'] || 0) + confirmedUsersSnapshot.size + 1;

        // Create entry in current waitlist
        const referralCode = (waitlistedUserData['referralCode'] as string) || this.generateReferralCode();
        const referralLink = this.generateUrl(this.getCurrentPath(), { ref: referralCode });

        const leaderboardLink = typeof window !== 'undefined'
            ? `${window.location.origin}/leaderboard/${waitlistId}/${userId}`
            : `/leaderboard/${waitlistId}/${userId}`;

        const newWaitlistEntry = {
            ...waitlistedUserData,
            waitlistId: waitlistId,
            waitlistedUserId: userId,
            maskedEmail: this.maskEmail((waitlistedUserData['email'] as string) || ''),
            signupTimestamp: new Date(),
            queuePosition: queuePosition,
            totalReferrals: 0,
            referralCode: referralCode,
            referralLink: referralLink,
            emailVerified: true,
            isConfirmed: true,
            verifiedAt: new Date(),
            verificationCode: null,
            verificationExpires: null,
            leaderboardLink: userData.leaderboardLink || leaderboardLink || '',
            createdAt: new Date(),
            isDirectJoined: true
        };

        const userRef = await addDoc(collection(this.firestore, `Waitlists/${waitlistId}/users`), newWaitlistEntry);

        // Apply default tag if configured
        const defaultTagId = (waitlistData?.['defaultTagId'] as string) || '';
        if (defaultTagId) {
            await this.applyDefaultTag(waitlistId, userRef.id, defaultTagId);
        }

        // Update waitlist total signups
        await updateDoc(waitlistDocRef, { totalSignups: newTotalSignups });

        // Record the new waitlist on the global registry. The verification fields
        // are no longer touched here: the client never sets a code (U5), and
        // verifyFormOtp/finalizeFormSignup clear the legacy ones server-side — which
        // is what lets the security rules refuse client writes to them.
        const waitlistedUserDocRef = doc(this.firestore, 'WaitlistedUsers', userId);
        await updateDoc(waitlistedUserDocRef, {
            waitlistId: waitlistId,
            waitlistIds: arrayUnion(waitlistId),
        });

        // Handle referral if provided
        if (userData.referredBy) {
            await this.processReferral(waitlistId, userData.referredBy, userData.email || '', userData.firstName || '', userRef.id);
        }

        return {
            success: true,
            isExistingVerifiedUser: true,
            data: {
                ...newWaitlistEntry,
                queuePosition,
                totalSignups: newTotalSignups,
                referralCode: newWaitlistEntry.referralCode,
                referralLink: this.generateUrl(this.getCurrentPath(), { ref: newWaitlistEntry.referralCode }),
                leaderboardLink: this.generateUrl(`/leaderboard/${userId}`),
                userId: userRef.id,
            },
        };
    }

    /**
     * Process new verification
     */
    private async processNewVerification(
        waitlistId: string,
        userId: string,
        user: Record<string, unknown>,
        userData: Partial<IWaitlistUser>,
    ): Promise<{ success: boolean; message?: string; data?: IVerifyOtpResult & Record<string, unknown>; isExistingVerifiedUser?: boolean }> {
        // U5 item 5: the verification/position writes moved to finalizeFormSignup,
        // which re-checks the OTP record server-side before confirming anyone.
        const finalized = await this.finalizeSignup(waitlistId, userId, userData.referredBy);
        const queuePosition = finalized.queuePosition;
        const newTotalSignups = finalized.totalSignups;

        // Handle referral if provided
        if (userData.referredBy) {
            await this.processReferral(waitlistId, userData.referredBy, userData.email || '', userData.firstName || '', userId);
        }

        return {
            success: true,
            isExistingVerifiedUser: false,
            data: {
                ...user,
                queuePosition,
                totalSignups: newTotalSignups,
                referralCode: user['referralCode'] as string,
                referralLink: this.generateUrl(this.getCurrentPath(), { ref: user['referralCode'] as string }),
                leaderboardLink: this.generateUrl(`/leaderboard/${waitlistId}/${userId}`),
                emailVerified: true,
                isConfirmed: true,
                waitlistedUserId: user['waitlistedUserId'] as string,
            },
        };
    }

    /**
     * Process a referral when user verifies
     */
    /**
     * Resolve a referral code to the member that owns it, within one form.
     *
     * U6: referral codes are looked up among the form's members rather than in the
     * retired global `WaitlistedUsers` registry, and referral records now hang off the
     * member that earned them — `Waitlists/{waitlistId}/users/{memberId}/referrals` —
     * so the crediting trigger reads both ids straight from the path.
     */
    private async findReferrerMember(
        waitlistId: string,
        referrerCode: string,
        referredEmail: string,
    ): Promise<{ id: string; refPath: string } | null> {
        const membersRef = collection(this.firestore, `Waitlists/${waitlistId}/users`);
        const snapshot = await getDocs(query(membersRef, where('referralCode', '==', referrerCode)));
        if (snapshot.empty) return null;

        const referrer = snapshot.docs[0];
        const referrerEmail = referrer.data()['email'] as string | undefined;
        if (referrerEmail && referrerEmail.toLowerCase() === referredEmail.toLowerCase()) {
            console.warn('Self-referral blocked:', referredEmail);
            return null;
        }
        return { id: referrer.id, refPath: `Waitlists/${waitlistId}/users/${referrer.id}/referrals` };
    }

    private async processReferral(
        waitlistId: string,
        referrerCode: string,
        referredEmail: string,
        referredName: string,
        referredUserId: string,
    ): Promise<void> {
        const referrer = await this.findReferrerMember(waitlistId, referrerCode, referredEmail);
        if (!referrer) return;

        // Check for duplicate referral
        const existingReferralQuery = query(
            collection(this.firestore, referrer.refPath),
            where('referredEmail', '==', referredEmail),
            where('referrerCode', '==', referrerCode),
        );
        const existingReferralSnapshot = await getDocs(existingReferralQuery);

        if (!existingReferralSnapshot.empty) return;

        // Create referral record
        await addDoc(collection(this.firestore, referrer.refPath), {
            referrerCode,
            referredEmail,
            referredMaskedEmail: this.maskEmail(referredEmail),
            referredName,
            referredUserId,
            waitlistId,
            status: 'completed',
            referredBy: referrer.id,
            createdAt: new Date(),
            completedAt: new Date(),
        });

        // NOTE: totalReferrals is incremented by the cloud function
        // (onReferralCreate / onReferralUpdate → incrementReferralCounts)
        // using FieldValue.increment(1) atomically. Do NOT increment here
        // to avoid double-counting.
    }

    /**
     * Create a pending referral for new user
     */
    private async createPendingReferral(
        referrerCode: string,
        referredEmail: string,
        waitlistId: string,
        referredUserId: string,
    ): Promise<void> {
        const referrer = await this.findReferrerMember(waitlistId, referrerCode, referredEmail);
        if (!referrer) return;

        await addDoc(collection(this.firestore, referrer.refPath), {
            referrerCode,
            referredEmail,
            referredMaskedEmail: this.maskEmail(referredEmail),
            referredUserId,
            waitlistId,
            referredBy: referrer.id,
            status: 'pending',
            createdAt: new Date(),
        });
    }

    /**
     * Apply the waitlist's default tag to a new subscriber.
     * Adds the tag ID to the user's tags array and increments the tag's usageCount.
     */
    private async applyDefaultTag(waitlistId: string, userId: string, defaultTagId: string): Promise<void> {
        try {
            // Add tag to user's tags array
            const userDocRef = doc(this.firestore, `Waitlists/${waitlistId}/users`, userId);
            await updateDoc(userDocRef, { tags: [defaultTagId] });

            // Increment the tag's usageCount (use setDoc with merge to handle missing tag docs)
            const tagCollName = getWaitlistUserTagsCollectionName(waitlistId);
            const tagDocRef = doc(this.firestore, tagCollName, defaultTagId);
            await setDoc(tagDocRef, { usageCount: increment(1) }, { merge: true });
        } catch (error) {
            // Non-critical: log but don't fail the join flow
            console.error('Error applying default tag:', error);
        }
    }

    /**
     * Confirm a user without OTP verification.
     * Used when email is not configured — marks user as verified,
     * assigns queue position, updates waitlist totals, and processes referral.
     *
     * @param waitlistId  The waitlist document ID
     * @param userId      The subcollection user document ID (Waitlists/{waitlistId}/users/{userId})
     * @param referralCode  Optional referral code to credit
     */
    async confirmWithoutOtp(
        waitlistId: string,
        userId: string,
        referralCode: string,
    ): Promise<{ queuePosition: number; totalSignups: number }> {
        // Read the subcollection user doc
        const userDocRef = doc(this.firestore, `Waitlists/${waitlistId}/users`, userId);
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
            throw new Error('User not found in waitlist');
        }

        const user = userDoc.data();

        // If already confirmed, return current data without re-processing
        if (user['isConfirmed']) {
            return {
                queuePosition: (user['queuePosition'] as number) || 0,
                totalSignups: 0,
            };
        }

        // U5 item 5: position, confirmation and verification state are written by
        // finalizeFormSignup. The server also decides whether an OTP was required —
        // this path exists precisely for when it was not (email off / template
        // inactive), and letting the client assert that would reopen the hole.
        const finalized = await this.finalizeSignup(waitlistId, userId, referralCode);

        // Referral crediting still runs client-side; the counter itself is
        // incremented atomically by onReferralCreate/onReferralUpdate.
        if (referralCode) {
            await this.processReferral(
                waitlistId,
                referralCode,
                (user['email'] as string) || '',
                (user['firstName'] as string) || '',
                userId,
            );
        }

        return { queuePosition: finalized.queuePosition, totalSignups: finalized.totalSignups };
    }

    /**
     * Resend verification code
     */
    async resendVerificationCode(waitlistId: string, userId: string): Promise<{ success: boolean; message: string }> {
        try {
            const userDocRef = doc(this.firestore, `Waitlists/${waitlistId}/users`, userId);
            const userDoc = await getDoc(userDocRef);

            if (!userDoc.exists()) {
                return { success: false, message: 'User not found' };
            }

            const userData = userDoc.data();

            // U5: the server owns generation, expiry and the 60s resend throttle —
            // it returns a clear error if asked again too soon.
            const sent = await this.sendFormOtp(waitlistId, userData['email'] as string, userData['firstName'] as string);
            if (!sent.ok) {
                return { success: false, message: sent.message || 'Failed to resend verification code' };
            }

            return { success: true, message: 'Verification code sent successfully' };
        } catch (error) {
            console.error('Error resending verification code:', error);
            return { success: false, message: 'Failed to resend verification code' };
        }
    }

    /**
     * Get leaderboard for a waitlist
     */
    async getLeaderboard(waitlistId: string): Promise<{ leaderboard: unknown[]; totalUsers: number; unverifiedUsers: number; waitlistId: string }> {
        // Server-side (#51). This used to query `Waitlists/{id}/users` from the browser,
        // which is why the rules had to allow public reads on a collection holding raw
        // email addresses. The callable returns masked addresses and an explicit
        // allowlist of fields.
        const callable = runInInjectionContext(this.injector, () =>
            httpsCallable<{ waitlistId: string }, { leaderboard: unknown[]; totalUsers: number; unverifiedUsers: number; waitlistId: string }>(
                this.functions, 'getPublicLeaderboard'));
        const res = await callable({ waitlistId });
        return res.data;
    }

    /**
     * Fetch leaderboard via Cloud Function
     */
    fetchLeaderboard(userEmail: string, collectionName?: string): Promise<ILeaderboardResponse> {
        return new Promise((resolve, reject) => {
            const fetch = httpsCallable(this.functions, 'getOptimizedLeaderboard');

            fetch({ userEmail, collectionName })
                .then((result) => resolve(result.data as ILeaderboardResponse))
                .catch((error) => reject(error));
        });
    }

    /**
     * A member's own view: their record, referral history and stats, in one call.
     *
     * Server-side (#51). This replaces two client-side reads of `WaitlistedUsers` — the
     * record and its referrals subcollection — which is why the rules had to allow
     * public reads there. `memberRef` accepts a member-doc id or a legacy
     * `waitlistedUserId`, so links already sent by email keep resolving after U6.
     *
     * Returns null for a stale or unknown link rather than throwing.
     */
    async getMemberView(
        waitlistId: string,
        memberRef: string,
    ): Promise<{ member: Record<string, unknown>; referrals: unknown[]; stats: Record<string, number>; waitlist: unknown } | null> {
        if (!waitlistId || !memberRef) return null;
        const callable = runInInjectionContext(this.injector, () =>
            httpsCallable<{ waitlistId: string; memberRef: string }, { member: Record<string, unknown>; referrals: unknown[]; stats: Record<string, number>; waitlist: unknown }>(
                this.functions, 'getPublicMemberView'));
        try {
            const res = await callable({ waitlistId, memberRef });
            return res.data;
        } catch (error) {
            // `not-found` is a normal outcome for a stale link, not an error to shout about.
            if ((error as { code?: string })?.code === 'functions/not-found') return null;
            throw error;
        }
    }

    /**
     * Get all referrals for a user
     */
    /**
     * Get user details for a specific waitlist
     */
    /**
     * The public user-details page payload.
     *
     * Server-side (#51). This previously made three client-side reads — the member doc,
     * the form doc, and the referrals subcollection under `WaitlistedUsers` — and spread
     * the raw member document into its response. It now composes the callable's
     * allowlisted view, so a field added to a member doc is not exposed by accident.
     *
     * The links stay client-side because they depend on the current origin.
     */
    async getUserDetails(waitlistId: string, memberRef: string): Promise<unknown | null> {
        try {
            const view = await this.getMemberView(waitlistId, memberRef);
            if (!view) return null;

            const member = view.member;
            return {
                user: {
                    ...member,
                    referralLink: this.generateUrl(this.getCurrentPath(), { ref: String(member['referralCode'] ?? '') }),
                    leaderboardLink: this.generateUrl(`/leaderboard/${waitlistId}`),
                    userDetailsLink: this.generateUrl(`/user/${waitlistId}/${memberRef}`),
                },
                waitlist: view.waitlist,
                referrals: view.referrals,
                stats: {
                    totalReferrals: Number(member['totalReferrals'] ?? 0),
                    successfulReferrals: view.stats['successfulReferrals'] || 0,
                    pendingReferrals: view.stats['pendingReferrals'] || 0,
                },
            };
        } catch (error) {
            console.error('Error getting user details:', error);
            throw error;
        }
    }

    /**
     * Store referral code in localStorage with expiration
     */
    storeReferralCodeWithExpiration(referralCode: string, expirationHours: number = REFERRAL_EXPIRATION_HOURS): void {
        if (typeof localStorage === 'undefined') return;

        const data: IStoredReferral = {
            code: referralCode,
            expiration: Date.now() + expirationHours * 60 * 60 * 1000,
        };
        localStorage.setItem('arc_referral', JSON.stringify(data));
    }

    /**
     * Get referral code from localStorage
     */
    getReferralCodeFromStorage(): string | null {
        if (typeof localStorage === 'undefined') return null;

        const stored = localStorage.getItem('arc_referral');
        if (!stored) return null;

        try {
            const data: IStoredReferral = JSON.parse(stored);
            if (Date.now() > data.expiration) {
                localStorage.removeItem('arc_referral');
                return null;
            }
            return data.code;
        } catch {
            localStorage.removeItem('arc_referral');
            return null;
        }
    }

    /**
     * Clear stored referral code from localStorage.
     * Should be called after a referral has been successfully processed
     * to prevent stale codes from being reused on subsequent signups.
     */
    clearReferralCodeFromStorage(): void {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem('arc_referral');
    }

    /**
     * Generate 8-character referral code
     */
    private generateReferralCode(length: number = 8): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * Generate 6-digit OTP
     */
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
            const call = httpsCallable<
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
     * Complete a signup server-side (U5 item 5): queue position, confirmation and
     * verification state. The browser used to write those fields itself, which is
     * exactly why the rules had to allow unauthenticated updates to them.
     *
     * The server decides whether a verified OTP is required — it is not told.
     */
    private async finalizeSignup(
        waitlistId: string,
        userId: string,
        referredBy?: string,
    ): Promise<{ queuePosition: number; totalSignups: number; emailVerified: boolean }> {
        const call = httpsCallable<
            { waitlistId: string; userId: string; referredBy?: string },
            { queuePosition: number; totalSignups: number; emailVerified: boolean; alreadyConfirmed: boolean }
        >(this.functions, 'finalizeFormSignup');
        const res = await call({ waitlistId, userId, referredBy: referredBy || undefined });
        return {
            queuePosition: res.data?.queuePosition ?? 0,
            totalSignups: res.data?.totalSignups ?? 0,
            emailVerified: !!res.data?.emailVerified,
        };
    }

    /** Server-authoritative code check (U5). Throws are converted to a result. */
    private async checkFormOtp(
        waitlistId: string,
        email: string,
        code: string,
    ): Promise<{ ok: boolean; message?: string }> {
        try {
            const call = httpsCallable<
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

    private generateOtp(length: number = 6): string {
        const digits = '0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += digits.charAt(Math.floor(Math.random() * digits.length));
        }
        return result;
    }

    /**
     * Generate URL with query params
     */
    private generateUrl(path: string, queryParams?: Record<string, string>): string {
        if (typeof window === 'undefined') {
            const queryString = queryParams
                ? '?' + Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join('&')
                : '';
            return path + queryString;
        }

        const baseUrl = window.location.origin;
        const queryString = queryParams
            ? '?' + Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join('&')
            : '';
        return baseUrl + path + queryString;
    }

    /**
     * Get current path
     */
    private getCurrentPath(): string {
        if (typeof window === 'undefined') {
            return '';
        }
        return window.location.pathname || '';
    }

    /**
     * Mask email for privacy
     */
    maskEmail(email: string): string {
        if (!email || !email.includes('@')) return email;

        const [username, fullDomain] = email.split('@');
        const [domainName, ...tldParts] = fullDomain.split('.');
        const tld = tldParts.join('.');

        const maskedUser =
            username.length > 2 ? username.substring(0, 2) + '***' : username + '***';

        const maskedDomain =
            domainName.length > 3
                ? domainName.substring(0, 3) + '***'
                : domainName + '***';

        return `${maskedUser}@${maskedDomain}.${tld}`;
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
