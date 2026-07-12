import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailCategory, EmailTemplateData } from '../types.js';
import { createNotification } from './notifications.js';
import { queueEmail } from './queueEmail.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { upsertContact, addContactToLists, removeContactFromLists } from './contacts.js';

/**
 * Generic event bus (spec §3.11, D11). Product code calls {@link emitAppEvent};
 * admin-configurable mappings in `Settings/event_mappings` turn events into
 * notifications / emails / list changes. Mappings for the built-in moments ship
 * DISABLED so they don't double up with the direct behaviour — they exist as
 * configurable hooks.
 */

export interface EventMapping {
  enabled: boolean;
  createNotification?: { typeKey: string; titleTemplate: string; bodyTemplate: string; link?: string };
  sendEmail?: { templateType: string; category: EmailCategory };
  addToLists?: string[];
  removeFromLists?: string[];
  enrollInDrip?: string;
}

export interface AppEventPayload {
  userId?: string;
  contactEmail?: string;
  data?: Record<string, unknown>;
}

/** Built-in event mappings, shipped disabled. */
export const DEFAULT_EVENT_MAPPINGS: Record<string, EventMapping> = {
  'user.signed_up': { enabled: false, addToLists: ['all-users'] },
  'payment.succeeded': { enabled: false, addToLists: ['all-customers'] },
  'payment.failed': { enabled: false },
  'waitlist.joined': { enabled: false },
};

/** Idempotently seed the event-mapping registry (missing keys only). */
export async function ensureEventMappings(): Promise<void> {
  const ref = db.collection('Settings').doc('event_mappings');
  const snap = await ref.get();
  const existing = (snap.data()?.['mappings'] as Record<string, EventMapping>) || {};
  const merged = { ...DEFAULT_EVENT_MAPPINGS };
  for (const [k, v] of Object.entries(existing)) merged[k] = v;
  await ref.set({ mappings: merged }, { merge: true });
}

/** Emit an app event for the bus to process (in ADDITION to any direct behaviour). */
export async function emitAppEvent(type: string, payload: AppEventPayload = {}): Promise<string> {
  const doc: Record<string, unknown> = {
    type,
    createdAt: Timestamp.now(),
    processed: false,
  };
  if (payload.userId) doc['userId'] = payload.userId;
  if (payload.contactEmail) doc['contactEmail'] = payload.contactEmail;
  if (payload.data) doc['data'] = payload.data;
  const ref = await db.collection('AppEvents').add(doc);
  return ref.id;
}

function fillTemplate(tpl: string, data: Record<string, unknown>): string {
  return (tpl || '').replace(/##([A-Z_]+)##/g, (_, key) => {
    const camel = key.toLowerCase().replace(/_([a-z])/g, (_m: string, c: string) => c.toUpperCase());
    const v = data[key] ?? data[key.toLowerCase()] ?? data[camel];
    return v == null ? '' : String(v);
  });
}

/** Process an AppEvent against its mapping. */
export const onAppEventCreate = onDocumentCreated('AppEvents/{id}', async (event) => {
  const data = event.data?.data();
  const id = event.params.id;
  if (!data || data['processed'] === true) return;

  const ref = db.collection('AppEvents').doc(id);
  const type: string = data['type'];
  const results: Record<string, unknown> = {};

  try {
    const mappingSnap = await db.collection('Settings').doc('event_mappings').get();
    const mappings = (mappingSnap.data()?.['mappings'] as Record<string, EventMapping>) || {};
    const mapping = mappings[type];

    if (!mapping) {
      await ref.update({ processed: true, processedAt: Timestamp.now(), results: { status: 'no_mapping' } });
      return;
    }
    if (!mapping.enabled) {
      await ref.update({ processed: true, processedAt: Timestamp.now(), results: { status: 'disabled' } });
      return;
    }

    const eventData = (data['data'] as Record<string, unknown>) || {};
    const userId: string | undefined = data['userId'];
    const email: string | undefined = data['contactEmail'] || (await resolveUserEmail(userId));

    // 1. Create an in-app notification.
    if (mapping.createNotification && userId) {
      try {
        const nid = await createNotification({
          userId,
          type: mapping.createNotification.typeKey,
          title: fillTemplate(mapping.createNotification.titleTemplate, eventData),
          body: fillTemplate(mapping.createNotification.bodyTemplate, eventData),
          link: mapping.createNotification.link,
          createdBy: `event:${type}`,
        });
        results['notification'] = nid;
      } catch (e) {
        results['notification'] = `error: ${(e as Error).message}`;
      }
    }

    // 2. Queue an email.
    if (mapping.sendEmail && email) {
      try {
        const tpl = await loadTemplate(mapping.sendEmail.templateType);
        if (tpl) {
          const r = await queueEmail({
            source: 'event',
            category: mapping.sendEmail.category,
            toEmail: email,
            senderEmail: tpl.senderEmail,
            senderName: tpl.senderName,
            subject: tpl.subject,
            template: tpl.template,
            text: tpl.previewText || '',
            type: mapping.sendEmail.templateType,
            templateIsActive: tpl.isActive !== false,
            data: eventData,
          });
          results['email'] = r.status;
        } else {
          results['email'] = 'no_template';
        }
      } catch (e) {
        results['email'] = `error: ${(e as Error).message}`;
      }
    }

    // 3. List membership.
    if (email && (mapping.addToLists?.length || mapping.removeFromLists?.length)) {
      try {
        const emailHash = computeEmailHash(email);
        await upsertContact({ email, source: 'manual' });
        if (mapping.addToLists?.length) results['addedToLists'] = await addContactToLists(emailHash, mapping.addToLists);
        if (mapping.removeFromLists?.length) results['removedFromLists'] = await removeContactFromLists(emailHash, mapping.removeFromLists);
      } catch (e) {
        results['lists'] = `error: ${(e as Error).message}`;
      }
    }

    // enrollInDrip is handled in Phase 7.

    await ref.update({ processed: true, processedAt: Timestamp.now(), results: { status: 'ok', ...results } });
  } catch (err) {
    logger.error(`onAppEventCreate: failed for ${id}`, err);
    await ref.update({ processed: true, processedAt: Timestamp.now(), results: { status: 'error', message: (err as Error).message } });
  }
});

async function resolveUserEmail(userId?: string): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const snap = await db.collection('users').where('uid', '==', userId).limit(1).get();
    return snap.empty ? undefined : snap.docs[0].data()['email'];
  } catch {
    return undefined;
  }
}

async function loadTemplate(templateType: string): Promise<(EmailTemplateData & { isActive?: boolean }) | null> {
  const snap = await db.collection('EmailTemplate').where('type', '==', templateType).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as EmailTemplateData & { isActive?: boolean });
}
