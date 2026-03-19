import { inject, Injectable } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, serverTimestamp, onSnapshot } from '@angular/fire/firestore';
import { from, map, Observable, of, catchError, BehaviorSubject } from 'rxjs';
import { DEFAULT_GLOBAL_MESSAGE_SETTINGS, IGlobalMessageSettings } from './global-message.model';

const SETTINGS_COLLECTION = 'Settings';
const GLOBAL_MESSAGE_DOC = 'global-message';

@Injectable({
    providedIn: 'root',
})
export class GlobalMessageService {
    private firestore = inject(Firestore);

    /** Real-time settings subject for the banner component */
    private settingsSubject = new BehaviorSubject<IGlobalMessageSettings>(DEFAULT_GLOBAL_MESSAGE_SETTINGS);
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
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, GLOBAL_MESSAGE_DOC);

        this.unsubscribeSnapshot = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data() as IGlobalMessageSettings;
                this.settingsSubject.next({ ...data, id: snapshot.id });
            } else {
                this.settingsSubject.next({ ...DEFAULT_GLOBAL_MESSAGE_SETTINGS });
            }
        }, (error) => {
            console.error('Error listening to global message settings:', error);
            this.settingsSubject.next({ ...DEFAULT_GLOBAL_MESSAGE_SETTINGS });
        });
    }

    /**
     * Fetch global message settings from Firestore (one-time fetch)
     */
    getSettings(): Observable<IGlobalMessageSettings> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, GLOBAL_MESSAGE_DOC);
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as IGlobalMessageSettings;
                    return { ...data, id: snapshot.id };
                }
                return { ...DEFAULT_GLOBAL_MESSAGE_SETTINGS };
            }),
            catchError((error) => {
                console.error('Error fetching global message settings:', error);
                return of({ ...DEFAULT_GLOBAL_MESSAGE_SETTINGS });
            })
        );
    }

    /**
     * Save global message settings to Firestore
     */
    async saveSettings(settings: IGlobalMessageSettings): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, GLOBAL_MESSAGE_DOC);
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
     * Cleanup real-time listener
     */
    ngOnDestroy(): void {
        if (this.unsubscribeSnapshot) {
            this.unsubscribeSnapshot();
        }
    }
}
