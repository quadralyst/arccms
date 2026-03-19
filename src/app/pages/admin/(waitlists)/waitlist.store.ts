/**
 * Waitlist Admin Store
 * 
 * Signal-based store for admin waitlist management.
 * Uses direct Firestore access for CRUD operations.
 */

import { computed, inject, Injectable, signal } from '@angular/core';
import { Firestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, onSnapshot } from '@angular/fire/firestore';
import { IWaitlist } from '../../waitlist/waitlist.model';

interface WaitlistAdminState {
    items: IWaitlist[];
    loading: boolean;
    error: string | null;
}

@Injectable({ providedIn: 'root' })
export class WaitlistAdminStore {
    private firestore = inject(Firestore);
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
     * Subscribe to real-time updates from Firestore
     */
    subscribe(): void {
        this._loading.set(true);

        const collectionRef = collection(this.firestore, this.collectionName);
        const q = query(collectionRef, orderBy('createdAt', 'desc'));

        this.unsubscribe = onSnapshot(q,
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
    }

    /**
     * Add new waitlist
     */
    async add(data: Partial<IWaitlist>): Promise<string> {
        try {
            this._loading.set(true);
            const collectionRef = collection(this.firestore, this.collectionName);
            const docRef = await addDoc(collectionRef, {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
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
            const docRef = doc(this.firestore, this.collectionName, id);
            await updateDoc(docRef, {
                ...data,
                updatedAt: new Date(),
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
            const docRef = doc(this.firestore, this.collectionName, id);
            await deleteDoc(docRef);
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
}
