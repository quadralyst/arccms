/**
 * Generic Store Service
 * 
 * A factory function that creates NgRx Signal stores with common CRUD operations.
 * This provides a reusable pattern for managing any entity that extends IBaseModel.
 */

import { computed, inject, Injectable, PendingTasks, Type } from '@angular/core';
import { WhereFilterOp } from '@angular/fire/firestore';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { catchError, finalize, Observable, of, Subscription, tap, throwError } from 'rxjs';
import { AuthState } from '../../app/pages/(auth)/auth.store';
import { QueryParams } from '../models';
import { IBaseModel, OmitCommonFields } from '../models/base-model';
import { DbService } from './db.service';

/**
 * Generic state interface for entity stores
 */
export interface GenericState<T extends IBaseModel> {
    currentItem: T;
    items: T[];
    isLoading: boolean;
    isSuccess: boolean;
    error: string;
    query: string;
    sortField: string;
    order: 'asc' | 'desc';
    totalRecords: number;
    totalPages: number;
    previousPageNumber: number;
    currentPageNumber: number;
    limit: number;
    firstVisible: any | null; // DocumentSnapshot
    lastVisible: any | null; // DocumentSnapshot
    whereConditions: any[];
    orConditions: any[];
}

/**
 * Get default initial state for a generic store
 */
export function getDefaultInitialState<T extends IBaseModel>(): GenericState<T> {
    return {
        currentItem: {} as T,
        items: [],
        isLoading: false,
        isSuccess: false,
        error: '',
        query: '',
        sortField: '',
        order: 'desc',
        totalRecords: 0,
        totalPages: 0,
        previousPageNumber: -1,
        currentPageNumber: 0,
        limit: 10,
        firstVisible: null,
        lastVisible: null,
        whereConditions: [],
        orConditions: [],
    };
}

/**
 * Factory function to create a generic store for any entity
 * 
 * @param ServiceType - The DbService implementation for the entity
 * @param initialState - Optional partial initial state to override defaults
 * @returns A new store class with CRUD operations
 */
export function createGenericStore<T extends IBaseModel>(
    ServiceType: Type<DbService<T>>,
    initialState: Partial<GenericState<T>> = {},
) {
    const defaultState = getDefaultInitialState<T>();
    const mergedState = { ...defaultState, ...initialState };
    let activeSubscription: any = null;

    @Injectable({ providedIn: 'root' })
    class GenericStore extends signalStore(
        withState<GenericState<T>>(mergedState),
        withComputed((state) => ({
            totalItems: computed(() => state.items().length),
        })),
        withMethods((store, service = inject(ServiceType), authStore = inject(AuthState), pendingTasks = inject(PendingTasks)) => ({
            /**
             * Clear current item
             */
            clearCurrent() {
                patchState(store, { currentItem: {} as T, isLoading: false, isSuccess: true, error: '' });
            },

            /**
             * Clear all items and reset state
             */
            clearList() {
                patchState(store, mergedState);
            },

            /**
             * Get item by ID from local store
             */
            get(itemId: string): T | null {
                return store.items().find((item) => item.id === itemId) || null;
            },

            /**
             * Find item by field value in local store
             */
            find<K extends keyof T>(field: K, value: T[K]): T | null {
                return store.items().find((item) => item[field] === value) || null;
            },

            /**
             * Get all items from Firestore
             */
            async getAll(queryParams?: QueryParams, collectionSuffix?: string): Promise<void> {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                // Tell Angular SSR to wait for data before rendering HTML.
                // taskCleanup() is called once data arrives (or on error).
                const taskCleanup = pendingTasks.add();
                let taskCleaned = false;
                const cleanupOnce = () => {
                    if (!taskCleaned) {
                        taskCleaned = true;
                        taskCleanup();
                    }
                };

                const targetPage = queryParams?.currentPageNumber ?? store.currentPageNumber();
                const currentPage = store.currentPageNumber();

                let startAfterDoc = null;
                let endBeforeDoc = null;

                // Determine direction and correct cursor
                if (targetPage === 0) {
                    // Reset or first page
                    startAfterDoc = null;
                    endBeforeDoc = null;
                } else if (targetPage > currentPage) {
                    // Next page
                    startAfterDoc = store.lastVisible();
                } else if (targetPage < currentPage) {
                    // Previous page
                    endBeforeDoc = store.firstVisible();
                }

                const defaultQueryParams: QueryParams = {
                    limitCount: store.limit(),
                    orderByField: store.sortField(),
                    orderByDirection: store.order(),
                    startAfterDoc,
                    endBeforeDoc,
                    whereConditions: store.whereConditions(),
                    orConditions: store.orConditions(),
                    previousPageNumber: store.previousPageNumber(),
                    currentPageNumber: store.currentPageNumber(),
                };

                queryParams = { ...defaultQueryParams, ...queryParams };

                if (activeSubscription) {
                    activeSubscription.unsubscribe();
                }

                activeSubscription = service.getAll(queryParams, collectionSuffix).subscribe({
                    next: (result) => {
                        patchState(store, {
                            items: result.collectionData,
                            totalPages: Math.ceil(result.totalCount / queryParams!.limitCount!),
                            totalRecords: result.totalCount,
                            isLoading: false,
                            isSuccess: true,
                            error: '',
                            firstVisible: result.firstVisible,
                            lastVisible: result.lastVisible,
                            whereConditions: queryParams!.whereConditions,
                            limit: queryParams!.limitCount,
                            sortField: queryParams!.orderByField,
                            order: queryParams!.orderByDirection,
                            previousPageNumber: queryParams!.previousPageNumber,
                            currentPageNumber: queryParams!.currentPageNumber,
                        });
                        cleanupOnce();
                    },
                    error: (error) => {
                        console.error('Error', error);
                        patchState(store, {
                            error: error.message,
                            isLoading: false,
                            isSuccess: false,
                        });
                        cleanupOnce();
                    },
                });
            },

            /**
             * Get item by ID from Firestore
             * Note: Does NOT set isLoading to avoid causing list UI flicker
             */
            getById(itemId: string, collectionSuffix?: string) {
                // Tell Angular SSR to wait for this item before rendering HTML.
                const taskCleanup = pendingTasks.add();

                service
                    .getById(itemId, collectionSuffix)
                    .pipe(
                        tap((item: T | null) => {
                            if (item) {
                                patchState(store, { currentItem: item, isSuccess: true, error: '' });
                            } else {
                                patchState(store, { isSuccess: true, error: 'Item not found' });
                            }
                        }),
                        catchError((error) => {
                            console.error('Error', error);
                            patchState(store, { isSuccess: false, error: error.message });
                            return of(null);
                        }),
                        finalize(() => taskCleanup()),
                    )
                    .subscribe();
            },

            /**
             * Get item by custom field from Firestore
             */
            getByCustomField(field: string, operator: WhereFilterOp, value: any, collectionSuffix?: string) {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                service
                    .getByCustomField(field, operator, value, collectionSuffix)
                    .pipe(
                        tap((item: T | null) => {
                            if (item) {
                                patchState(store, { currentItem: item, isLoading: false, isSuccess: true, error: '' });
                            } else {
                                patchState(store, { isLoading: false, isSuccess: true, error: 'Item not found' });
                            }
                        }),
                        catchError((error) => {
                            patchState(store, { isLoading: false, isSuccess: false, error: error.message });
                            return of(null);
                        }),
                        finalize(() => {
                            patchState(store, { isLoading: store.isLoading(), isSuccess: store.isSuccess(), error: store.error() });
                        }),
                    )
                    .subscribe();
            },


            /**
             * Add new item to Firestore
             */
            add(newItem: OmitCommonFields<T>, collectionSuffix?: string): Observable<string> {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });
                newItem = {
                    ...newItem,
                    createdBy: authStore.currentUser()?.id || '',
                    modifiedBy: authStore.currentUser()?.id || '',
                };
                return service.add(newItem, collectionSuffix).pipe(
                    tap((id) => {
                        patchState(store, {
                            currentItem: { ...newItem, id } as T,
                            isSuccess: true,
                            isLoading: false,
                            error: '',
                        });
                    }),
                    catchError((error) => {
                        patchState(store, { isLoading: false, isSuccess: false, error: error.message || 'An error occurred' });
                        return of('');
                    }),
                    finalize(() => {
                        patchState(store, { isLoading: store.isLoading(), isSuccess: store.isSuccess(), error: store.error() });
                    }),
                );
            },

            /**
             * Add multiple items in batch
             */
            addBatch(items: OmitCommonFields<T>[], collectionSuffix?: string): Observable<string[]> {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });
                const userId = authStore.currentUser()?.id || '';

                const itemsWithAudit = items.map(item => ({
                    ...item,
                    createdBy: userId,
                    modifiedBy: userId,
                }));

                return service.addBatch(itemsWithAudit, collectionSuffix).pipe(
                    tap(() => {
                        patchState(store, { 
                            isSuccess: true, 
                            isLoading: false, 
                            error: ''
                        });
                    }),
                    catchError((error) => {
                        patchState(store, { 
                            isLoading: false, 
                            isSuccess: false, 
                            error: error.message || 'Failed to batch add items' 
                        });
                        return throwError(() => error);
                    })
                );
            },

            /**
             * Update existing item in Firestore
             */
            update(id: string, itemPartial: Partial<OmitCommonFields<T>>, collectionSuffix?: string): Observable<void> {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                itemPartial = { ...itemPartial, modifiedBy: authStore.currentUser()?.id };
                return service.update(id, itemPartial, collectionSuffix).pipe(
                    tap(() => {
                        patchState(store, {
                            items: store.items().map((item) => (item.id === id ? { ...item, ...itemPartial } : item)),
                            isLoading: false,
                            isSuccess: true,
                            error: '',
                        });
                    }),
                    catchError((error) => {
                        patchState(store, { isLoading: false, isSuccess: false, error: error.message || 'An error occurred' });
                        return of(undefined);
                    }),
                    finalize(() => {
                        patchState(store, { isLoading: store.isLoading(), isSuccess: store.isSuccess(), error: store.error() });
                    }),
                );
            },

            /**
             * Delete item from Firestore
             */
            delete(id: string, collectionSuffix?: string): Observable<void> {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                return service.delete(id, collectionSuffix).pipe(
                    tap(() => {
                        patchState(store, {
                            items: store.items().filter((item) => item.id !== id),
                            isLoading: false,
                            isSuccess: true,
                            error: '',
                        });
                    }),
                    catchError((error) => {
                        patchState(store, { isLoading: false, isSuccess: false, error: error.message || 'An error occurred' });
                        return throwError(() => error);
                    }),
                    finalize(() => {
                        patchState(store, { isLoading: store.isLoading(), isSuccess: store.isSuccess(), error: store.error() });
                    }),
                );
            },

            /**
             * Get total count of items matching query
             */
            getCount(queryParams?: QueryParams, collectionSuffix?: string): Observable<number> {
                const defaultQueryParams: QueryParams = {
                    whereConditions: store.whereConditions(),
                    limitCount: 0,
                    currentPageNumber: 0,
                    previousPageNumber: 0,
                };

                queryParams = { ...defaultQueryParams, ...queryParams };

                return new Observable<number>((observer) => {
                    service.getCollectionTotalCount(queryParams, collectionSuffix).subscribe({
                        next: (totalCount) => {
                            observer.next(totalCount);
                            observer.complete();
                        },
                        error: (error) => {
                            observer.error(error.message || 'An error occurred');
                        },
                    });
                });
            },

            /**
             * Unsubscribe from active subscriptions and reset state
             */
            unsubscribeStore(): void {
                if (activeSubscription && typeof activeSubscription.unsubscribe === 'function') {
                    if (!activeSubscription.closed) {
                        activeSubscription.unsubscribe();
                    }
                    activeSubscription = null;
                }

                patchState(store, mergedState);
            },
        })),
    ) { }

    return GenericStore;
}
