import { inject, Injectable } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { from, map, Observable, of, catchError } from 'rxjs';
import { DEFAULT_INTEGRATIONS_SETTINGS, IIntegrationsSettings } from './integrations-setting.model';

const SETTINGS_COLLECTION = 'Settings';
const INTEGRATIONS_DOC = 'integrations';

@Injectable({
    providedIn: 'root',
})
export class IntegrationsSettingService {
    private firestore = inject(Firestore);

    /**
     * Fetch integrations settings from Firestore (Settings/integrations)
     */
    getIntegrationsSettings(): Observable<IIntegrationsSettings> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, INTEGRATIONS_DOC);
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as IIntegrationsSettings;
                    return { ...data, id: snapshot.id };
                }
                return { ...DEFAULT_INTEGRATIONS_SETTINGS };
            }),
            catchError((error) => {
                console.error('Error fetching integrations settings:', error);
                return of({ ...DEFAULT_INTEGRATIONS_SETTINGS });
            })
        );
    }

    /**
     * Save integrations settings to Firestore (Settings/integrations)
     */
    async saveIntegrationsSettings(settings: IIntegrationsSettings): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, INTEGRATIONS_DOC);
        const dataToSave: any = {
            ...settings,
            updatedAt: serverTimestamp(),
        };

        // Remove id field — it's the document ID, not a Firestore field
        delete dataToSave.id;

        // Set createdAt only when creating the document for the first time
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) {
            dataToSave.createdAt = serverTimestamp();
        }

        await setDoc(docRef, dataToSave, { merge: true });
    }
}
