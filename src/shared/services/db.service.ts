/**
 * Database Service
 * 
 * Generic Firestore database service for CRUD operations.
 * Uses Angular Fire for Firestore integration.
 */

import { Inject, Injectable, inject, InjectionToken, Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    CollectionReference,
    DocumentData,
    DocumentReference,
    DocumentSnapshot,
    Firestore,
    Query,
    QueryDocumentSnapshot,
    QuerySnapshot,
    WhereFilterOp,
    WithFieldValue,
    addDoc,
    and,
    collection,
    doc,
    endBefore,
    getCountFromServer,
    getDoc,
    getDocs,
    limit,
    limitToLast,
    onSnapshot,
    or,
    orderBy,
    query,
    runTransaction,
    setDoc,
    startAfter,
    waitForPendingWrites,
    where,
    writeBatch,
} from '@angular/fire/firestore';

import {
    Observable,
    Subject,
    catchError,
    combineLatest,
    concatMap,
    debounceTime,
    defer,
    filter,
    forkJoin,
    from,
    map,
    merge,
    of,
    retry,
    share,
    switchMap,
    take,
    takeUntil,
    tap,
    throttleTime,
    throwError,
    timer,
} from 'rxjs';

import { QueryParams } from '../models';
import { IBaseModel, OmitCommonFields } from '../models/base-model';
import { GlobalService } from './global.service';
import { draftQueueEntry } from './search-queue';

export const COLLECTION_NAME = new InjectionToken<string>('CollectionName');

/** How long a list's rows wait for their first total, so a slow or missing connection does not hold back rows the device already has. */
export const FIRST_COUNT_WAIT_MS = 3000;
/** How soon after this device's add or delete the total is read again. Several at once share one read. */
export const WRITE_COUNT_WAIT_MS = 300;
/** The first change to a list reads its total at once. One that keeps changing (new logs arriving) then reads it at most this often: on a large collection each read costs more than one record. */
export const LIST_CHANGE_COUNT_WAIT_MS = 5000;

interface QueryResult<T> {
    collectionData: T[];
    totalCount: number;
    firstVisible: DocumentSnapshot | null;
    lastVisible: DocumentSnapshot | null;
}

@Injectable({
    providedIn: 'root',
})
export class DbService<T extends IBaseModel> extends GlobalService {
    firestore = inject(Firestore);
    private platformId = inject(PLATFORM_ID);
    protected injector = inject(Injector);
    dbCollection: CollectionReference<T>;
    /** Adds and deletes through this service that the server has confirmed. */
    private readonly countedWrites$ = new Subject<void>();

    constructor(@Inject(COLLECTION_NAME) private collectionName: string) {
        super();
        this.dbCollection = collection(this.firestore, collectionName) as CollectionReference<T>;
    }

    getCollectionRef(collectionSuffix?: string): CollectionReference<T> {
        return this.dbCollection;
    }

    getAll(queryParams?: QueryParams, collectionSuffix?: string): Observable<QueryResult<T>> {
        // Skip Firestore calls entirely during SSR — no auth context available
        if (!isPlatformBrowser(this.platformId)) {
            return of({
                collectionData: [] as T[],
                totalCount: 0,
                firstVisible: null,
                lastVisible: null,
            });
        }

        const targetCollection = this.getCollectionRef(collectionSuffix);
        let dataQuery: Query<T> = targetCollection;
        let countQuery: Query<T> = targetCollection;
        const listChanged$ = new Subject<void>();

        if (queryParams) {
            runInInjectionContext(this.injector, () => {
                const whereConstraints: any[] = [];
                const orConstraints: any[] = [];

                if (queryParams.whereConditions) {
                    for (const condition of queryParams.whereConditions) {
                        whereConstraints.push(where(condition.field, condition.operator, condition.value));
                    }
                }

                if (queryParams.orConditions && queryParams.orConditions.length > 0) {
                    for (const condition of queryParams.orConditions) {
                        orConstraints.push(where(condition.field, condition.operator, condition.value));
                    }
                }

                const filterConstraints = [];
                if (whereConstraints.length && orConstraints.length) {
                    filterConstraints.push(and(...whereConstraints, or(...orConstraints)));
                } else if (whereConstraints.length) {
                    filterConstraints.push(...whereConstraints);
                } else if (orConstraints.length) {
                    filterConstraints.push(or(...orConstraints));
                }

                if (filterConstraints.length > 0) {
                    dataQuery = query<T, DocumentData>(targetCollection, ...filterConstraints);
                    countQuery = query<T, DocumentData>(targetCollection, ...filterConstraints);
                }

                if (queryParams.orderByField) {
                    dataQuery = query<T, DocumentData>(
                        dataQuery,
                        orderBy(queryParams.orderByField, queryParams.orderByDirection || 'asc'),
                    );
                }

                if (queryParams?.startAfterDoc instanceof DocumentSnapshot) {
                    dataQuery = query<T, DocumentData>(
                        dataQuery,
                        startAfter(queryParams.startAfterDoc),
                        limit(queryParams.limitCount),
                    );
                } else if (queryParams?.endBeforeDoc instanceof DocumentSnapshot) {
                    dataQuery = query<T, DocumentData>(
                        dataQuery,
                        endBefore(queryParams.endBeforeDoc),
                        limitToLast(queryParams.limitCount),
                    );
                } else if (queryParams.lastCount) {
                    dataQuery = query<T, DocumentData>(dataQuery, limitToLast(queryParams.lastCount));
                } else if (queryParams.limitCount > 0) {
                    dataQuery = query<T, DocumentData>(dataQuery, limit(queryParams.limitCount));
                }
            });
        }

        // On the server, use one-shot getDocs() to avoid hanging connections.
        // On the client, use real-time onSnapshot() for live updates.
        const data$ = isPlatformBrowser(this.platformId)
            ? new Observable<any>((observer) => {
                let firstSnapshot = true;
                const unsubscribe = runInInjectionContext(this.injector, () => onSnapshot(
                    dataQuery,
                    (querySnapshot) => {
                        // A record came into or left this page, so the list may be a different length. An edit in place cannot change it.
                        if (!firstSnapshot && querySnapshot.docChanges().some((change) => change.type !== 'modified')) {
                            listChanged$.next();
                        }
                        firstSnapshot = false;

                        const data = querySnapshot.docs.map((doc) => {
                            const docData = doc.data();
                            const { id, ...restData } = docData;
                            return { id: doc.id, ...restData };
                        });

                        observer.next({
                            data,
                            firstVisible: querySnapshot.docs.length > 0 ? querySnapshot.docs[0] : null,
                            lastVisible: querySnapshot.docs.length > 0 ? querySnapshot.docs[querySnapshot.docs.length - 1] : null
                        });
                    },
                    (error) => {
                        console.error(`[DbService] data snapshot error on "${this.collectionName}":`, error);
                        observer.error(error);
                    },
                ));
                return { unsubscribe };
            })
            : from(runInInjectionContext(this.injector, () => getDocs(dataQuery))).pipe(
                map((querySnapshot) => {
                    const data = querySnapshot.docs.map((doc) => {
                        const docData = doc.data();
                        const { id, ...restData } = docData;
                        return { id: doc.id, ...restData };
                    });
                    return {
                        data,
                        firstVisible: querySnapshot.docs.length > 0 ? querySnapshot.docs[0] : null,
                        lastVisible: querySnapshot.docs.length > 0 ? querySnapshot.docs[querySnapshot.docs.length - 1] : null
                    };
                }),
                catchError((error) => {
                    console.warn(`[DbService] getDocs error on "${this.collectionName}":`, error);
                    return of({ data: [], firstVisible: null, lastVisible: null });
                }),
            );

        const resolvedData$ = data$.pipe(
            switchMap((result: any) => {
                const { data, firstVisible, lastVisible } = result;

                if (data.length) {
                    const resolvePromises = data.map(async (item: any) => {
                        const resolvedItem = { ...item };
                        const resolvedData = await this.resolveReferences(resolvedItem);
                        return resolvedData;
                    });
                    return forkJoin(resolvePromises).pipe(
                        map(resolvedData => ({
                            collectionData: resolvedData,
                            firstVisible,
                            lastVisible
                        }))
                    );
                } else {
                    return of({
                        collectionData: data,
                        firstVisible,
                        lastVisible
                    });
                }
            }),
        );

        return combineLatest([resolvedData$, this.listTotal(countQuery, listChanged$)]).pipe(
            map(([dataResult, totalCount]) => ({
                collectionData: dataResult.collectionData as T[],
                totalCount,
                firstVisible: dataResult.firstVisible,
                lastVisible: dataResult.lastVisible
            })),
        );
    }

    /**
     * How many records a list has, as an aggregate count: Firestore charges one read per 1,000
     * records counted, where a live read of them all charges one per record. A count is not
     * live, so it is read again when the list opens, after an add or delete through this
     * service, and when the list's own page sees a record arrive or leave. A change by someone
     * else that does not touch the page on screen shows at the next read of the list. The
     * total stays 0 until a count has answered, which the store takes for no answer.
     */
    private listTotal(countQuery: Query<T>, listChanged$: Observable<void>): Observable<number> {
        let known = 0;
        // A change that no read since has covered. This device's own add or delete comes both ways, and one read covers both.
        let uncounted = false;
        const noted = <V>(change$: Observable<V>) => change$.pipe(tap(() => { uncounted = true; }));
        const stillUncounted = <V>(change$: Observable<V>) => change$.pipe(filter(() => uncounted), map(() => true));
        const readCount = () => from(runInInjectionContext(this.injector, () => getCountFromServer(countQuery))).pipe(
            map((snapshot) => snapshot.data().count),
        );
        // A count taken before the server has this device's write would miss it.
        const readCountAfterWrites = () => from(runInInjectionContext(this.injector, () => waitForPendingWrites(this.firestore))).pipe(
            switchMap(readCount),
        );

        const counted$ = merge(
            of(false),
            this.countedWrites$.pipe(noted, debounceTime(WRITE_COUNT_WAIT_MS), stillUncounted),
            listChanged$.pipe(noted, throttleTime(LIST_CHANGE_COUNT_WAIT_MS, undefined, { leading: true, trailing: true }), stillUncounted),
        ).pipe(
            tap(() => { uncounted = false; }),
            switchMap((afterWrites) => defer(() => (afterWrites ? readCountAfterWrites() : readCount())).pipe(
                tap((count) => { known = count; }),
                catchError((error) => {
                    console.warn(`[DbService] getCountFromServer error on "${this.collectionName}":`, error);
                    return of(known);
                }),
            )),
            share(),
        );

        return merge(
            counted$,
            timer(FIRST_COUNT_WAIT_MS).pipe(takeUntil(counted$), map(() => known)),
        );
    }

    getById(id: string, collectionSuffix?: string): Observable<T | null> {
        const targetCollection = this.getCollectionRef(collectionSuffix);
        const docPromise = runInInjectionContext(this.injector, () => {
            const docRef = doc(targetCollection, id) as DocumentReference<T>;
            return getDoc(docRef);
        });

        return from(docPromise).pipe(
            switchMap(async (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const { id, ...restData } = data;
                    const result: Record<string, any> = { id: docSnap.id, ...restData };

                    for (const key in data) {
                        if (Object.prototype.hasOwnProperty.call(data, key)) {
                            const resolvedData = await this.resolveReferences(data[key]);
                            result[key] = resolvedData;
                        }
                    }

                    return result as T;
                } else {
                    return null;
                }
            }),
            catchError((error) => {
                console.error('Error fetching document:', error);
                return of(null);
            }),
        );
    }

    getByCustomField(field: string, operator: WhereFilterOp, value: any, collectionSuffix?: string): Observable<T | null> {
        const targetCollection = this.getCollectionRef(collectionSuffix);
        const docsPromise = runInInjectionContext(this.injector, () => {
            const whereCondition = where(field, operator, value);
            const queryWithCondition = query(targetCollection, whereCondition);
            return getDocs(queryWithCondition);
        });

        return from(docsPromise).pipe(
            switchMap((querySnapshot) => this.firstMatch(querySnapshot.docs)),
            catchError((error) => {
                console.error('Error fetching document:', error);
                return of(null);
            }),
        );
    }

    /**
     * getByCustomField kept up to date. With the offline cache on, the device's copy comes
     * at once (`fromCache: true`) when it has one, and the server's after it; with nothing
     * on the device, the first answer is the server's. getDocs, by contrast, always waits
     * for the server while online. Metadata changes are included, so a caller also hears
     * when the server confirms a cached answer that did not change. Errors are passed on.
     */
    watchByCustomField(field: string, operator: WhereFilterOp, value: any, collectionSuffix?: string): Observable<{ data: T | null; fromCache: boolean }> {
        const targetCollection = this.getCollectionRef(collectionSuffix);
        return new Observable<QuerySnapshot<DocumentData>>((observer) => runInInjectionContext(this.injector, () => onSnapshot(
            query(targetCollection, where(field, operator, value)),
            { includeMetadataChanges: true },
            (snapshot) => observer.next(snapshot),
            (error) => observer.error(error),
        ))).pipe(
            // In order: resolving references must not let an older answer land last.
            concatMap(async (snapshot) => ({ data: await this.firstMatch(snapshot.docs), fromCache: snapshot.metadata.fromCache })),
        );
    }

    /** The first of `docs` as a record, its references resolved; null when there is none. */
    private async firstMatch(docs: QueryDocumentSnapshot<DocumentData>[]): Promise<T | null> {
        if (!docs.length) return null;
        const { id, ...restData } = docs[0].data();
        const result: Record<string, any> = { id: docs[0].id, ...restData };
        for (const key in restData) {
            if (Object.prototype.hasOwnProperty.call(restData, key)) {
                result[key] = await this.resolveReferences(restData[key]);
            }
        }
        return result as T;
    }

    add(newData: OmitCommonFields<T>, collectionSuffix?: string): Observable<string> {
        if (!newData) {
            return throwError(() => new Error('Data is required'));
        }

        const now = new Date();
        const dataWithCommonFields = {
            ...newData,
            createdAt: now,
            modifiedAt: now,
        };

        const processedData = runInInjectionContext(this.injector, () => this.processDocumentReferences(dataWithCommonFields));

        return from(
            runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
                const targetCollection = this.getCollectionRef(collectionSuffix);
                const docRef = await runInInjectionContext(this.injector, () => addDoc(targetCollection, processedData as WithFieldValue<T>));
                const updateData = {
                    id: docRef.id,
                    modifiedAt: now,
                };
                transaction.update(docRef, updateData);
                this.queueForSearch(transaction, docRef.path);
                return docRef.id;
            })),
        ).pipe(
            retry(3),
            catchError((error) => {
                console.error('Transaction failed:', error);
                return throwError(() => new Error(`Transaction failed: ${error.message}`));
            }),
            tap(() => this.countedWrites$.next()),
        );
    }

    update(id: string, data: Partial<OmitCommonFields<T>>, collectionSuffix?: string): Observable<void> {
        const now = new Date();
        const dataWithUpdatedFields = {
            ...data,
            modifiedAt: now,
        };

        const processedData = runInInjectionContext(this.injector, () => this.processDocumentReferences(dataWithUpdatedFields));
        const targetCollection = this.getCollectionRef(collectionSuffix);
        const docRef = runInInjectionContext(this.injector, () => doc(targetCollection, id)) as DocumentReference<T, T>;

        return from(
            runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
                const docSnapshot = await transaction.get(docRef);
                if (!docSnapshot.exists()) {
                    throw new Error('Document does not exist!');
                }
                transaction.update(docRef, processedData);
                this.queueForSearch(transaction, docRef.path);
            })),
        );
    }


    /**
     * Add multiple documents in batches (max 500 per batch)
     */
    addBatch(items: OmitCommonFields<T>[], collectionSuffix?: string): Observable<string[]> {
        if (!items || items.length === 0) {
            return of([]);
        }

        const allIds: string[] = [];

        const commitChunks = async (): Promise<string[]> => {
            const targetCollection = this.getCollectionRef(collectionSuffix);
            // Firestore's writeBatch limit is 500; a draft also writes its search queue entry.
            const queued = !!runInInjectionContext(this.injector, () => draftQueueEntry(this.firestore, `${targetCollection.path}/x`));
            const chunkSize = queued ? 250 : 500;
            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                const batch = runInInjectionContext(this.injector, () => writeBatch(this.firestore));
                const now = new Date();

                for (const item of chunk) {
                    const dataWithCommonFields = {
                        ...item,
                        createdAt: now,
                        modifiedAt: now,
                    };
                    const processedData = runInInjectionContext(this.injector, () => this.processDocumentReferences(dataWithCommonFields));

                    const newDocRef = runInInjectionContext(this.injector, () => doc(targetCollection));
                    allIds.push(newDocRef.id);

                    batch.set(newDocRef, {
                        ...processedData,
                        id: newDocRef.id,
                    } as WithFieldValue<T>);
                    this.queueForSearch(batch, newDocRef.path);
                }

                await batch.commit();
            }
            return allIds;
        };

        return from(commitChunks()).pipe(
            catchError((error) => {
                console.error('Batch add failed:', error);
                return throwError(() => new Error(`Batch add failed: ${error.message}`));
            }),
            tap(() => this.countedWrites$.next()),
        );
    }

    delete(id: string, collectionSuffix?: string): Observable<void> {
        const targetCollection = this.getCollectionRef(collectionSuffix);
        const docRef = runInInjectionContext(this.injector, () => doc(targetCollection, id)) as DocumentReference<T, T>;

        return from(
            runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
                const docSnapshot = await transaction.get(docRef);
                if (!docSnapshot.exists()) {
                    throw new Error('Document does not exist!');
                }
                transaction.delete(docRef);
                this.queueForSearch(transaction, docRef.path);
            })),
        ).pipe(
            catchError((error) => {
                console.error('Error deleting document:', error);
                return throwError(() => error);
            }),
            tap(() => this.countedWrites$.next()),
        );
    }

    /**
     * A draft write also queues the draft for search, in the same batch or
     * transaction (specs/feature-flags-spec.md 6.5); any other write, nothing.
     */
    private queueForSearch(writer: { set: (ref: any, data: any) => unknown }, path: string): void {
        const entry = runInInjectionContext(this.injector, () => draftQueueEntry(this.firestore, path));
        if (entry) writer.set(entry.ref, entry.data);
    }

    private processDocumentReferences(data: any): any {
        const processedData = { ...data };
        for (const key in processedData) {
            if (typeof processedData[key] === 'string' && processedData[key].includes('parent::/')) {
                const [prefix, refCollection, refId] = processedData[key].split('/');
                processedData[key] = doc(this.firestore, refCollection, refId) as DocumentReference<any>;
            }
        }
        return processedData;
    }

    async resolveReferences(obj: any): Promise<any> {
        if (obj instanceof DocumentReference) {
            try {
                const docSnap = await runInInjectionContext(this.injector, () => getDoc(obj));
                if (docSnap.exists()) {
                    const snapData = docSnap.data();
                    return snapData ? { id: docSnap.id, ...snapData } : null;
                }
                return null;
            } catch (error) {
                console.warn(`[DbService] resolveReferences failed for "${obj.path}":`, error);
                return null; // Gracefully skip unresolvable references
            }
        } else if (obj instanceof Date) {
            return obj;
        } else if (obj && typeof (obj as any).toDate === 'function') {
            return obj;
        } else if (Array.isArray(obj)) {
            return Promise.all(obj.map((item) => this.resolveReferences(item)));
        } else if (typeof obj === 'object' && obj !== null) {
            // Only recurse into plain objects, not other class instances
            const proto = Object.getPrototypeOf(obj);
            if (proto !== null && proto !== Object.prototype) {
                return obj;
            }
            const resolvedObj: any = {};
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    resolvedObj[key] = await this.resolveReferences(obj[key]);
                }
            }
            return resolvedObj;
        }

        return obj;
    }

    getCollectionTotalCount(queryParams?: QueryParams, collectionSuffix?: string): Observable<number> {
        // Skip Firestore calls entirely during SSR — no auth context available
        if (!isPlatformBrowser(this.platformId)) {
            return of(0);
        }

        const targetCollection = this.getCollectionRef(collectionSuffix);
        let countQuery: Query<T> = targetCollection;

        if (queryParams && queryParams.whereConditions) {
            runInInjectionContext(this.injector, () => {
                const constraints: any[] = queryParams.whereConditions!.map((condition) =>
                    where(condition.field, condition.operator, condition.value),
                );

                if (constraints.length > 0) {
                    countQuery = query<T, DocumentData>(targetCollection, ...constraints);
                }
            });
        }

        return from(runInInjectionContext(this.injector, () => getCountFromServer(countQuery)).then((snapshot) => snapshot.data().count)).pipe(
            catchError((error) => {
                console.warn(`[DbService] getCollectionTotalCount error on "${this.collectionName}":`, error);
                return of(0);
            }),
        );
    }
}
