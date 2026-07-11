/**
 * Onboarding Setup Service
 *
 * Handles all Firestore writes during the onboarding wizard.
 * Uses direct setDoc() calls to avoid activating real-time listeners
 * that the admin services use.
 */

import { inject, Injectable } from '@angular/core';
import { Firestore, doc, collection, setDoc, getDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable, from, map, of, catchError } from 'rxjs';
import { DEFAULT_CONTENT_TYPES, DEFAULT_WAITLIST, DEFAULT_SITE_CSS_URLS } from './onboarding-defaults';
import { DEFAULT_EMAIL_SETTINGS, IEmailSettings, hasValidProviderConfig } from '../admin/(settings)/email-setting/email-setting.model';

@Injectable({ providedIn: 'root' })
export class OnboardingSetupService {
    private firestore = inject(Firestore);

    /**
     * Save site identity info.
     * Writes Settings/about and Settings/site.
     * Optionally writes Settings/integrations if an Unsplash key is provided.
     */
    async saveSiteInfo(siteName: string, siteUrl: string, unsplashKey?: string): Promise<void> {
        await setDoc(doc(this.firestore, 'Settings', 'about'), {
            name: siteName,
            finalUrl: siteUrl,
            address: '',
        }, { merge: true });

        await setDoc(doc(this.firestore, 'Settings', 'site'), {
            siteName,
            baseUrl: siteUrl,
            cssUrls: DEFAULT_SITE_CSS_URLS,
        }, { merge: true });

        if (unsplashKey) {
            await setDoc(doc(this.firestore, 'Settings', 'integrations'), {
                unsplash: { accessKey: unsplashKey, secretKey: '' },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
    }

    /**
     * Save default platform settings (user signup + misc).
     */
    async saveDefaultSettings(): Promise<void> {
        await setDoc(doc(this.firestore, 'Settings', 'users'), {
            isSignupEnabled: true,
            defaultRole: 'user',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, { merge: true });

        await setDoc(doc(this.firestore, 'Settings', 'misc'), {
            showPoweredBy: true,
        }, { merge: true });

        await setDoc(doc(this.firestore, 'Settings', 'integrations'), {
            geo: { geoEnabled: true, geoApiProvider: 'ipapi', geoApiKey: '', geoApiEndpoint: '' },
        }, { merge: true });
    }

    /**
     * Save email configuration with the chosen provider.
     *
     * E6 invariant: email can only be enabled when a valid provider is
     * configured — the same coercion the Email Settings page applies. Without a
     * valid provider, we persist the config but keep email disabled so the
     * kill-switch (queueEmail/sendMail) never sends against a broken provider.
     */
    async saveEmailConfig(settings: IEmailSettings): Promise<void> {
        const enable = hasValidProviderConfig(settings);
        const dataToSave = {
            ...settings,
            isEnabled: enable,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        delete dataToSave.id;

        await setDoc(doc(this.firestore, 'Settings', 'email'), dataToSave);
        await setDoc(doc(this.firestore, 'Settings', 'email_status'), {
            isEnabled: enable,
            requireSignupVerification: settings.requireSignupVerification ?? false,
        });
    }

    /**
     * Save email as disabled (user chose "Skip for now").
     */
    async saveEmailSkipped(): Promise<void> {
        const dataToSave = {
            ...DEFAULT_EMAIL_SETTINGS,
            isEnabled: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        await setDoc(doc(this.firestore, 'Settings', 'email'), dataToSave);
        await setDoc(doc(this.firestore, 'Settings', 'email_status'), {
            isEnabled: false,
            requireSignupVerification: false,
        });
    }

    /**
     * Create the 3 default content types.
     */
    async createDefaultContentTypes(): Promise<void> {
        for (const ct of DEFAULT_CONTENT_TYPES) {
            const colRef = collection(this.firestore, 'ContentTypes');
            const docRef = doc(colRef);
            await setDoc(docRef, {
                ...ct,
                id: docRef.id,
                createdBy: 'system',
                createdAt: serverTimestamp(),
                modifiedBy: 'system',
                modifiedAt: serverTimestamp(),
            });
        }
    }

    /**
     * Create the default waitlist.
     * Uses 'default' as the document ID so landing page forms work immediately.
     *
     * IMPORTANT: Must be called AFTER saveEmailConfig/saveEmailSkipped so the
     * onWaitlistsCreate cloud function reads correct email settings for template creation.
     */
    async createDefaultWaitlist(): Promise<void> {
        await setDoc(doc(this.firestore, 'Waitlists', 'default'), {
            ...DEFAULT_WAITLIST,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    }

    /**
     * Complete the setup: create content types, waitlist, and mark onboarding done.
     * Call this after email settings have been saved (step 4).
     */
    async completeSetup(): Promise<void> {
        await this.createDefaultContentTypes();
        await this.createDefaultWaitlist();
        await this.markOnboardingComplete();
    }

    /**
     * Mark onboarding as started (in-progress).
     * Called after admin account creation (step 2) so we can detect abandoned wizards.
     */
    async markOnboardingStarted(): Promise<void> {
        await setDoc(doc(this.firestore, 'Settings', 'onboarding_status'), {
            completed: false,
            startedAt: serverTimestamp(),
        });
    }

    /**
     * Mark onboarding as fully complete.
     * Called at the end of step 5 (or when user skips to dashboard).
     */
    async markOnboardingComplete(): Promise<void> {
        await setDoc(doc(this.firestore, 'Settings', 'onboarding_status'), {
            completed: true,
            completedAt: serverTimestamp(),
        }, { merge: true });
    }

    /**
     * Check whether onboarding has been completed.
     *
     * Returns true if:
     * - The document doesn't exist (legacy install or pre-onboarding state)
     * - The document exists with completed === true
     * - The read fails (assume complete to avoid blocking)
     *
     * Returns false only when the document exists with completed === false
     * (wizard was started but not finished).
     */
    isOnboardingComplete(): Observable<boolean> {
        const docRef = doc(this.firestore, 'Settings', 'onboarding_status');
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (!snapshot.exists()) return true;
                return snapshot.data()?.['completed'] === true;
            }),
            catchError(() => of(true)),
        );
    }
}
