import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    Firestore, collection, collectionData, addDoc, doc, updateDoc, getDoc, serverTimestamp, query, orderBy, limit, Timestamp,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, catchError, of } from 'rxjs';

export interface BroadcastAudience {
    kind: 'list' | 'waitlist';
    listId?: string;
    waitlistId?: string;
    filters?: Array<{ field: 'premiumType' | 'source' | 'createdAfter'; op: '==' | '>='; value: any }>;
}

export interface BroadcastRow {
    id: string;
    subject: string;
    status: string;
    sentCount?: number;
    skippedCount?: number;
    failedCount?: number;
    scheduledAt?: Timestamp;
    createdAt?: Timestamp;
}

/** Broadcasts v2 admin data access (Phase 6). */
@Injectable({ providedIn: 'root' })
export class BroadcastService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private platformId = inject(PLATFORM_ID);

    previewAudience(audience: BroadcastAudience) {
        return httpsCallable<{ audience: BroadcastAudience }, { eligible: number; scanned: number; capped: boolean }>(
            this.functions, 'previewBroadcastAudience',
        )({ audience });
    }

    watchRecent(max = 20): Observable<BroadcastRow[]> {
        // Admin-only Firestore rules; SSR has no authenticated user, so skip
        // the doomed request instead of letting it fail with permission-denied.
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const ref = collection(this.firestore, 'BroadcastEmails');
        return (collectionData(query(ref, orderBy('createdAt', 'desc'), limit(max)), { idField: 'id' }) as Observable<BroadcastRow[]>).pipe(
            catchError((err) => {
                console.error('Error fetching recent broadcasts:', err);
                return of([]);
            }),
        );
    }

    private async senderIdentity(): Promise<{ senderName: string; senderEmail: string }> {
        const snap = await getDoc(doc(this.firestore, 'Settings', 'email'));
        const s = snap.data() || {};
        return { senderName: s['senderName'] || 'Arc CMS', senderEmail: s['senderEmail'] || '' };
    }

    /** Create a broadcast (queued now, or scheduled for later). */
    async createBroadcast(params: {
        subject: string;
        html: string;
        previewText?: string;
        audience: BroadcastAudience;
        scheduledAt?: Date | null;
    }): Promise<string> {
        const sender = await this.senderIdentity();
        const scheduled = params.scheduledAt && params.scheduledAt.getTime() > Date.now();
        const docData: any = {
            waitlistId: '',
            subject: params.subject,
            previewText: params.previewText || '',
            template: params.html,
            senderName: sender.senderName,
            senderEmail: sender.senderEmail,
            audience: params.audience,
            recipients: [],
            totalCount: 0,
            sentCount: 0,
            failedCount: 0,
            skippedCount: 0,
            processedIndex: 0,
            chunkNumber: 0,
            status: scheduled ? 'scheduled' : 'queued',
            createdAt: serverTimestamp(),
        };
        if (scheduled) docData.scheduledAt = Timestamp.fromDate(params.scheduledAt!);
        const ref = await addDoc(collection(this.firestore, 'BroadcastEmails'), docData);
        return ref.id;
    }

    /** Cancel a scheduled broadcast before it's due. */
    async cancel(id: string): Promise<void> {
        await updateDoc(doc(this.firestore, 'BroadcastEmails', id), { status: 'cancelled', updatedAt: serverTimestamp() });
    }
}
