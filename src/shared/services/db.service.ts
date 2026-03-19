/**
 * Database Service
 * 
 * Generic Firestore database service for CRUD operations.
 * Uses Angular Fire for Firestore integration.
 */

import { Inject, Injectable, inject, InjectionToken, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    CollectionReference,
    DocumentData,
    DocumentReference,
    DocumentSnapshot,
    Firestore,
    Query,
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
    where,
    writeBatch,
} from '@angular/fire/firestore';

import {
    Observable,
    catchError,
    combineLatest,
    forkJoin,
    from,
    map,
    of,
    retry,
    switchMap,
    take,
    tap,
    throwError,
} from 'rxjs';

import { QueryParams } from '../models';
import { IBaseModel, OmitCommonFields } from '../models/base-model';
import { GlobalService } from './global.service';

export const COLLECTION_NAME = new InjectionToken<string>('CollectionName');

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
    dbCollection: CollectionReference<T>;

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

        if (queryParams) {
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
            } else if (queryParams.limitCount > 0) {
                dataQuery = query<T, DocumentData>(dataQuery, limit(queryParams.limitCount));
            }
        }

        // On the server, use one-shot getDocs() to avoid hanging connections.
        // On the client, use real-time onSnapshot() for live updates.
        const data$ = isPlatformBrowser(this.platformId)
            ? new Observable<any>((observer) => {
                const unsubscribe = onSnapshot(
                    dataQuery,
                    (querySnapshot) => {
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
                );
                return { unsubscribe };
            })
            : from(getDocs(dataQuery)).pipe(
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

        const count$ = isPlatformBrowser(this.platformId)
            ? new Observable<number>((observer) => {
                const unsubscribe = onSnapshot(
                    countQuery,
                    (snapshot) => {
                        observer.next(snapshot.size);
                    },
                    (error) => {
                        console.warn(`[DbService] count snapshot error on "${this.collectionName}":`, error);
                        observer.next(0); // Emit 0 instead of killing the combineLatest pipeline
                    },
                );
                return { unsubscribe };
            })
            : from(getCountFromServer(countQuery)).pipe(
                map((snapshot) => snapshot.data().count),
                catchError((error) => {
                    console.warn(`[DbService] getCountFromServer error on "${this.collectionName}":`, error);
                    return of(0);
                }),
            );

        return combineLatest([resolvedData$, count$]).pipe(
            map(([dataResult, totalCount]) => ({
                collectionData: dataResult.collectionData as T[],
                totalCount,
                firstVisible: dataResult.firstVisible,
                lastVisible: dataResult.lastVisible
            })),
        );
    }

    getById(id: string, collectionSuffix?: string): Observable<T | null> {
        const targetCollection = this.getCollectionRef(collectionSuffix);
        const docRef = doc(targetCollection, id) as DocumentReference<T>;

        return from(getDoc(docRef)).pipe(
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
        const whereCondition = where(field, operator, value);
        const queryWithCondition = query(targetCollection, whereCondition);

        return from(getDocs(queryWithCondition)).pipe(
            switchMap(async (querySnapshot) => {
                const data = querySnapshot.docs.map((doc) => {
                    const docData = doc.data();
                    const { id, ...restData } = docData;
                    return { id: doc.id, ...restData };
                }) as T[];

                if (data.length > 0) {
                    const docData = data[0];
                    const { id, ...restData } = docData;
                    const result: Record<string, any> = { id: docData.id, ...(restData as Record<string, any>) };

                    for (const key in restData) {
                        if (Object.prototype.hasOwnProperty.call(restData, key)) {
                            const resolvedData = await this.resolveReferences((restData as Record<string, any>)[key]);
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

        const processedData = this.processDocumentReferences(dataWithCommonFields);

        return from(
            runTransaction(this.firestore, async (transaction) => {
                const targetCollection = this.getCollectionRef(collectionSuffix);
                const docRef = await addDoc(targetCollection, processedData as WithFieldValue<T>);
                const updateData = {
                    id: docRef.id,
                    modifiedAt: now,
                };
                transaction.update(docRef, updateData);
                return docRef.id;
            }),
        ).pipe(
            retry(3),
            catchError((error) => {
                console.error('Transaction failed:', error);
                return throwError(() => new Error(`Transaction failed: ${error.message}`));
            }),
        );
    }

    update(id: string, data: Partial<OmitCommonFields<T>>, collectionSuffix?: string): Observable<void> {
        const now = new Date();
        const dataWithUpdatedFields = {
            ...data,
            modifiedAt: now,
        };

        const processedData = this.processDocumentReferences(dataWithUpdatedFields);
        const targetCollection = this.getCollectionRef(collectionSuffix);
        const docRef = doc(targetCollection, id) as DocumentReference<T, T>;

        return from(
            runTransaction(this.firestore, async (transaction) => {
                const docSnapshot = await transaction.get(docRef);
                if (!docSnapshot.exists()) {
                    throw new Error('Document does not exist!');
                }
                transaction.update(docRef, processedData);
            }),
        );
    }


    /**
     * Add multiple documents in batches (max 500 per batch)
     */
    addBatch(items: OmitCommonFields<T>[], collectionSuffix?: string): Observable<string[]> {
        if (!items || items.length === 0) {
            return of([]);
        }

        const chunkSize = 500; // Firestore writeBatch limit
        const allIds: string[] = [];

        const commitChunks = async (): Promise<string[]> => {
            const targetCollection = this.getCollectionRef(collectionSuffix);
            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                const batch = writeBatch(this.firestore);
                const now = new Date();

                for (const item of chunk) {
                    const dataWithCommonFields = {
                        ...item,
                        createdAt: now,
                        modifiedAt: now,
                    };
                    const processedData = this.processDocumentReferences(dataWithCommonFields);

                    const newDocRef = doc(targetCollection);
                    allIds.push(newDocRef.id);

                    batch.set(newDocRef, {
                        ...processedData,
                        id: newDocRef.id,
                    } as WithFieldValue<T>);
                }

                await batch.commit();
            }
            return allIds;
        };

        return from(commitChunks()).pipe(
            catchError((error) => {
                console.error('Batch add failed:', error);
                return throwError(() => new Error(`Batch add failed: ${error.message}`));
            })
        );
    }

    delete(id: string, collectionSuffix?: string): Observable<void> {
        const targetCollection = this.getCollectionRef(collectionSuffix);
        const docRef = doc(targetCollection, id) as DocumentReference<T, T>;

        return from(
            runTransaction(this.firestore, async (transaction) => {
                const docSnapshot = await transaction.get(docRef);
                if (!docSnapshot.exists()) {
                    throw new Error('Document does not exist!');
                }
                transaction.delete(docRef);
            }),
        ).pipe(
            catchError((error) => {
                console.error('Error deleting document:', error);
                return throwError(() => error);
            }),
        );
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
                const docSnap = await getDoc(obj);
                if (docSnap.exists()) {
                    const snapData = docSnap.data();
                    return snapData ? { id: docSnap.id, ...snapData } : null;
                }
                return null;
            } catch (error) {
                console.warn(`[DbService] resolveReferences failed for "${obj.path}":`, error);
                return null; // Gracefully skip unresolvable references
            }
        } else if (Array.isArray(obj)) {
            return Promise.all(obj.map((item) => this.resolveReferences(item)));
        } else if (typeof obj === 'object' && obj !== null) {
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
            const constraints: any[] = queryParams.whereConditions.map((condition) =>
                where(condition.field, condition.operator, condition.value),
            );

            if (constraints.length > 0) {
                countQuery = query<T, DocumentData>(targetCollection, ...constraints);
            }
        }

        return from(getCountFromServer(countQuery).then((snapshot) => snapshot.data().count)).pipe(
            catchError((error) => {
                console.warn(`[DbService] getCollectionTotalCount error on "${this.collectionName}":`, error);
                return of(0);
            }),
        );
    }
}
