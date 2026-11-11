/**
 * Admin: delete a form, from Forms > Delete.
 *
 * Deleting only the form's document left its tags behind, and its sign-ups to a
 * trigger that could stop without finishing. This removes all three, on the
 * server, in this order:
 *
 * 1. the form's tags, `WaitlistUserTags_{id}`;
 * 2. the form itself, `Waitlists/{id}`;
 * 3. the sign-ups, `Waitlists/{id}/users`, with their notes, and anything else
 *    stored under the form (Firestore's recursive delete, in batches).
 *
 * The form goes before its sign-ups on purpose. `onWaitlistUserDeleted`
 * (email-core/contactSync.ts) takes a deleted sign-up off the form's list one
 * by one, unless the form is already gone: deleting the form first lets the
 * form's list go once, in `onWaitlistsDelete` (`deleteFormList`), instead of a
 * list write per sign-up.
 *
 * Finishing a delete that stopped halfway:
 * - stopped during step 1: the form is still listed; press Delete again;
 * - stopped during step 3: the form is no longer listed, and two things finish
 *   the sign-ups. `onWaitlistsDelete`, which runs because the form was deleted,
 *   deletes everything under the form; and calling this function again with the
 *   same `formId` deletes whatever is left (every step is safe to repeat).
 *
 * Input:  { formId: string }
 * Output: { deleted: boolean, signups: number, tags: number }
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { requireAdmin } from '../search/auth.js';

/** The collection that holds a form's tags (src/app/pages/admin/(waitlists)/joined-users/waitlist-user-tags.model.ts). */
export function formTagsCollection(formId: string): string {
    return `WaitlistUserTags_${formId}`;
}

/** Long enough for a form with tens of thousands of sign-ups; the browser waits as long. */
export const DELETE_FORM_TIMEOUT_SECONDS = 300;

export const adminDeleteForm = onCall({ timeoutSeconds: DELETE_FORM_TIMEOUT_SECONDS }, async (request) => {
    await requireAdmin(request);
    const formId = typeof request.data?.formId === 'string' ? request.data.formId.trim() : '';
    if (!formId || formId.includes('/')) {
        throw new HttpsError('invalid-argument', 'Which form? The form id is missing.');
    }

    const formRef = db.collection('Waitlists').doc(formId);
    const signupsRef = formRef.collection('users');
    const tagsRef = db.collection(formTagsCollection(formId));

    const [form, signupCount, tagCount] = await Promise.all([
        formRef.get(),
        signupsRef.count().get(),
        tagsRef.count().get(),
    ]);
    const signups = signupCount.data().count;
    const tags = tagCount.data().count;

    // 1. Tags. 2. The form document only, so the sign-up trigger stands down
    // (see above). 3. Everything under the form: the sign-ups and their notes.
    if (tags > 0) await db.recursiveDelete(tagsRef);
    if (form.exists) await formRef.delete();
    await db.recursiveDelete(formRef);

    return { deleted: form.exists, signups, tags };
});
