import { inject, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { DbService } from '../../../../shared/services/db.service';
import { IMediaManager } from './media-manager.model';
import { collection, doc, Firestore, getCountFromServer, getDoc, limit, onSnapshot, orderBy, query, startAfter } from '@angular/fire/firestore';
import { DocumentSnapshot } from '@angular/fire/firestore';
import { from, map, Observable, switchMap, take } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class MediaManagerService extends DbService<IMediaManager> {
    private db = inject(Firestore);
    private functions = inject(Functions);

    private searchUnsplashFn = httpsCallable(this.functions, 'searchUnsplash');

    constructor() {
        super('media');
    }

    /**
     * Search Unsplash via Cloud Function proxy.
     * The API key is stored server-side in Firestore Settings/integrations.
     */
    getImagesFromUnsplash(query: string, page: number): Promise<any> {
        return this.searchUnsplashFn({ query, page })
            .then((result: any) => result.data)
            .catch((err: any) => {
                console.error('Error while retrieving images from Unsplash', err);
                throw err;
            });
    }

    /**
     * Check whether the Unsplash access key is configured in Settings/integrations.
     * Returns true if a non-empty accessKey exists.
     */
    async isUnsplashConfigured(): Promise<boolean> {
        try {
            const docRef = doc(this.db, 'Settings', 'integrations');
            const snapshot = await getDoc(docRef);
            if (!snapshot.exists()) return false;
            const data = snapshot.data();
            return !!data?.['unsplash']?.['accessKey'];
        } catch {
            return false;
        }
    }

    /**
     * Send a warmup ping to pre-warm the searchUnsplash Cloud Function.
     * Call this when the search panel opens to reduce cold-start latency.
     */
    warmupUnsplash(): void {
        this.searchUnsplashFn({ warmup: true }).catch(() => {
            // Warmup failures are non-critical — silently ignore
        });
    }

    getMediaListFromFirestore(pageSize: number, startAfterDoc?: DocumentSnapshot): Observable<any> {
        const db = this.db;
        const mediaCollection = collection(db, 'media');

        let q = query(mediaCollection, orderBy('uploadTime', 'desc'), limit(pageSize));

        if (startAfterDoc) {
            q = query(q, startAfter(startAfterDoc));
        }

        const changesObservable = new Observable<{ mediaList: any[], lastDoc: DocumentSnapshot | undefined }>(observer => {
            const unsubscribe = onSnapshot(q, snapshot => {
                const mediaList = snapshot.docs.map((doc: any) => ({
                    id: doc.id,
                    url: doc.data().downloadURL,
                    name: doc.data().name,
                    uploadTime: doc.data().uploadTime?.toDate?.() ?? doc.data().uploadTime,
                }));
                const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : undefined;
                observer.next({ mediaList, lastDoc });
            }, error => observer.error(error));

            return { unsubscribe };
        });

        const totalCountObservable = from(getCountFromServer(mediaCollection)).pipe(
            map(count => count.data().count)
        );

        return changesObservable.pipe(
            take(1),
            switchMap(({ mediaList, lastDoc }) =>
                totalCountObservable.pipe(
                    map(totalCount => ({
                        items: mediaList,
                        pagination: {
                            pageSize: pageSize,
                            totalItems: totalCount,
                            lastVisible: lastDoc
                        }
                    }))
                )
            )
        );
    }
}
