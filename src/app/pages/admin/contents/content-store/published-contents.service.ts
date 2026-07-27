import { inject, Injectable, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DbService } from '../../../../../shared/services/db.service';
import { IContents } from './published-contents.model';
import { CollectionReference, collection, doc, getDoc, onSnapshot, query, orderBy, limit, getDocs } from '@angular/fire/firestore';
import { EMPTY, Observable, from, map } from 'rxjs';
import { IContentTranslation } from '../draft-content-store/content-translation.model';

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
    private platform = inject(PLATFORM_ID);

    constructor() {
        super('Contents');
    }

    override getCollectionRef(collectionSuffix?: string): CollectionReference<IContents> {
        if (collectionSuffix) {
            return runInInjectionContext(this.injector, () => collection(this.firestore, `arc_${collectionSuffix}`)) as CollectionReference<IContents>;
        }
        return super.getCollectionRef();
    }

    /**
     * Lists the languages a published item has been translated into. Used by
     * the switcher so it never offers a language whose page was never
     * deployed.
     */
    async getTranslatedLanguages(contentTypeSlug: string, docId: string): Promise<string[]> {
        try {
            const ref = runInInjectionContext(this.injector, () =>
                collection(this.firestore, `arc_${contentTypeSlug}`, docId, 'translations'),
            );
            const snap = await runInInjectionContext(this.injector, () => getDocs(ref));
            return snap.docs.map(doc => doc.id);
        } catch (error) {
            // No translations is the safe answer — the page still exists in the
            // default language.
            console.error('Error listing published translations:', error);
            return [];
        }
    }

    /**
     * Reads a published language variant: `arc_{slug}/{docId}/translations/{lang}`.
     *
     * Mirrors `DraftContentsService.getTranslation` on the published side. Used
     * by the SPA fallback renderer; statically deployed pages already have the
     * translation baked in.
     */
    async getTranslation(
        contentTypeSlug: string,
        docId: string,
        lang: string,
    ): Promise<IContentTranslation | null> {
        try {
            const ref = runInInjectionContext(this.injector, () =>
                doc(this.firestore, `arc_${contentTypeSlug}`, docId, 'translations', lang),
            );
            const snap = await runInInjectionContext(this.injector, () => getDoc(ref));
            if (!snap.exists()) return null;
            return { ...(snap.data() as IContentTranslation), lang };
        } catch (error) {
            // A missing translation must never break the page — it simply
            // renders in the default language.
            console.error(`Error loading published "${lang}" translation:`, error);
            return null;
        }
    }

    /**
     * Polls a published document for deployment status changes.
     *
     * Uses Firestore onSnapshot listener on the published collection document.
     * Automatically completes after:
     *  - deployStatus changes to 'deployed' or 'failed'
     *  - 60 seconds timeout (emits { deployStatus: null } as timeout signal)
     *
     * Never polls during SSR. Publishing is user-triggered, so this is not
     * reachable on the server today, but the listener would outlive the request
     * injector that @angular/fire captures for its callback — the next snapshot
     * would fire against a destroyed injector and the NG0205 would land on a
     * Firestore timer where nothing catches it. The 60s timeout below is a
     * second reason to stay off the server: a pending macrotask can hold up
     * prerender completion.
     *
     * @param docId - The document ID to watch
     * @param contentTypeSlug - The content type slug (determines the collection)
     * @returns Observable that emits DeployStatusUpdate on each change
     */
    pollDeployStatus(docId: string, contentTypeSlug: string): Observable<DeployStatusUpdate> {
        if (!isPlatformBrowser(this.platform)) return EMPTY;

        return new Observable<DeployStatusUpdate>(subscriber => {
            const collectionName = `arc_${contentTypeSlug}`;
            const docRef = runInInjectionContext(this.injector, () => doc(this.firestore, collectionName, docId));

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

            const unsubscribe = runInInjectionContext(this.injector, () => onSnapshot(docRef, (snap) => {
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
            }));

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
        const q = runInInjectionContext(this.injector, () => {
            const historyRef = collection(this.firestore, collectionName, docId, 'PublishedHistory');
            return query(historyRef, orderBy('publishedOn', 'desc'), limit(20));
        });

        return from(runInInjectionContext(this.injector, () => getDocs(q))).pipe(
            map(snap => snap.docs.map((d, index) => ({
                historyId: d.id,
                versionNumber: snap.docs.length - index, // v1 = oldest, vN = newest
                ...d.data(),
            }))),
        );
    }
}
