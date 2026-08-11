import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    Firestore, collection, collectionData, addDoc, doc, updateDoc, getDoc, serverTimestamp, query, orderBy, limit, Timestamp,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, catchError, of } from 'rxjs';

export interface BroadcastAudience {
    /** Legacy single-target shape, still present on pre-U4 docs. */
    kind?: 'list' | 'waitlist';
    listId?: string;
    waitlistId?: string;
    /** Lists to send to (U4). Unioned, then de-duplicated per contact. */
    include?: string[];
    /** Lists to subtract from that union. */
    exclude?: string[];
    filters?: Array<{ field: 'premiumType' | 'source' | 'createdAfter'; op: '==' | '>='; value: any }>;
}

/** Every list an audience targets — mirrors `audienceListIds` on the server. */
export function audienceListIds(audience?: BroadcastAudience): string[] {
    if (!audience) return [];
    const ids = [...(audience.include || [])];
    if (audience.kind === 'list' && audience.listId) ids.push(audience.listId);
    if (audience.kind === 'waitlist' && audience.waitlistId) ids.push(`waitlist-${audience.waitlistId}`);
    return [...new Set(ids.filter(Boolean))];
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
    /** Needed to filter history to a single list in the List hub (U4). */
    audience?: BroadcastAudience;
    /**
     * Legacy per-waitlist broadcasts carry only this — no `audience`. The List hub
     * matches on it too so history survives the composer's retirement.
     */
    waitlistId?: string;
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
