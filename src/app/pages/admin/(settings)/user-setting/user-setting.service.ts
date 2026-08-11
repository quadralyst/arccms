import { inject, Injectable, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, doc, getDoc, setDoc, serverTimestamp, onSnapshot } from '@angular/fire/firestore';
import { BehaviorSubject, from, map, Observable, of, catchError } from 'rxjs';
import { DEFAULT_USER_SETTINGS, IUserSettings } from './user-setting.model';

const SETTINGS_COLLECTION = 'Settings';
const USER_SETTINGS_DOC = 'users';

@Injectable({
    providedIn: 'root',
})
export class UserSettingService implements OnDestroy {
    private firestore = inject(Firestore);
    private platformId = inject(PLATFORM_ID);

    /** Real-time settings subject for components that need live updates */
    private settingsSubject = new BehaviorSubject<IUserSettings>(DEFAULT_USER_SETTINGS);
    public settings$ = this.settingsSubject.asObservable();

    private unsubscribe: (() => void) | null = null;

    constructor() {
        this.initRealtimeListener();
    }

    /**
     * Initialize real-time listener for settings changes
     * This allows components to receive updates immediately when admin changes settings
     *
     * Never listens during SSR. @angular/fire captures the injector at
     * `onSnapshot` time and runs the callback inside it; the server tears the
     * request injector down once the response is rendered, but the listener
     * outlives it. The next snapshot — e.g. an admin changing the default role —
     * then fires against a destroyed injector, and the resulting NG0205 surfaces
     * on a Firestore timer where nothing can catch it, killing the server
     * process. Only lazy routes inject this service today, but both call sites
     * (signup and the settings page) do so in a field initializer, so this would
     * arm the moment either route is server-rendered. `settingsSubject` is a
     * BehaviorSubject seeded with the defaults, so skipping the listener leaves
     * `isSignupEnabled()` / `getDefaultRole()` on their defaults server-side.
     */
    private initRealtimeListener(): void {
        if (!isPlatformBrowser(this.platformId)) return;

        // Idempotent: never overwrite a live handle, which would orphan the
        // previous listener for the lifetime of the app.
        if (this.unsubscribe) return;

        const docRef = doc(this.firestore, SETTINGS_COLLECTION, USER_SETTINGS_DOC);
        this.unsubscribe = onSnapshot(
            docRef,
            (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as IUserSettings;
                    this.settingsSubject.next({ ...data, id: snapshot.id });
                } else {
                    this.settingsSubject.next({ ...DEFAULT_USER_SETTINGS });
                }
            },
            (error) => {
                console.error('UserSettingService: Error listening to settings:', error);
                this.settingsSubject.next({ ...DEFAULT_USER_SETTINGS });
            }
        );
    }

    /**
     * Fetch user settings from Firestore (one-time fetch)
     */
    getSettings(): Observable<IUserSettings> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, USER_SETTINGS_DOC);
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as IUserSettings;
                    return { ...data, id: snapshot.id };
                }
                return { ...DEFAULT_USER_SETTINGS };
            }),
            catchError((error) => {
                console.error('Error fetching user settings:', error);
                return of({ ...DEFAULT_USER_SETTINGS });
            })
        );
    }

    /**
     * Save user settings to Firestore
     */
    async saveSettings(settings: IUserSettings): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, USER_SETTINGS_DOC);
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
     * Quick check if signups are enabled (returns current cached value)
     */
    isSignupEnabled(): boolean {
        return this.settingsSubject.getValue().isSignupEnabled;
    }

    /**
     * Get the default role for new signups
     */
    getDefaultRole(): string {
        return this.settingsSubject.getValue().defaultRole || 'user';
    }

    ngOnDestroy(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }
}
