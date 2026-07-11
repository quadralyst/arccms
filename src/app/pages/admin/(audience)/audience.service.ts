import { inject, Injectable } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    setDoc,
    deleteDoc,
    serverTimestamp,
    query,
    orderBy,
    limit,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable } from 'rxjs';
import { IContact, IList, ICsvPreview, MarketingConsent } from './audience.model';

/**
 * Admin data access for the unified audience layer (Phase 3).
 *
 * Reads Contacts/Lists directly (admins have read access); all Contact
 * mutations go through Cloud Functions because Firestore rules make Contacts
 * functions-only. Lists are admin-writable, so manual list CRUD is direct.
 */
@Injectable({ providedIn: 'root' })
export class AudienceService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);

    /** Live list of Lists. */
    getLists(): Observable<IList[]> {
        const ref = collection(this.firestore, 'Lists');
        return collectionData(query(ref, orderBy('name')), { idField: 'id' }) as Observable<IList[]>;
    }

    /** Live (capped) list of Contacts for the admin table. */
    getContacts(max = 500): Observable<IContact[]> {
        const ref = collection(this.firestore, 'Contacts');
        return collectionData(query(ref, orderBy('updatedAt', 'desc'), limit(max)), {
            idField: 'id',
        }) as Observable<IContact[]>;
    }

    /** Create a manual list (admins may write Lists directly). */
    async createList(name: string, description = ''): Promise<void> {
        const ref = doc(collection(this.firestore, 'Lists'));
        await setDoc(ref, {
            id: ref.id,
            name,
            description,
            type: 'manual',
            memberCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    }

    /** Delete a manual list (system lists must not be deleted). */
    async deleteList(id: string): Promise<void> {
        await deleteDoc(doc(this.firestore, 'Lists', id));
    }

    // ── Cloud Function mutations ──

    backfillContacts() {
        return httpsCallable(this.functions, 'backfillContacts')({});
    }

    previewCsv(csvText: string) {
        return httpsCallable<{ csvText: string }, ICsvPreview>(this.functions, 'previewContactImport')({ csvText });
    }

    importContacts(rows: Array<{ email: string; name?: string }>, listId: string, consentAffirmed: boolean) {
        return httpsCallable(this.functions, 'importContacts')({ rows, listId, consentAffirmed });
    }

    addContact(email: string, name: string, listIds: string[], consentAffirmed: boolean) {
        return httpsCallable(this.functions, 'adminAddContact')({ email, name, listIds, consentAffirmed });
    }

    setConsent(emailHash: string, marketing: MarketingConsent) {
        return httpsCallable(this.functions, 'adminSetContactConsent')({ emailHash, marketing });
    }

    updateContactLists(emailHash: string, add: string[], remove: string[]) {
        return httpsCallable(this.functions, 'adminUpdateContactLists')({ emailHash, add, remove });
    }
}
