// waitlists/onWaitlistsCreate.ts
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { ensureFormList } from '../email-core/contacts.js';
import { buildWaitlistTemplateDefs, waitlistTemplateDocId } from '../email-core/defaultTemplates.js';

/**
 * A new signup form (waitlist) gets:
 *  1. its mirrored audience list, created eagerly so the form shows up under
 *     Audience → Lists immediately — before anyone has signed up. (Membership
 *     still only arrives via contact sync; the list starts at memberCount 0.)
 *  2. its own default OTP + welcome templates, so each form can carry its own
 *     content and layout.
 *
 * Both steps are idempotent: a retried or re-fired trigger upserts the same
 * list and the same two template docs rather than duplicating them.
 */
export const onWaitlistsCreate = onDocumentCreated('Waitlists/{waitlistsId}', async (event: any) => {
  const waitlistsId = event.params.waitlistsId;
  const name = event.data?.data()?.['name'] || `Waitlist ${waitlistsId}`;

  // The list must not block template seeding (and vice versa) if it throws.
  try {
    await ensureFormList(waitlistsId, name);
  } catch (error) {
    logger.error(`Failed to ensure list for Waitlist ${waitlistsId}`, error);
  }

  // Fetch email settings
  const settingsRef = db.collection('Settings').doc('email');
  const settingsSnap = await settingsRef.get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};

  const senderName = settings?.senderName || '';
  const senderEmail = settings?.senderEmail || '';

  // Deterministic per-waitlist doc ids (`<waitlistId>_<type>`) so a retried or
  // re-fired create trigger upserts the same two docs instead of adding a
  // second copy each run. Existing docs are left untouched to preserve any
  // admin edits.
  let created = 0;
  const batch = db.batch();
  const defs = buildWaitlistTemplateDefs();

  for (const def of defs) {
    const docId = waitlistTemplateDocId(waitlistsId, def.type);
    const docRef = db.collection('EmailTemplate').doc(docId);
    const existing = await docRef.get();
    if (existing.exists) continue;
    const now = new Date();
    batch.set(docRef, {
      id: docId,
      waitlistId: waitlistsId,
      type: def.type,
      category: def.category,
      subject: def.subject,
      title: def.title,
      previewText: def.previewText,
      template: def.body,
      senderName,
      senderEmail,
      isActive: true,
      createdAt: now,
      createdBy: 'system',
      modifiedAt: now,
      modifiedBy: 'system',
    });
    created++;
  }

  if (created > 0) await batch.commit();

  console.log(`Ensured ${defs.length} EmailTemplate docs for Waitlist ${waitlistsId} (created ${created}).`);
});
