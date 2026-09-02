import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, map, Observable, of, catchError } from 'rxjs';
import {
    DEFAULT_EMAIL_SETTINGS,
    IConnectionTestPayload,
    IConnectionTestResult,
    IEmailSettings,
} from './email-setting.model';

const SETTINGS_COLLECTION = 'Settings';
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
     * Test the provider connection through the `testSmtpConfigConnection` callable,
     * which rejects unauthenticated requests and returns its verdict directly.
     *
     * This used to write the payload — provider credentials included — to
     * `Settings/emailTestingConnection` and poll the document for a Cloud Function
     * to write a status back. That persisted the SMTP password / Resend API key in
     * Firestore with nothing to clear them, so the callable is both safer and
     * simpler: no document, no polling, no stored secret.
     */
    async testEmailConnection(payload: IConnectionTestPayload): Promise<IConnectionTestResult> {
        const callable = runInInjectionContext(this.injector, () =>
            httpsCallable<IConnectionTestPayload, IConnectionTestResult>(
                this.functions,
                'testSmtpConfigConnection',
            ),
        );
        const response = await callable(payload);
        return {
            success: !!response.data?.success,
            message: response.data?.message || '',
        };
    }
}
