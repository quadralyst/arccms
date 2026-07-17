import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
import { Observable, catchError, of } from 'rxjs';
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
    private platformId = inject(PLATFORM_ID);

    /** Live list of Lists. */
    getLists(): Observable<IList[]> {
        // Admin-only Firestore rules; SSR has no authenticated user, so skip
        // the doomed request instead of letting it fail with permission-denied.
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'Lists');
        return (collectionData(query(ref, orderBy('name')), { idField: 'id' }) as Observable<IList[]>).pipe(
            catchError((err) => {
                console.error('Error fetching lists:', err);
                return of([]);
            }),
        );
    }

    /** Live (capped) list of Contacts for the admin table. */
    getContacts(max = 500): Observable<IContact[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'Contacts');
        return (collectionData(query(ref, orderBy('updatedAt', 'desc'), limit(max)), {
            idField: 'id',
        }) as Observable<IContact[]>).pipe(
            catchError((err) => {
                console.error('Error fetching contacts:', err);
                return of([]);
            }),
        );
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

    /** Rename / re-describe a manual list (admins may write Lists directly). */
    async updateList(id: string, patch: { name?: string; description?: string }): Promise<void> {
        await setDoc(
            doc(this.firestore, 'Lists', id),
            { ...patch, updatedAt: serverTimestamp() },
            { merge: true },
        );
    }

    /** Delete a manual list (system lists must not be deleted). */
    async deleteList(id: string): Promise<void> {
        await deleteDoc(doc(this.firestore, 'Lists', id));
    }

    // ── Cloud Function mutations ──

    backfillContacts() {
        return httpsCallable(this.functions, 'backfillContacts')({});
    }

    /** Give every existing signup form its mirrored list (U1 runbook step 2). */
    backfillFormLists() {
        return httpsCallable<unknown, { forms: number; created: number; repaired: number; errors: string[] }>(
            this.functions, 'backfillFormLists',
        )({});
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
