/**
 * Onboarding Setup Service
 *
 * Handles all Firestore writes during the onboarding wizard.
 * Uses direct setDoc() calls to avoid activating real-time listeners
 * that the admin services use.
 */

import { inject, Injectable } from '@angular/core';
import { Firestore, doc, collection, setDoc, getDoc, getDocs, query, where, serverTimestamp } from '@angular/fire/firestore';
import { Observable, defer, from, map, of, catchError, switchMap } from 'rxjs';
import { DEFAULT_CONTENT_TYPES, DEFAULT_WAITLIST, DEFAULT_SITE_CSS_URLS } from './onboarding-defaults';
import { DEFAULT_EMAIL_SETTINGS, IEmailSettings, hasValidProviderConfig } from '../admin/(settings)/email-setting/email-setting.model';
import { AuthService } from '../(auth)/auth.service';

/**
 * Where an install sits relative to the onboarding wizard.
 *
 * `first-run`   — no admin exists yet; the wizard starts at step 1.
 * `in-progress` — an admin exists but the wizard never finished; resume at step 3.
 * `complete`    — the wizard finished, or this is a legacy install that predates it.
 */
export type OnboardingState = 'first-run' | 'in-progress' | 'complete';

@Injectable({ providedIn: 'root' })
export class OnboardingSetupService {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);

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
            debugMode: settings.activeProvider === 'debug_log',
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
            debugMode: false,
        });
    }

    /**
     * Create the default content types, once and only once.
     *
     * This has to be safe to call repeatedly, because it is: step 5 has a Retry
     * button, and an install whose `onboarding_status` never reached `completed`
     * drops the admin back at step 3 to walk 3→4→5 again. It used to write with
     * `doc(colRef)` — a fresh auto-ID every call, no existence check — so each
     * pass appended a whole new set. Four passes left four "Articles" types, all
     * sharing `slug: 'articles'`, and `onContentTypeDeleted` cascades on slug:
     * deleting any one of the duplicates wipes `arc_articles`,
     * `arc_articles_drafts` and `Tags_articles` for all of them, taking the real
     * content with it. The duplicate was not a cosmetic mess, it was a trap.
     *
     * Two changes make that impossible. The existence check is a slug *query*,
     * not a `getDoc`, so it also sees the auto-ID types older installs already
     * have. And new documents are keyed by slug, so even a racing double-call
     * writes the same document twice rather than two documents.
     *
     * An existing type is never overwritten — by the time this re-runs the admin
     * may have renamed it or added fields, and a seed has no business
     * reverting that.
     */
    async createDefaultContentTypes(): Promise<void> {
        const colRef = collection(this.firestore, 'ContentTypes');
        for (const ct of DEFAULT_CONTENT_TYPES) {
            const existing = await getDocs(query(colRef, where('slug', '==', ct.slug)));
            if (!existing.empty) {
                continue;
            }
            const docRef = doc(colRef, ct.slug);
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
     *
     * **The waitlist is not allowed to block the completion flag.** `Waitlists`
     * is `allow create: if isAdmin()` in the rules — the `admin` *custom claim*
     * on the ID token, which `onUserRoleChange` sets asynchronously after the
     * admin's user document is written. `checkAdminClaim()` polls for it and
     * then gives up and lets the admin reach step 5 regardless, so the token may
     * genuinely not carry the claim yet when this runs. It used to run between
     * the content types and `markOnboardingComplete()`, so a denied waitlist
     * write threw past the flag: `completed` stayed `false`, every later visit
     * bounced back into the wizard, and every bounce seeded another set of
     * content types. One optional convenience document held the whole install
     * hostage.
     *
     * Now it is best-effort. `waitlistCreated: false` tells step 5 to say so;
     * the admin can create a waitlist from the admin UI whenever they want one.
     */
    async completeSetup(): Promise<{ waitlistCreated: boolean }> {
        await this.createDefaultContentTypes();

        let waitlistCreated = true;
        try {
            await this.createDefaultWaitlist();
        } catch (err) {
            console.warn('Default waitlist could not be created (non-fatal):', err);
            waitlistCreated = false;
        }

        await this.markOnboardingComplete();
        return { waitlistCreated };
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
     * Where this install sits relative to the wizard. The single gate every
     * caller should use — see `shouldShowOnboarding()` for the common case.
     *
     * **`Settings/onboarding_status` is authoritative whenever it exists.**
     * Callers used to ask `AuthService.isFirstRun()` first and only consult this
     * document if that came back false. `isFirstRun()` reports whether the
     * `email_lookup` collection is empty, and nothing on the client fills that
     * collection any more — the `onUserCreated` Cloud Function does, after the
     * fact. So on any install where that trigger is undeployed or failing,
     * `isFirstRun()` answers "yes, first run" forever, no matter how many admins
     * exist, and the wizard reappears on every visit. A flag this app writes
     * itself, synchronously, at the moment setup finishes is the more truthful
     * signal, and it is checked first.
     *
     * `isFirstRun()` is still the fallback, for the two cases the flag cannot
     * speak to: a *missing* document (a brand-new install, or one predating the
     * flag), and a document we could not read.
     *
     * That second case is not hypothetical — it is what this app looks like
     * between shipping the frontend and deploying `firestore.rules`. Reading
     * this document without being signed in needs the public-read entry those
     * rules now carry; until it lands, an anonymous visitor's read is denied.
     * Answering "complete" there would leave a genuinely fresh install with no
     * wizard at all, so a denied read falls through to the old signal rather
     * than to an assumption. Only when *both* are unavailable do we give up and
     * say complete: at that point we cannot tell, and locking someone out of
     * their own site is worse than skipping a wizard they can still reach at
     * `/onboarding` by hand.
     */
    getOnboardingState(): Observable<OnboardingState> {
        const docRef = doc(this.firestore, 'Settings', 'onboarding_status');
        return from(getDoc(docRef)).pipe(
            switchMap((snapshot): Observable<OnboardingState> => {
                if (snapshot.exists()) {
                    return of(snapshot.data()?.['completed'] === true ? 'complete' : 'in-progress');
                }
                return this.detectFirstRun();
            }),
            catchError(() => this.detectFirstRun()),
        );
    }

    /**
     * Fallback signal: is there an admin account yet?
     *
     * `defer` is load-bearing, not styling. This runs from inside a `catchError`,
     * i.e. after an async Firestore read has already rejected — and under SSR
     * that can be after the request's injector is gone. `isFirstRun()` opens with
     * `runInInjectionContext`, which throws NG0205 synchronously on a destroyed
     * injector, and a synchronous throw inside a `catchError` selector is not
     * catchable by the operators after it: RxJS reports it as an unhandled error,
     * which takes the SSR process down with it. Deferring moves the call inside
     * the subscription, where the throw becomes an ordinary error notification
     * that the `catchError` below turns into 'complete'.
     */
    private detectFirstRun(): Observable<OnboardingState> {
        return defer(() => this.authService.isFirstRun()).pipe(
            map((firstRun): OnboardingState => (firstRun ? 'first-run' : 'complete')),
            catchError(() => of<OnboardingState>('complete')),
        );
    }

    /**
     * Should this visitor be redirected into the wizard?
     * True for both `first-run` and `in-progress`.
     */
    shouldShowOnboarding(): Observable<boolean> {
        return this.getOnboardingState().pipe(map((state) => state !== 'complete'));
    }
}
