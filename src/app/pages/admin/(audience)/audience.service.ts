import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    docData,
    setDoc,
    deleteDoc,
    serverTimestamp,
    query,
    orderBy,
    where,
    limit,
    getCountFromServer,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, catchError, map, of } from 'rxjs';
import { IContact, IList, ITag, IContactField, ICsvPreview, MarketingConsent, tagIdFromLabel } from './audience.model';

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

    // ── Custom contact fields (U4.5) ──

    /** Live field registry, as an array for tables and pickers. */
    getFields(): Observable<IContactField[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        return (docData(doc(this.firestore, 'Settings', 'contact_fields')) as Observable<{ fields?: Record<string, IContactField> }>).pipe(
            map((d) => Object.values(d?.fields || {})),
            catchError((err) => {
                console.error('Error fetching contact fields:', err);
                return of([] as IContactField[]);
            }),
        );
    }

    upsertField(def: Partial<IContactField> & { label: string }) {
        return httpsCallable<unknown, { ok: boolean; key: string }>(this.functions, 'adminUpsertContactField')(def);
    }

    deleteField(key: string) {
        return httpsCallable(this.functions, 'adminDeleteContactField')({ key });
    }

    /** Set field values on one contact (admin edits bypass the fill policy). */
    setContactFields(emailHash: string, values: Record<string, unknown>) {
        return httpsCallable(this.functions, 'adminSetContactFields')({ emailHash, values });
    }

    /** Lift historical formData onto contact fields (U4.5 runbook step 9). */
    migrateFormDataToContactFields(dryRun = false) {
        return httpsCallable<unknown, {
            forms: number; membersScanned: number; contactsUpdated: number;
            valuesWritten: number; membersWithoutContact: number;
            conflicts: string[]; unmappedForms: string[];
        }>(this.functions, 'migrateFormDataToContactFields')({ dryRun });
    }

    // ── Dashboard counts (U4) ──
    // Server-side aggregates so the dashboard never pages documents just to count
    // them. All are single-field queries, served by automatic indexes.

    /** Total contacts — the whole audience, whatever its source. */
    async countContacts(): Promise<number> {
        if (!isPlatformBrowser(this.platformId)) return 0;
        const snap = await getCountFromServer(collection(this.firestore, 'Contacts'));
        return snap.data().count;
    }

    /** Contacts created on/after `since`. */
    async countContactsSince(since: Date): Promise<number> {
        if (!isPlatformBrowser(this.platformId)) return 0;
        const q = query(collection(this.firestore, 'Contacts'), where('createdAt', '>=', since));
        const snap = await getCountFromServer(q);
        return snap.data().count;
    }

    /** Contacts in a given consent state — `subscribed` is the mailable audience. */
    async countContactsByConsent(consent: MarketingConsent): Promise<number> {
        if (!isPlatformBrowser(this.platformId)) return 0;
        const q = query(collection(this.firestore, 'Contacts'), where('consent.marketing', '==', consent));
        const snap = await getCountFromServer(q);
        return snap.data().count;
    }

    /** Most recently created contacts, for the dashboard's recent-signups table. */
    getRecentContacts(max = 7): Observable<IContact[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'Contacts');
        return (collectionData(query(ref, orderBy('createdAt', 'desc'), limit(max)), { idField: 'id' }) as Observable<IContact[]>).pipe(
            catchError((err) => {
                console.error('Error fetching recent contacts:', err);
                return of([]);
            }),
        );
    }

    /** Live single list (for the List hub). */
    getList(listId: string): Observable<IList | null> {
        if (!isPlatformBrowser(this.platformId)) {
            return of(null);
        }
        return (docData(doc(this.firestore, 'Lists', listId), { idField: 'id' }) as Observable<IList>).pipe(
            catchError((err) => {
                console.error('Error fetching list:', err);
                return of(null);
            }),
        );
    }

    /**
     * Live members of one list. Served by the automatic single-field index on
     * `listIds` — no composite index needed.
     */
    getContactsInList(listId: string, max = 500): Observable<IContact[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'Contacts');
        return (collectionData(
            query(ref, where('listIds', 'array-contains', listId), limit(max)),
            { idField: 'id' },
        ) as Observable<IContact[]>).pipe(
            catchError((err) => {
                console.error('Error fetching list members:', err);
                return of([]);
            }),
        );
    }

    /**
     * Switch a contact's email off or back on (U-D12). The sanctioned way to stop
     * emailing someone whose list membership is form-derived and therefore
     * read-only.
     */
    setContactDisabled(emailHash: string, disabled: boolean) {
        return httpsCallable(this.functions, 'adminSetContactDisabled')({ emailHash, disabled });
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

    // ── Global contact tags (`ContactTags`) ──

    /** Live list of audience tags. */
    getTags(): Observable<ITag[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'ContactTags');
        return (collectionData(query(ref, orderBy('label')), { idField: 'id' }) as Observable<ITag[]>).pipe(
            catchError((err) => {
                console.error('Error fetching tags:', err);
                return of([]);
            }),
        );
    }

    /**
     * Create a tag. The doc id is a slug of the label — the same rule the
     * backend uses — so two admins adding "VIP" get one tag, not two.
     * Returns null when the label has nothing sluggable (e.g. "!!!").
     */
    async createTag(label: string, color: string): Promise<string | null> {
        const id = tagIdFromLabel(label);
        if (!id) return null;
        await setDoc(
            doc(this.firestore, 'ContactTags', id),
            {
                id,
                label: label.trim(),
                color,
                usageCount: 0,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            },
            // merge so re-adding an existing label edits it rather than
            // resetting its usageCount to 0.
            { merge: true },
        );
        return id;
    }

    /** Edit a tag's label/color. The id (slug) stays put so assignments survive. */
    async updateTag(id: string, patch: { label?: string; color?: string }): Promise<void> {
        await setDoc(
            doc(this.firestore, 'ContactTags', id),
            { ...patch, updatedAt: serverTimestamp() },
            { merge: true },
        );
    }

    async deleteTag(id: string): Promise<void> {
        await deleteDoc(doc(this.firestore, 'ContactTags', id));
    }

    /** Replace a contact's tags (Contacts are functions-only writes). */
    setContactTags(emailHash: string, tagIds: string[]) {
        return httpsCallable(this.functions, 'adminSetContactTags')({ emailHash, tagIds });
    }

    /** Lift per-waitlist tags into the global layer (U2 runbook step 5). */
    migrateTagsToContacts(dryRun = false) {
        return httpsCallable(this.functions, 'migrateTagsToContacts')({ dryRun });
    }

    // ── Cloud Function mutations ──

    backfillContacts() {
        return httpsCallable(this.functions, 'backfillContacts')({});
    }

    /**
     * Give historical unverified form signups a `pending` contact (U2 runbook
     * step 4). Always run after {@link backfillContacts}, which owns the
     * verified members and app users.
     */
    backfillPendingContacts(dryRun = false) {
        return httpsCallable<unknown, { forms: number; scanned: number; created: number; existing: number }>(
            this.functions, 'backfillPendingContacts',
        )({ dryRun });
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
