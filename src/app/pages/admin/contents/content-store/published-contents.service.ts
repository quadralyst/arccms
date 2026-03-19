import { Injectable } from '@angular/core';
import { DbService } from '../../../../../shared/services/db.service';
import { IContents } from './published-contents.model';
import { CollectionReference, collection, doc, onSnapshot, query, orderBy, limit, getDocs } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

export interface DeployStatusUpdate {
    deployStatus: 'deployed' | 'failed' | 'pending' | null;
    deployError: string;
    deployErrorCode: string;
    deployedAt: Date | null;
    deployedUrl: string;
    deployDurationMs: number;
}

@Injectable({
    providedIn: 'root'
})
export class ContentsService extends DbService<IContents> {

    constructor() {
        super('Contents');
    }

    override getCollectionRef(collectionSuffix?: string): CollectionReference<IContents> {
        if (collectionSuffix) {
            return collection(this.firestore, `arc_${collectionSuffix}`) as CollectionReference<IContents>;
        }
        return super.getCollectionRef();
    }

    /**
     * Polls a published document for deployment status changes.
     *
     * Uses Firestore onSnapshot listener on the published collection document.
     * Automatically completes after:
     *  - deployStatus changes to 'deployed' or 'failed'
     *  - 60 seconds timeout (emits { deployStatus: null } as timeout signal)
     *
     * @param docId - The document ID to watch
     * @param contentTypeSlug - The content type slug (determines the collection)
     * @returns Observable that emits DeployStatusUpdate on each change
     */
    pollDeployStatus(docId: string, contentTypeSlug: string): Observable<DeployStatusUpdate> {
        return new Observable<DeployStatusUpdate>(subscriber => {
            const collectionName = `arc_${contentTypeSlug}`;
            const docRef = doc(this.firestore, collectionName, docId);

            // Timeout after 60 seconds
            const timeoutId = setTimeout(() => {
                subscriber.next({
                    deployStatus: null,
                    deployError: 'Deployment status check timed out after 60 seconds.',
                    deployErrorCode: 'TIMEOUT',
                    deployedAt: null,
                    deployedUrl: '',
                    deployDurationMs: 0,
                });
                subscriber.complete();
                unsubscribe();
            }, 60_000);

            const unsubscribe = onSnapshot(docRef, (snap) => {
                if (!snap.exists()) return;
                const data = snap.data() as Partial<IContents>;

                const status: DeployStatusUpdate = {
                    deployStatus: (data.deployStatus as DeployStatusUpdate['deployStatus']) || null,
                    deployError: (data as any).deployError || '',
                    deployErrorCode: (data as any).deployErrorCode || '',
                    deployedAt: (data as any).deployedAt?.toDate?.() || (data as any).deployedAt || null,
                    deployedUrl: (data as any).deployedUrl || '',
                    deployDurationMs: (data as any).deployDurationMs || 0,
                };

                subscriber.next(status);

                // Auto-complete when we reach a terminal state
                if (status.deployStatus === 'deployed' || status.deployStatus === 'failed') {
                    clearTimeout(timeoutId);
                    subscriber.complete();
                    unsubscribe();
                }
            }, (error) => {
                clearTimeout(timeoutId);
                subscriber.error(error);
            });

            // Cleanup on unsubscribe
            return () => {
                clearTimeout(timeoutId);
                unsubscribe();
            };
        });
    }

    /**
     * Fetches the published history (version snapshots) for a content item.
     *
     * Queries the `PublishedHistory` subcollection under the published document.
     * Returns up to 20 most recent versions, ordered by publishedOn descending.
     *
     * @param docId - The published document ID
     * @param contentTypeSlug - The content type slug
     * @returns Observable of history items array
     */
    getPublishedHistory(docId: string, contentTypeSlug: string): Observable<any[]> {
        const collectionName = `arc_${contentTypeSlug}`;
        const historyRef = collection(this.firestore, collectionName, docId, 'PublishedHistory');
        const q = query(historyRef, orderBy('publishedOn', 'desc'), limit(20));

        return from(getDocs(q)).pipe(
            map(snap => snap.docs.map((d, index) => ({
                historyId: d.id,
                versionNumber: snap.docs.length - index, // v1 = oldest, vN = newest
                ...d.data(),
            }))),
        );
    }
}
