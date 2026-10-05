import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import {
    Firestore, QueryConstraint, QueryDocumentSnapshot, Timestamp, collection, deleteDoc, doc, getDocs,
    limit, orderBy, query, startAfter, updateDoc, where,
} from '@angular/fire/firestore';

/**
 * The admin Messages inbox: what people sent with the site's contact form
 * (specs/site-sections-spec.md, SS5). submitContactMessage writes the messages;
 * admins read them, mark them done or not spam, and delete them.
 */

export const CONTACT_MESSAGES = 'ContactMessages';

export type MessageStatus = 'new' | 'done' | 'spam';

export interface ContactMessageItem {
    id: string;
    name: string;
    email: string;
    phone: string;
    subject: string;
    message: string;
    /** The page it was sent from, a path on this site. */
    page: string;
    status: MessageStatus;
    createdAt: Date | null;
}

export const PAGE_SIZE = 25;

const text = (value: unknown, max = 5000): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** A path on this site (`/info/contact`), never another site's address. */
function sitePath(value: unknown): string {
    const path = text(value, 500);
    return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '';
}

/** The message as the inbox shows it; a malformed field reads as empty rather than breaking the list. */
export function toContactMessage(id: string, data: Record<string, any>): ContactMessageItem {
    const created = data['createdAt'];
    const status = data['status'];
    return {
        id,
        name: text(data['name'], 100),
        email: text(data['email'], 254),
        phone: text(data['phone'], 40),
        subject: text(data['subject'], 200),
        message: text(data['message']),
        page: sitePath(data['page']),
        status: status === 'done' || status === 'spam' ? status : 'new',
        createdAt: created instanceof Timestamp ? created.toDate() : null,
    };
}

/**
 * A `mailto:` link that answers the message in the admin's own email client:
 * "Re:" and the subject (or the start of the message), and the message quoted.
 */
export function replyLink(item: ContactMessageItem): string {
    const topic = item.subject || item.message.replace(/\s+/g, ' ').slice(0, 60);
    const quoted = item.message.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
    const params = new URLSearchParams({ subject: `Re: ${topic}`, body: `\n\n${quoted}` });
    // URLSearchParams writes spaces as "+", which mail clients show literally.
    return `mailto:${encodeURIComponent(item.email).replace(/%40/g, '@')}?${params.toString().replace(/\+/g, '%20')}`;
}

@Injectable({ providedIn: 'root' })
export class MessagesAdminService {
    private firestore = inject(Firestore);
    private injector = inject(Injector);

    readonly items = signal<ContactMessageItem[]>([]);
    readonly loading = signal(false);
    readonly hasMore = signal(false);
    private last: QueryDocumentSnapshot | null = null;

    private run<T>(fn: () => T): T {
        return runInInjectionContext(this.injector, fn);
    }

    /** The first page of a status, or the next page with `more`. */
    async load(status: MessageStatus, more = false): Promise<void> {
        this.loading.set(true);
        try {
            const constraints: QueryConstraint[] = [
                where('status', '==', status),
                orderBy('createdAt', 'desc'),
                ...(more && this.last ? [startAfter(this.last)] : []),
                limit(PAGE_SIZE),
            ];
            const snap = await this.run(() => getDocs(query(collection(this.firestore, CONTACT_MESSAGES), ...constraints)));
            this.last = snap.docs[snap.docs.length - 1] ?? (more ? this.last : null);
            this.hasMore.set(snap.docs.length === PAGE_SIZE);
            const page = snap.docs.map((d) => toContactMessage(d.id, d.data() as Record<string, any>));
            this.items.set(more ? [...this.items(), ...page] : page);
        } finally {
            this.loading.set(false);
        }
    }

    /** Moves a message to another status; it leaves the list being shown. */
    async setStatus(item: ContactMessageItem, status: MessageStatus): Promise<void> {
        await this.run(() => updateDoc(doc(this.firestore, CONTACT_MESSAGES, item.id), { status }));
        this.items.set(this.items().filter((i) => i.id !== item.id));
    }

    async remove(item: ContactMessageItem): Promise<void> {
        await this.run(() => deleteDoc(doc(this.firestore, CONTACT_MESSAGES, item.id)));
        this.items.set(this.items().filter((i) => i.id !== item.id));
    }
}
