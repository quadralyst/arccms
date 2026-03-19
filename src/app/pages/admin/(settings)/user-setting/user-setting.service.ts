import { inject, Injectable } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, serverTimestamp, onSnapshot } from '@angular/fire/firestore';
import { BehaviorSubject, from, map, Observable, of, catchError } from 'rxjs';
import { DEFAULT_USER_SETTINGS, IUserSettings } from './user-setting.model';

const SETTINGS_COLLECTION = 'Settings';
const USER_SETTINGS_DOC = 'users';

@Injectable({
    providedIn: 'root',
})
export class UserSettingService {
    private firestore = inject(Firestore);

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
     */
    private initRealtimeListener(): void {
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
        }
    }
}
