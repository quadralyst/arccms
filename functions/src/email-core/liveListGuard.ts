/**
 * Contacts are never put on an App users (live) list (docs/coexistence-spec.md
 * 5b): its members are whoever matches its conditions at each use, so a
 * contact stored on it would be counted nowhere and mailed by nothing. The
 * admin pages do not offer live lists there (contactLists()); this refuses
 * them for any caller.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../init.js';

export async function refuseLiveLists(listIds: string[]): Promise<void> {
    const ids = [...new Set(listIds.filter(Boolean))];
    if (!ids.length) return;
    const snaps = await db.getAll(...ids.map((id) => db.collection('Lists').doc(id)));
    const live = snaps.filter((snap) => snap.exists && snap.data()?.['type'] === 'app');
    if (live.length) {
        const names = live.map((snap) => `"${snap.data()?.['name'] || snap.id}"`).join(', ');
        throw new HttpsError(
            'failed-precondition',
            `${names} ${live.length === 1 ? 'is an App users (live) list' : 'are App users (live) lists'}: `
            + 'its members are whoever matches its conditions, so contacts cannot be added to it.',
        );
    }
}
