import { inject, Injectable } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, serverTimestamp, onSnapshot } from '@angular/fire/firestore';
import { from, map, Observable, of, catchError, BehaviorSubject } from 'rxjs';
import { DEFAULT_SITE_USAGE_SETTINGS, ISiteUsageSettings, SITE_USAGE_STORAGE_KEY, SiteUsageState } from './site-usage.model';

const SETTINGS_COLLECTION = 'Settings';
const SITE_USAGE_DOC = 'site-usage';

@Injectable({
    providedIn: 'root',
})
export class SiteUsageService {
    private firestore = inject(Firestore);

    /** Real-time settings subject for the banner component */
    private settingsSubject = new BehaviorSubject<ISiteUsageSettings>(DEFAULT_SITE_USAGE_SETTINGS);
    public settings$ = this.settingsSubject.asObservable();

    private unsubscribeSnapshot: (() => void) | null = null;

    constructor() {
        this.initRealtimeListener();
    }

    /**
     * Initialize real-time listener for settings changes
     * This allows the banner to update immediately when admin changes settings
     */
    private initRealtimeListener(): void {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, SITE_USAGE_DOC);

        this.unsubscribeSnapshot = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data() as ISiteUsageSettings;
                this.settingsSubject.next({ ...data, id: snapshot.id });
            } else {
                this.settingsSubject.next({ ...DEFAULT_SITE_USAGE_SETTINGS });
            }
        }, (error) => {
            console.error('SiteUsageService: Error listening to settings:', error);
            this.settingsSubject.next({ ...DEFAULT_SITE_USAGE_SETTINGS });
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
        }
    }
}
