/**
 * Waitlist Admin Store
 * 
 * Signal-based store for admin waitlist management.
 * Uses direct Firestore access for CRUD operations.
 */

import { computed, inject, Injectable, Injector, OnDestroy, PLATFORM_ID, runInInjectionContext, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, onSnapshot } from '@angular/fire/firestore';
import { IWaitlist } from '../../waitlist/waitlist.model';

interface WaitlistAdminState {
    items: IWaitlist[];
    loading: boolean;
    error: string | null;
}

@Injectable({ providedIn: 'root' })
export class WaitlistAdminStore implements OnDestroy {
    private firestore = inject(Firestore);
    private injector = inject(Injector);
    private platformId = inject(PLATFORM_ID);
    private collectionName = 'Waitlists';

    // State signals
    private _items = signal<IWaitlist[]>([]);
    private _loading = signal(false);
    private _error = signal<string | null>(null);

    // Public computed signals
    readonly items = this._items.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly error = this._error.asReadonly();
    readonly totalItems = computed(() => this._items().length);

    private unsubscribe: (() => void) | null = null;

    /**
     * Subscribe to real-time updates from Firestore.
     *
     * Never listens during SSR. @angular/fire captures the injector at
     * `onSnapshot` time and runs the callback inside it; the server tears the
     * request injector down once the response is rendered, but the listener
     * outlives it. The next snapshot — e.g. an admin adding or editing a
     * waitlist — then fires against a destroyed injector, and the resulting
     * NG0205 surfaces on a Firestore timer where nothing can catch it, killing
     * the server process. Admin data is behind roleGuard and SSR has no auth
     * context, so there is nothing to render from it anyway.
     */
    subscribe(): void {
        if (!isPlatformBrowser(this.platformId)) return;

        // Several surfaces subscribe independently (side-navbar, dashboard,
        // subscribers). Share the one listener: re-subscribing used to overwrite
        // `unsubscribe`, orphaning the previous listener for the app's lifetime.
        if (this.unsubscribe) return;

        this._loading.set(true);

        this.unsubscribe = runInInjectionContext(this.injector, () => {
            const collectionRef = collection(this.firestore, this.collectionName);
            const q = query(collectionRef, orderBy('createdAt', 'desc'));

            return onSnapshot(q,
                (snapshot) => {
                    const items: IWaitlist[] = [];
                    snapshot.forEach((doc) => {
                        items.push({ id: doc.id, ...doc.data() } as IWaitlist);
                    });
                    this._items.set(items);
                    this._loading.set(false);
                    this._error.set(null);
                },
                (error) => {
                    console.error('Error fetching waitlists:', error);
                    this._error.set(error.message);
                    this._loading.set(false);
                }
            );
        });
    }

    /**
     * Add new waitlist
     */
    async add(data: Partial<IWaitlist>): Promise<string> {
        try {
            this._loading.set(true);
            const docRef = await runInInjectionContext(this.injector, () => {
                const collectionRef = collection(this.firestore, this.collectionName);
                return addDoc(collectionRef, {
                    ...data,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
            });
            this._loading.set(false);
            return docRef.id;
        } catch (error: any) {
            console.error('Error adding waitlist:', error);
            this._error.set(error.message);
            this._loading.set(false);
            throw error;
        }
    }

    /**
     * Update existing waitlist
     */
    async update(id: string, data: Partial<IWaitlist>): Promise<void> {
        try {
            this._loading.set(true);
            await runInInjectionContext(this.injector, () => {
                const docRef = doc(this.firestore, this.collectionName, id);
                return updateDoc(docRef, {
                    ...data,
                    updatedAt: new Date(),
                });
            });
            this._loading.set(false);
        } catch (error: any) {
            console.error('Error updating waitlist:', error);
            this._error.set(error.message);
            this._loading.set(false);
            throw error;
        }
    }

    /**
     * Delete waitlist
     */
    async delete(id: string): Promise<void> {
        try {
            this._loading.set(true);
            await runInInjectionContext(this.injector, () => {
                const docRef = doc(this.firestore, this.collectionName, id);
                return deleteDoc(docRef);
            });
            this._loading.set(false);
        } catch (error: any) {
            console.error('Error deleting waitlist:', error);
            this._error.set(error.message);
            this._loading.set(false);
            throw error;
        }
    }

    /**
     * Unsubscribe from real-time updates
     */
    destroy(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    /** Drop the listener when the injector goes away (app teardown, HMR reload). */
    ngOnDestroy(): void {
        this.destroy();
    }
}
