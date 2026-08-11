import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    Firestore, collection, collectionData, doc, addDoc, setDoc, serverTimestamp, query, orderBy,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, catchError, of } from 'rxjs';
import { dedupeTemplatesByType } from '../../../../shared/utils/template-dedupe';
import { buildNewEmailTemplate, NewEmailMeta } from '../../../../shared/email-compiler/new-template';

export interface DripStep { id: string; templateId: string; delayHours: number; }

export interface DripCampaign {
    id: string;
    name: string;
    listId: string;
    status: 'draft' | 'active' | 'paused' | 'archived';
    trigger: 'list_join';
    enrollExistingOnActivate?: boolean;
    steps?: DripStep[];
    counts?: { enrolled?: number; completed?: number; exited?: number };
}

export interface TemplateOption { id: string; label: string; }

/** Admin data access for drip campaigns (Phase 7). */
@Injectable({ providedIn: 'root' })
export class DripService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private platformId = inject(PLATFORM_ID);

    watchCampaigns(): Observable<DripCampaign[]> {
        // Admin-only Firestore rules; SSR has no authenticated user, so skip
        // the doomed request instead of letting it fail with permission-denied.
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'DripCampaigns');
        return (collectionData(query(ref, orderBy('name')), { idField: 'id' }) as Observable<DripCampaign[]>).pipe(
            catchError((err) => {
                console.error('Error fetching drip campaigns:', err);
                return of([]);
            }),
        );
    }

    watchTemplates(): Observable<TemplateOption[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'EmailTemplate');
        return new Observable<TemplateOption[]>((sub) => {
            const inner = collectionData(ref, { idField: 'id' }).subscribe({
                next: (docs: any[]) => {
                    sub.next(dedupeTemplatesByType(docs).map((d) => ({ id: d.id, label: d.title || d.type || d.id })));
                },
                error: (err) => {
                    console.error('Error fetching email templates:', err);
                    sub.next([]);
                },
            });
            return () => inner.unsubscribe();
        });
    }

    async createCampaign(name: string, listId: string, enrollExistingOnActivate: boolean): Promise<string> {
        const ref = await addDoc(collection(this.firestore, 'DripCampaigns'), {
            name, listId, status: 'draft', trigger: 'list_join',
            enrollExistingOnActivate,
            steps: [],
            exit: { onListLeave: true, onUnsubscribe: true },
            counts: { enrolled: 0, completed: 0, exited: 0 },
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        return ref.id;
    }

    /**
     * Create a new `EmailTemplate` from the drip drawer so an admin can author a
     * step's email without leaving the campaign. Produces a starter template
     * (compiled with the default brand kit) whose content can be refined later
     * in the Email Composer. Returns the new doc id to assign to the step.
     */
    async createTemplate(meta: NewEmailMeta): Promise<string> {
        const payload = buildNewEmailTemplate(meta, Date.now());
        const ref = await addDoc(collection(this.firestore, 'EmailTemplate'), {
            ...payload,
            createdAt: serverTimestamp(),
            modifiedAt: serverTimestamp(),
            modifiedBy: 'admin',
        });
        return ref.id;
    }

    async saveSteps(id: string, steps: DripStep[]): Promise<void> {
        await setDoc(doc(this.firestore, 'DripCampaigns', id), { steps, updatedAt: serverTimestamp() }, { merge: true });
    }

    /** Edit campaign metadata (name, enroll-existing flag). List/trigger are immutable post-create. */
    async updateCampaign(id: string, patch: { name?: string; enrollExistingOnActivate?: boolean }): Promise<void> {
        await setDoc(doc(this.firestore, 'DripCampaigns', id), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
    }

    /** Pause/resume/draft — simple status writes (activate/archive go through callables). */
    async setStatus(id: string, status: 'draft' | 'paused' | 'active'): Promise<void> {
        await setDoc(doc(this.firestore, 'DripCampaigns', id), { status, updatedAt: serverTimestamp() }, { merge: true });
    }

    activate(campaignId: string) {
        return httpsCallable(this.functions, 'activateDripCampaign')({ campaignId });
    }

    archive(campaignId: string) {
        return httpsCallable(this.functions, 'archiveDripCampaign')({ campaignId });
    }
}
