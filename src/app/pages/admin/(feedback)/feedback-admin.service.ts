import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import {
    Firestore, QueryConstraint, QueryDocumentSnapshot, Timestamp, collection, deleteDoc, doc, getDoc, getDocs,
    limit, orderBy, query, setDoc, startAfter, updateDoc, where,
} from '@angular/fire/firestore';
import { Storage, deleteObject, getDownloadURL, ref } from '@angular/fire/storage';
import { withStoragePrefix } from '../../../core/config/arc-config';
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
export function describeBrowser(raw: unknown = ''): string {
    const userAgent = typeof raw === 'string' ? raw : '';
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

/** The files a feedback item may have, in the sender's own folder. */
const FEEDBACK_FILES = {
    screenshotPath: ['screenshot.jpg'],
    voicePath: ['voice.mp4', 'voice.webm', 'voice.ogg'],
};

/**
 * The path when it is this item's own file, else undefined. The admin opens and
 * deletes these files, so a path naming anything else (another person's file,
 * the site's media) is never used (review F).
 */
export function ownFeedbackFile(
    item: { id: string; userDocId?: string }, kind: keyof typeof FEEDBACK_FILES, path: unknown, prefix?: string,
): string | undefined {
    if (typeof path !== 'string' || !item.userDocId) return undefined;
    const folder = withStoragePrefix(`users/${item.userDocId}/feedback/${item.id}/`, prefix);
    return FEEDBACK_FILES[kind].some((name) => path === folder + name) ? path : undefined;
}

const isMap = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 500): string | undefined => (typeof value === 'string' ? value.slice(0, max) : undefined);

/** A path on this site (`/about`), never another site's address, for the item's link. */
export function sitePath(value: unknown): string | undefined {
    const path = text(value);
    return path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : undefined;
}

/**
 * The item as the inbox shows it. Everything the browser wrote is read as the
 * type the page expects, so one malformed item (review F: a `userAgent` that
 * was a number stopped the list at that item) cannot break the inbox.
 */
export function toFeedbackItem(id: string, data: Record<string, any>): FeedbackItem {
    const created = data['createdAt'];
    const page = isMap(data['page']) ? data['page'] : null;
    const device = isMap(data['device']) ? data['device'] : null;
    const sender = isMap(data['sender']) ? data['sender'] : null;
    return {
        id,
        userDocId: text(data['userDocId']) ?? '',
        voiceSeconds: typeof data['voiceSeconds'] === 'number' ? data['voiceSeconds'] : undefined,
        page: page ? { path: sitePath(page['path']), title: text(page['title']) } : undefined,
        device: device ? {
            platform: text(device['platform']), userAgent: text(device['userAgent']), screen: text(device['screen']),
            viewport: text(device['viewport']), installed: device['installed'] === true, language: text(device['language']),
        } : undefined,
        sender: sender ? { name: text(sender['name']), email: text(sender['email']), phone: text(sender['phone']) } : undefined,
        message: typeof data['message'] === 'string' ? data['message'] : '',
        screenshotPath: ownFeedbackFile({ id, userDocId: text(data['userDocId']) }, 'screenshotPath', data['screenshotPath']),
        voicePath: ownFeedbackFile({ id, userDocId: text(data['userDocId']) }, 'voicePath', data['voicePath']),
        status: data['status'] === 'done' ? 'done' : 'new',
        createdAt: created instanceof Timestamp ? created.toDate() : null,
    };
}

function toItem(snap: QueryDocumentSnapshot): FeedbackItem {
    return toFeedbackItem(snap.id, snap.data() as Record<string, any>);
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
