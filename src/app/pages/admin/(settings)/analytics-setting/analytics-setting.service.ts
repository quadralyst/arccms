import { inject, Injectable } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { from, map, Observable, of, catchError } from 'rxjs';
import { DEFAULT_ANALYTICS_SETTINGS, IAnalyticsSettings } from './analytics-setting.model';

const SETTINGS_COLLECTION = 'Settings';
const ANALYTICS_DOC = 'analytics';

@Injectable({
    providedIn: 'root',
})
export class AnalyticsSettingService {
    private firestore = inject(Firestore);

    /**
     * Fetch analytics settings from Firestore (Settings/analytics)
     * Only returns the OAuth client credentials — tokens are not exposed to the frontend.
     */
    getAnalyticsSettings(): Observable<IAnalyticsSettings> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, ANALYTICS_DOC);
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    return {
                        id: snapshot.id,
                        oauth: {
                            clientId: data['oauth']?.clientId || '',
                            // Never read the actual secret back — only indicate if one is set
                            clientSecret: data['oauth']?.clientSecret ? '••••••••' : '',
                        },
                        isConnected: data['isConnected'] || false,
                    };
                }
                return { ...DEFAULT_ANALYTICS_SETTINGS };
            }),
            catchError((error) => {
                console.error('Error fetching analytics settings:', error);
                return of({ ...DEFAULT_ANALYTICS_SETTINGS });
            }),
        );
    }

    /**
     * Save OAuth client credentials to Firestore (Settings/analytics)
     * Uses merge to avoid overwriting token data stored by cloud functions.
     */
    async saveAnalyticsSettings(settings: IAnalyticsSettings): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, ANALYTICS_DOC);

        // Build nested oauth object — setDoc+merge requires nested objects, not dot-notation keys
        const oauthData: Record<string, string> = {
            clientId: settings.oauth.clientId,
        };

        // Only save clientSecret if the user entered a new value (not the masked placeholder)
        if (settings.oauth.clientSecret && settings.oauth.clientSecret !== '••••••••') {
            oauthData['clientSecret'] = settings.oauth.clientSecret;
        }

        const dataToSave: Record<string, any> = {
            oauth: oauthData,
            updatedAt: serverTimestamp(),
        };

        // Set createdAt only when creating the document for the first time
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) {
            dataToSave['createdAt'] = serverTimestamp();
        }

        await setDoc(docRef, dataToSave, { merge: true });
    }
}
