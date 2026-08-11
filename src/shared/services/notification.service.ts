import { inject, Injectable } from '@angular/core';
import {
    Firestore, collection, collectionData, doc, updateDoc, getDocs, query, where, orderBy, limit, serverTimestamp, getDoc,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, catchError } from 'rxjs';
import { INotification, INotificationTypeConfig } from './notification.model';

/**
 * User-facing notifications (Phase 5). Reads the signed-in user's notifications
 * in realtime, flips `read`, and updates per-type email preferences via a
 * callable (Contacts are functions-only).
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);

    /** Realtime recent notifications for a user (most recent first). */
    watch(uid: string, max = 30): Observable<INotification[]> {
        if (!uid) return of([]);
        const ref = collection(this.firestore, 'Notifications');
        return (collectionData(
            query(ref, where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(max)),
            { idField: 'id' },
        ) as Observable<INotification[]>).pipe(
            // Never let a transient query failure (missing index, permission blip)
            // silently render an empty "all caught up" state with no trace — log it
            // and fall back to empty so the stream stays alive.
            catchError((err) => {
                console.error('NotificationService.watch failed:', err);
                return of([]);
            }),
        );
    }

    async markRead(id: string): Promise<void> {
        await updateDoc(doc(this.firestore, 'Notifications', id), { read: true, readAt: serverTimestamp() });
    }

    async markAllRead(uid: string): Promise<void> {
        const ref = collection(this.firestore, 'Notifications');
        const snap = await getDocs(query(ref, where('userId', '==', uid), where('read', '==', false), limit(200)));
        await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { read: true, readAt: serverTimestamp() })));
    }

    /** The notification-type registry (for the preference center). */
    async getTypeRegistry(): Promise<Record<string, INotificationTypeConfig>> {
        const snap = await getDoc(doc(this.firestore, 'Settings', 'notification_types'));
        return (snap.data()?.['types'] as Record<string, INotificationTypeConfig>) || {};
    }

    updatePrefs(prefs: Record<string, { email: boolean }>) {
        return httpsCallable(this.functions, 'updateMyNotificationPrefs')({ prefs });
    }

    getMyPrefs() {
        return httpsCallable<unknown, { types: Array<{ key: string; label: string; description: string }>; prefs: Record<string, { email?: boolean }> }>(
            this.functions, 'getMyNotificationPrefs',
        )({});
    }
}
