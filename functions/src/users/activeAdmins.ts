/**
 * The site always keeps an active admin (RF4). Whatever would remove, block, demote or
 * detach an admin checks here first: Users (adminUserAccess.ts), an app deleting an
 * account (app-kit deleteAppAccount) and an email or number moving to another account
 * (auth/linkIdentifiers.ts).
 */
import type { Transaction } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { refuse } from '../auth/refusal.js';
import { isBlockedRecord } from './syncUserRole.js';

export const LAST_ADMIN = 'This is the only active admin. Make someone else an admin first.';

/** An admin who can still sign in: role admin, not blocked or detached. */
export function isActiveAdmin(data: Record<string, unknown> | undefined): boolean {
    return !!data && data['role'] === 'admin' && !isBlockedRecord(data);
}

type QueryReader = (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>;

/**
 * Refuse (`last-admin`) unless another active admin stays once the record `id`, with
 * the sign-in `uid`, stops being one: an active admin on another record, with a
 * sign-in of its own that is not this one. Pass `tx` inside a transaction.
 */
export async function requireAnotherActiveAdmin(tx: Transaction | null, id: string, uid: unknown, message = LAST_ADMIN): Promise<void> {
    const read: QueryReader = tx ? (query) => tx.get(query) : (query) => query.get();
    const admins = await read(db.collection('users').where('role', '==', 'admin'));
    const other = admins.docs.some((d) => {
        const data = d.data();
        const otherUid = typeof data['uid'] === 'string' ? data['uid'] : '';
        return d.id !== id && !!otherUid && otherUid !== uid && isActiveAdmin(data);
    });
    if (!other) throw refuse('failed-precondition', 'last-admin', message);
}
