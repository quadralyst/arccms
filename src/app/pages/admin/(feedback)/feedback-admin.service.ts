import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import {
    Firestore, QueryConstraint, QueryDocumentSnapshot, Timestamp, collection, deleteDoc, doc, getDoc, getDocs,
    limit, orderBy, query, setDoc, startAfter, updateDoc, where,
} from '@angular/fire/firestore';
import { Storage, deleteObject, getDownloadURL, ref } from '@angular/fire/storage';
import { FEEDBACK_COLLECTION, FEEDBACK_SETTINGS } from '../../../core/feedback/feedback.service';

export type FeedbackStatus = 'new' | 'done';
export type FeedbackFilter = FeedbackStatus | 'all';

export interface FeedbackItem {
    id: string;
    userDocId: string;
    message: string;
    screenshotPath?: string;
    voicePath?: string;
    voiceSeconds?: number;
    page?: { path?: string; title?: string };
    device?: { platform?: string; userAgent?: string; screen?: string; viewport?: string; installed?: boolean; language?: string };
    sender?: { name?: string; email?: string; phone?: string };
    status: FeedbackStatus;
    createdAt: Date | null;
    /** Download links, filled in after loading. */
    screenshotUrl?: string;
    voiceUrl?: string;
}

export const PAGE_SIZE = 25;

/** "Chrome on Android", from the browser's own description. */
export function describeBrowser(userAgent = ''): string {
    const browser = /Edg\//.test(userAgent) ? 'Edge'
        : /CriOS|Chrome\//.test(userAgent) ? 'Chrome'
            : /FxiOS|Firefox\//.test(userAgent) ? 'Firefox'
                : /Safari\//.test(userAgent) ? 'Safari' : '';
    const system = /Android/.test(userAgent) ? 'Android'
        : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS'
            : /Windows/.test(userAgent) ? 'Windows'
                : /Mac OS X|Macintosh/.test(userAgent) ? 'macOS'
                    : /Linux/.test(userAgent) ? 'Linux' : '';
    return [browser, system].filter(Boolean).join(' on ') || userAgent.slice(0, 60);
}

function toItem(snap: QueryDocumentSnapshot): FeedbackItem {
    const data = snap.data() as Record<string, any>;
    const created = data['createdAt'];
    return {
        ...(data as Omit<FeedbackItem, 'id' | 'createdAt'>),
        id: snap.id,
        message: typeof data['message'] === 'string' ? data['message'] : '',
        status: data['status'] === 'done' ? 'done' : 'new',
        createdAt: created instanceof Timestamp ? created.toDate() : null,
    };
}

/** The admin Feedback inbox (docs/feedback.md). */
@Injectable({ providedIn: 'root' })
export class FeedbackAdminService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);
    private injector = inject(Injector);

    readonly items = signal<FeedbackItem[]>([]);
    readonly loading = signal(false);
    readonly hasMore = signal(false);
    readonly enabled = signal(false);
    private last: QueryDocumentSnapshot | null = null;

    private run<T>(fn: () => T): T {
        return runInInjectionContext(this.injector, fn);
    }

    /** The first page for a filter, or the next page with `more`. */
    async load(filter: FeedbackFilter, more = false): Promise<void> {
        this.loading.set(true);
        try {
            const constraints: QueryConstraint[] = [
                ...(filter === 'all' ? [] : [where('status', '==', filter)]),
                orderBy('createdAt', 'desc'),
                ...(more && this.last ? [startAfter(this.last)] : []),
                limit(PAGE_SIZE),
            ];
            const snap = await this.run(() => getDocs(query(collection(this.firestore, FEEDBACK_COLLECTION), ...constraints)));
            this.last = snap.docs[snap.docs.length - 1] ?? this.last;
            this.hasMore.set(snap.docs.length === PAGE_SIZE);
            const page = await Promise.all(snap.docs.map((d) => this.withLinks(toItem(d))));
            this.items.set(more ? [...this.items(), ...page] : page);
        } finally {
            this.loading.set(false);
        }
    }

    async setStatus(item: FeedbackItem, status: FeedbackStatus): Promise<void> {
        await this.run(() => updateDoc(doc(this.firestore, FEEDBACK_COLLECTION, item.id), { status }));
        this.items.set(this.items().map((i) => (i.id === item.id ? { ...i, status } : i)));
    }

    /** Deletes the files, then the feedback. */
    async remove(item: FeedbackItem): Promise<void> {
        for (const path of [item.screenshotPath, item.voicePath]) {
            if (!path) continue;
            await this.run(() => deleteObject(ref(this.storage, path))).catch(() => undefined); // already gone
        }
        await this.run(() => deleteDoc(doc(this.firestore, FEEDBACK_COLLECTION, item.id)));
        this.items.set(this.items().filter((i) => i.id !== item.id));
    }

    async loadSetting(): Promise<void> {
        const snap = await this.run(() => getDoc(doc(this.firestore, 'Settings', FEEDBACK_SETTINGS)));
        this.enabled.set(snap.data()?.['enabled'] === true);
    }

    async setEnabled(enabled: boolean): Promise<void> {
        await this.run(() => setDoc(doc(this.firestore, 'Settings', FEEDBACK_SETTINGS), { enabled }, { merge: true }));
        this.enabled.set(enabled);
    }

    private async withLinks(item: FeedbackItem): Promise<FeedbackItem> {
        const link = (path?: string) =>
            path ? this.run(() => getDownloadURL(ref(this.storage, path))).catch(() => undefined) : Promise.resolve(undefined);
        const [screenshotUrl, voiceUrl] = await Promise.all([link(item.screenshotPath), link(item.voicePath)]);
        return { ...item, screenshotUrl, voiceUrl };
    }
}
