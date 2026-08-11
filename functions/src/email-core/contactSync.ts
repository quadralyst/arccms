import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import {
  upsertContact,
  unlinkUserContact,
  removeContactFromLists,
  ensureFormList,
  ensureSystemLists,
  getContactConsent,
  setContactConsent,
  SYSTEM_LISTS,
  waitlistListId,
  type MarketingConsent,
} from './contacts.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { addTagsToContact } from './contactTags.js';
import { setContactFields } from './contactFields.js';
import { flushDueEnrollments } from './dripSend.js';
import type { WaitlistUserData } from '../types.js';
import { emitAppEvent } from './appEvents.js';

/**
 * Contacts auto-sync (spec §Phase-3.1). Each product moment that creates or
 * changes an audience member mirrors into the unified `Contacts` layer.
 */

/**
 * Consent a form signup implies, from the member doc alone (U2).
 *
 * A member who hasn't confirmed their address is `pending`: they exist in the
 * audience and are counted, but are not mailable until they verify. Direct-join
 * forms skip OTP and create the member already verified, so they start
 * `subscribed`. An explicit `isSubscribed: false` always wins — that is a stated
 * opt-out, not an unconfirmed address.
 */
function signupConsent(member: WaitlistUserData): MarketingConsent {
  if (member.isSubscribed === false) return 'unsubscribed';
  return member.emailVerified === true ? 'subscribed' : 'pending';
}

interface FormMeta {
  name: string;
  defaultTagId?: string;
  /** Every list this form feeds. Always includes its own system list (U3). */
  targetListIds: string[];
  /** form input name → contact field key (U4.5). */
  fieldMap?: Record<string, string>;
}

/**
 * A form's display name, default tag, and the lists it feeds, in one read (U3).
 *
 * A form is a capture surface that can feed any list(s) — its own mirrored
 * `waitlist-{id}` system list plus any manual lists the admin picked. The own
 * system list is always a target (v1 decision, spec open item #1), so it is
 * unioned in even if a stored `targetListIds` omits it.
 */
async function readFormMeta(waitlistId: string): Promise<FormMeta> {
  const ownListId = waitlistListId(waitlistId);
  try {
    const wl = await db.collection('Waitlists').doc(waitlistId).get();
    if (wl.exists) {
      const data = wl.data()!;
      const stored: string[] = Array.isArray(data['targetListIds']) ? data['targetListIds'] : [];
      return {
        name: data['name'] || `Waitlist ${waitlistId}`,
        defaultTagId: data['defaultTagId'],
        targetListIds: [...new Set([ownListId, ...stored.filter(Boolean)])],
        fieldMap: (data['fieldMap'] as Record<string, string>) || undefined,
      };
    }
  } catch { /* fall through to defaults */ }
  return { name: `Waitlist ${waitlistId}`, targetListIds: [ownListId] };
}

/**
 * Copy a member's mapped `formData` onto the contact's custom fields (U4.5).
 *
 * Never throws into the caller: losing a custom field is not a reason to fail the
 * contact sync that carries consent and list membership.
 */
async function applyFormFields(
  emailHash: string,
  form: FormMeta,
  member: WaitlistUserData & { formData?: Record<string, unknown> },
): Promise<void> {
  const fieldMap = form.fieldMap;
  const formData = member.formData;
  if (!fieldMap || !formData) return;

  const values: Record<string, unknown> = {};
  for (const [formField, fieldKey] of Object.entries(fieldMap)) {
    const v = formData[formField];
    if (v !== undefined && v !== null && v !== '') values[fieldKey] = v;
  }
  if (!Object.keys(values).length) return;

  try {
    await setContactFields(emailHash, values);
  } catch (err) {
    logger.error('applyFormFields failed', err);
  }
}

/** New user → contact (source `signup`), joins the `all-users` system list. */
export const onUserCreateContact = onDocumentCreated('users/{docId}', async (event) => {
  const user = event.data?.data();
  const email: string | undefined = user?.['email'];
  if (!user || !email) return;

  try {
    await ensureSystemLists();
    await upsertContact({
      email,
      name: user['name'],
      firstName: user['firstName'],
      userId: user['uid'],
      source: 'signup',
      addLists: [SYSTEM_LISTS.ALL_USERS],
    });
  } catch (err) {
    logger.error('onUserCreateContact failed', err);
  }
});

/** User deleted → unlink + drop from system lists (cleanup). */
export const onUserDeleteContact = onDocumentDeleted('users/{docId}', async (event) => {
  const email: string | undefined = event.data?.data()?.['email'];
  if (!email) return;
  try {
    await unlinkUserContact(email);
  } catch (err) {
    logger.error('onUserDeleteContact failed', err);
  }
});

/**
 * Form signup → contact immediately (U2), normally `pending`.
 *
 * Before U2 a contact only appeared once the member verified, so the audience
 * under-reported everyone mid-funnel. The contact now exists from the moment of
 * signup and {@link onWaitlistVerifiedContact} flips it to `subscribed` on
 * verification.
 *
 * A returning contact is never regressed: `upsertContact` only applies `consent`
 * when it creates the doc, so an already-`subscribed` person joining a second
 * form keeps their consent (and an `unsubscribed` one stays suppressed).
 */
export const onWaitlistUserCreateContact = onDocumentCreated(
  'Waitlists/{waitlistId}/users/{userId}',
  async (event) => {
    const member = event.data?.data() as WaitlistUserData | undefined;
    if (!member?.email) return;

    const waitlistId = event.params.waitlistId;

    try {
      const form = await readFormMeta(waitlistId);
      // Own system list gets its formId back-pointer; the rest already exist.
      await ensureFormList(waitlistId, form.name);
      const { emailHash } = await upsertContact({
        email: member.email,
        name: member.name,
        firstName: member.firstName,
        source: 'waitlist',
        addLists: form.targetListIds,
        consent: signupConsent(member),
      });

      // A form's default tag applies to everyone it captures (U2). Tags are
      // global, so this is how "came in through the beta form" stays queryable
      // across lists.
      if (form.defaultTagId) {
        await addTagsToContact(emailHash, [form.defaultTagId]);
      }

      // Arbitrary form inputs become durable contact data (U4.5), so any send to
      // any list can merge them. The default `fill` policy means a second form
      // never overwrites what this person told us first.
      await applyFormFields(emailHash, form, member);
    } catch (err) {
      logger.error('onWaitlistUserCreateContact failed', err);
    }
  },
);

/** Waitlist member becomes verified → contact (source `waitlist`), joins `waitlist-{id}`. */
export const onWaitlistVerifiedContact = onDocumentUpdated(
  'Waitlists/{waitlistId}/users/{userId}',
  async (event) => {
    const before = event.data?.before.data() as WaitlistUserData | undefined;
    const after = event.data?.after.data() as WaitlistUserData | undefined;
    if (!before || !after) return;

    const justVerified = before.emailVerified !== true && after.emailVerified === true;
    if (!justVerified || !after.email) return;

    const waitlistId = event.params.waitlistId;

    try {
      const form = await readFormMeta(waitlistId);
      await ensureFormList(waitlistId, form.name);
      // Still upsert: the contact normally exists already (created pending at
      // signup), but this repairs members who predate U2's create trigger or
      // whose create-time write failed. `consent` here only lands on creation.
      const { emailHash } = await upsertContact({
        email: after.email,
        name: after.name,
        firstName: after.firstName,
        source: 'waitlist',
        addLists: form.targetListIds,
        consent: signupConsent(after),
      });

      // Verification is the moment a pending contact becomes mailable, and
      // upsertContact won't touch consent on an existing doc — so promote here.
      // Only `pending` is promoted: an `unsubscribed` contact must not be
      // resurrected by verifying an address, and a `subscribed` one is already
      // where it needs to be. An explicit isSubscribed:false still suppresses.
      const desired = signupConsent(after);
      const current = await getContactConsent(emailHash);
      const promoted = current === 'pending' && desired === 'subscribed';
      if (current === 'pending' || (current === 'subscribed' && desired === 'unsubscribed')) {
        await setContactConsent(emailHash, desired, after.email);
      }

      // Verification is when a held day-0 step becomes sendable (U5).
      //
      // The enrollment itself happened at signup, when the contact was still
      // `pending` — so the welcome step was held by the marketing gate. Flushing
      // here is what makes the welcome arrive in seconds; without it the contact
      // would wait for the next 15-minute scheduler tick, and a "you're in!"
      // email that late reads as broken.
      if (promoted) {
        try {
          await flushDueEnrollments(emailHash);
        } catch (err) {
          logger.error('onWaitlistVerifiedContact: day-0 flush failed', err);
        }
      }

      await emitAppEvent('waitlist.joined', { contactEmail: after.email, data: { waitlistId } });
    } catch (err) {
      logger.error('onWaitlistVerifiedContact failed', err);
    }
  },
);

/**
 * Member doc deleted → the contact leaves that form's mirrored list.
 *
 * `waitlist-{id}` mirrors a form's member docs, and every other edge of that
 * mirror was already covered (create, verify, whole-form delete) — but deleting
 * a single member doc, which is what the joined-users admin page does, left the
 * contact holding the listId. The person stayed in the list's audience and in
 * its drip campaigns despite no longer being a member of the form; on the dev
 * project 13 test contacts still carried `waitlist-*` memberships this way.
 *
 * Two deliberate limits on what this removes:
 *
 * - **Only the form's OWN list**, never the manual lists in `targetListIds`. A
 *   form *feeds* those lists; it does not own them. The same person may have
 *   joined `newsletter` through a second form or an import, and a member-doc
 *   delete must not silently revoke a membership this form did not create.
 * - **The contact itself is never deleted**, even when this was its only list.
 *   Erasure is a distinct, explicit act — `adminDeleteContact`
 *   (`email-core/eraseContact.ts`), behind a confirmation — and it is the only
 *   path that may destroy an address. Cleaning up a test signup, or pruning one
 *   form's members, must not quietly erase someone who may still be reachable
 *   through another list, or whose consent record we are obliged to keep.
 */
export const onWaitlistUserDeleted = onDocumentDeleted(
  'Waitlists/{waitlistId}/users/{userId}',
  async (event) => {
    const member = event.data?.data() as WaitlistUserData | undefined;
    if (!member?.email) return;

    const waitlistId = event.params.waitlistId;

    try {
      // The whole form is going away, not one member: `onWaitlistsDelete` owns
      // that cleanup (it deletes the member docs, then `deleteFormList` drops
      // every membership AND the list doc). Racing it is actively harmful —
      // `removeContactFromLists` writes `Lists/{id}` with merge, so a decrement
      // landing after the list doc was deleted would resurrect it as an orphan
      // with a negative `memberCount`, which is the exact defect U1 fixed.
      const form = await db.collection('Waitlists').doc(waitlistId).get();
      if (!form.exists) return;

      const emailHash = computeEmailHash(member.email);
      // The chokepoint, not a direct listIds write: it keeps `memberCount`
      // correct in the same transaction and exits the contact from that list's
      // drip campaigns, which is the half a manual write silently skips (U7).
      const left = await removeContactFromLists(emailHash, [waitlistListId(waitlistId)]);
      if (left.length) {
        logger.info(`onWaitlistUserDeleted: ${emailHash} left ${left.join(', ')}`);
      }
    } catch (err) {
      logger.error('onWaitlistUserDeleted failed', err);
    }
  },
);
