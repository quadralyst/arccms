import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import {
  upsertContact,
  unlinkUserContact,
  ensureFormList,
  ensureSystemLists,
  getContactConsent,
  setContactConsent,
  SYSTEM_LISTS,
  waitlistListId,
  type MarketingConsent,
} from './contacts.js';
import { addTagsToContact } from './contactTags.js';
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
      };
    }
  } catch { /* fall through to defaults */ }
  return { name: `Waitlist ${waitlistId}`, targetListIds: [ownListId] };
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
      if (current === 'pending' || (current === 'subscribed' && desired === 'unsubscribed')) {
        await setContactConsent(emailHash, desired, after.email);
      }

      await emitAppEvent('waitlist.joined', { contactEmail: after.email, data: { waitlistId } });
    } catch (err) {
      logger.error('onWaitlistVerifiedContact failed', err);
    }
  },
);
