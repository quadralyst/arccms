import { inject, Injectable, OnDestroy, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, doc, getDoc, setDoc, serverTimestamp, onSnapshot } from '@angular/fire/firestore';
import { from, map, Observable, of, catchError, BehaviorSubject } from 'rxjs';
import { DEFAULT_SITE_USAGE_SETTINGS, ISiteUsageSettings, SITE_USAGE_STORAGE_KEY, SiteUsageState } from './site-usage.model';

const SETTINGS_COLLECTION = 'Settings';
const SITE_USAGE_DOC = 'site-usage';

@Injectable({
    providedIn: 'root',
})
export class SiteUsageService implements OnDestroy {
    private firestore = inject(Firestore);
    private platformId = inject(PLATFORM_ID);

    /** Real-time settings subject for the banner component */
    private settingsSubject = new BehaviorSubject<ISiteUsageSettings>(DEFAULT_SITE_USAGE_SETTINGS);
    public settings$ = this.settingsSubject.asObservable();

    private unsubscribeSnapshot: (() => void) | null = null;

    private readonly choice = signal<SiteUsageState>('pending');
    /** This visitor's answer on this device: `accepted`, `rejected` or `pending` (docs/features/analytics.html). */
    readonly consent = this.choice.asReadonly();

    private readonly bannerOn = signal(false);
    private readonly loaded = signal(false);
    /** Whether an admin turned the site usage banner on. False until the settings arrive. */
    readonly bannerEnabled = this.bannerOn.asReadonly();
    /** True once the settings have been read (or could not be), so `bannerEnabled` is the real answer. */
    readonly settingsLoaded = this.loaded.asReadonly();

    constructor() {
        this.choice.set(this.getUserConsentState());
        this.initRealtimeListener();
    }

    /**
     * Initialize real-time listener for settings changes
     * This allows the banner to update immediately when admin changes settings
     *
     * Never listens during SSR. @angular/fire captures the injector at
     * `onSnapshot` time and runs the callback inside it; the server tears the
     * request injector down once the response is rendered, but the listener
     * outlives it. The next snapshot — e.g. an admin toggling the banner — then
     * fires against a destroyed injector, and the resulting NG0205 surfaces on
     * a Firestore timer where nothing can catch it, killing the server process.
     * The banner is rendered from the root App component and injects this
     * service in a field initializer, so the guard in its `ngOnInit` comes too
     * late — the constructor has already run. `settingsSubject` is a
     * BehaviorSubject seeded with the defaults, so skipping the listener leaves
     * the server rendering exactly the default state.
     */
    private initRealtimeListener(): void {
        if (!isPlatformBrowser(this.platformId)) return;

        // Idempotent: never overwrite a live handle, which would orphan the
        // previous listener for the lifetime of the app.
        if (this.unsubscribeSnapshot) return;

        const docRef = doc(this.firestore, SETTINGS_COLLECTION, SITE_USAGE_DOC);

        this.unsubscribeSnapshot = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data() as ISiteUsageSettings;
                this.settingsSubject.next({ ...data, id: snapshot.id });
                this.bannerOn.set(data.isEnabled === true);
            } else {
                this.settingsSubject.next({ ...DEFAULT_SITE_USAGE_SETTINGS });
                this.bannerOn.set(false);
            }
            this.loaded.set(true);
        }, (error) => {
            console.error('SiteUsageService: Error listening to settings:', error);
            this.settingsSubject.next({ ...DEFAULT_SITE_USAGE_SETTINGS });
            this.bannerOn.set(false);
            this.loaded.set(true);
        });
    }

    /**
     * Fetch site usage settings from Firestore (one-time fetch)
     */
    getSettings(): Observable<ISiteUsageSettings> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, SITE_USAGE_DOC);
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as ISiteUsageSettings;
                    return { ...data, id: snapshot.id };
                }
                return { ...DEFAULT_SITE_USAGE_SETTINGS };
            }),
            catchError((error) => {
                console.error('Error fetching site usage settings:', error);
                return of({ ...DEFAULT_SITE_USAGE_SETTINGS });
            })
        );
    }

    /**
     * Save site usage settings to Firestore
     */
    async saveSettings(settings: ISiteUsageSettings): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, SITE_USAGE_DOC);
        const dataToSave = {
            ...settings,
            updatedAt: serverTimestamp(),
        };

        // Remove id field before saving (it's the document ID, not a field)
        delete dataToSave.id;

        // If this is a new document, set createdAt
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) {
            (dataToSave as any).createdAt = serverTimestamp();
        }

        await setDoc(docRef, dataToSave, { merge: true });
    }

    /**
     * Get the user's current consent state from localStorage
     */
    getUserConsentState(): SiteUsageState {
        try {
            if (typeof localStorage !== 'undefined') {
                const consent = localStorage.getItem(SITE_USAGE_STORAGE_KEY);
                if (consent === 'accepted' || consent === 'rejected') {
                    return consent as SiteUsageState;
                }
            }
        } catch {
            // localStorage not available (SSR or restricted context)
        }
        return 'pending';
    }

    /**
     * Save user's consent choice to localStorage
     */
    setUserConsentState(state: 'accepted' | 'rejected'): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(SITE_USAGE_STORAGE_KEY, state);
            }
        } catch {
            // localStorage not available (SSR or restricted context)
        }
        this.choice.set(state);
    }

    /**
     * Ask again: forgets this device's answer, so the banner shows on the next page
     * (when it is on). For a "Cookie settings" link (docs/features/analytics.html).
     */
    reopen(): void {
        try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(SITE_USAGE_STORAGE_KEY);
        } catch {
            // localStorage not available (SSR or restricted context)
        }
        this.choice.set('pending');
    }

    /**
     * Check if the banner should be shown
     * Shows only if enabled AND user hasn't made a choice yet
     */
    shouldShowBanner(settings: ISiteUsageSettings | null): boolean {
        if (!settings?.isEnabled) {
            return false;
        }
        return this.getUserConsentState() === 'pending';
    }

    /**
     * Cleanup real-time listener
     */
    ngOnDestroy(): void {
        if (this.unsubscribeSnapshot) {
            this.unsubscribeSnapshot();
            this.unsubscribeSnapshot = null;
        }
    }
}
