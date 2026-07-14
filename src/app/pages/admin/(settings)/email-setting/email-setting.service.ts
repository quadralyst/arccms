import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, serverTimestamp, collection, addDoc, docData } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { from, map, Observable, of, catchError } from 'rxjs';
import { DEFAULT_EMAIL_SETTINGS, IEmailSettings } from './email-setting.model';
import { DEFAULT_EMAIL_TESTING_CONFIG, IEmailTestingConfig } from './email-testing.model';

const SETTINGS_COLLECTION = 'Settings';
const EMAIL_TESTING_DOC = 'emailTestingConnection';
const EMAIL_SETTINGS_DOC = 'email';

@Injectable({
    providedIn: 'root',
})
export class EmailSettingService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private injector = inject(Injector);

    /**
     * Fetch email settings from Firestore
     */
    getEmailSettings(): Observable<IEmailSettings> {
        const docRef = runInInjectionContext(this.injector, () => doc(this.firestore, SETTINGS_COLLECTION, EMAIL_SETTINGS_DOC));
        return from(runInInjectionContext(this.injector, () => getDoc(docRef))).pipe(
            map((snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as IEmailSettings;
                    return { ...data, id: snapshot.id };
                }
                return { ...DEFAULT_EMAIL_SETTINGS };
            }),
            catchError((error) => {
                console.error('Error fetching email settings:', error);
                return of({ ...DEFAULT_EMAIL_SETTINGS });
            })
        );
    }

    /**
     * Save email settings to Firestore
     */
    async saveEmailSettings(settings: IEmailSettings): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, EMAIL_SETTINGS_DOC);
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

        // Sync the public-facing status document (no credentials). Mirrors the
        // signup-verification toggle so the pre-auth signup page can read it (E4).
        const statusDocRef = doc(this.firestore, SETTINGS_COLLECTION, 'email_status');
        await setDoc(
            statusDocRef,
            {
                isEnabled: settings.isEnabled,
                requireSignupVerification: settings.requireSignupVerification ?? false,
                // Public flag so the dashboard can warn when the simulated provider is active.
                debugMode: settings.activeProvider === 'debug_log',
            },
            { merge: true },
        );
    }

    /**
     * Test SMTP connection by triggering an update to the testing document
     */
    async testEmailConnection(config: any): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, EMAIL_TESTING_DOC);
        await setDoc(docRef, {
            ...config,
            status: 'processing',
            updatedAt: serverTimestamp(),
        }, { merge: false }); // merge: false so we clean out old test data completely
    }

    /**
     * Monitor the connection test document
     */
    monitorConnectionTest(): Observable<any> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, EMAIL_TESTING_DOC);
        return docData(docRef);
    }

    /**
     * Fetch email testing configuration from Firestore
     */
    getEmailTestingConfig(): Observable<IEmailTestingConfig> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, EMAIL_TESTING_DOC);
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as IEmailTestingConfig;
                    return { ...data, id: snapshot.id };
                }
                return { ...DEFAULT_EMAIL_TESTING_CONFIG };
            }),
            catchError((error) => {
                console.error('Error fetching email testing configuration:', error);
                return of({ ...DEFAULT_EMAIL_TESTING_CONFIG });
            })
        );
    }

    /**
     * Save email testing configuration to Firestore
     */
    async saveEmailTestingConfig(config: IEmailTestingConfig): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, EMAIL_TESTING_DOC);
        const dataToSave = {
            ...config,
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
}
