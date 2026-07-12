import { inject, Injectable } from '@angular/core';
import {
    Firestore, collection, collectionData, doc, addDoc, setDoc, serverTimestamp, query, orderBy,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable } from 'rxjs';

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

    watchCampaigns(): Observable<DripCampaign[]> {
        const ref = collection(this.firestore, 'DripCampaigns');
        return collectionData(query(ref, orderBy('name')), { idField: 'id' }) as Observable<DripCampaign[]>;
    }

    watchTemplates(): Observable<TemplateOption[]> {
        const ref = collection(this.firestore, 'EmailTemplate');
        return new Observable<TemplateOption[]>((sub) => {
            const inner = collectionData(ref, { idField: 'id' }).subscribe((docs: any[]) => {
                sub.next(docs.map((d) => ({ id: d.id, label: d.title || d.type || d.id })));
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

    async saveSteps(id: string, steps: DripStep[]): Promise<void> {
        await setDoc(doc(this.firestore, 'DripCampaigns', id), { steps, updatedAt: serverTimestamp() }, { merge: true });
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
