import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailTemplateData } from '../types.js';
import { createNotification } from './notifications.js';
import { queueEmail } from './queueEmail.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { upsertContact, addContactToLists, removeContactFromLists } from './contacts.js';
import { isFeatureOn } from '../feature-flags.js';
import { arcDocument } from '../arc-config.js';
import { applicableRules, type EventMapping, type EventRule } from './eventRules.js';
import { APP_AUDIENCE_STATE, stateFrom } from '../app-audience/state.js';
import { readAppMergeFields } from '../app-audience/mergeFields.js';

/**
 * Templates another feature fills with its own data (a code, a notification's
 * title and body, the admin digest). A rule has none of it, so these are never
 * sent from a rule; Settings, Automations does not offer them either
 * (NOT_FOR_RULES, kept equal by a test).
 */
export const RULE_EMAIL_EXCLUDED_TEMPLATES: readonly string[] = [
  'signup_otp_email', 'password_reset_otp_email', 'waitlist_verify_otp_email', 'notification_generic_email', 'admin_digest_email',
];

/**
 * Generic event bus (spec §3.11, D11). Product code calls {@link emitAppEvent};
 * admin-configurable mappings in `Settings/event_mappings` turn events into
 * notifications / emails / list changes. Mappings for the built-in moments ship
 * DISABLED so they don't double up with the direct behaviour — they exist as
 * configurable hooks.
 */

export type { EventMapping, EventRule, ValueCondition } from './eventRules.js';

export interface AppEventPayload {
  userId?: string;
  contactEmail?: string;
  /**
   * Set on App audience events (`app_user.*`): the person's `AppAudience` id.
   * They are not contacts, so list actions do not apply to them, and their
   * marketing consent is read from `AppAudience`.
   */
  appUserId?: string;
  data?: Record<string, unknown>;
}

export interface EmitOptions {
  /**
   * A stable id for the event. Emitting twice with the same id stores one
   * event, so a trigger that Firestore delivers twice does not act twice.
   */
  id?: string;
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
export async function emitAppEvent(type: string, payload: AppEventPayload = {}, options: EmitOptions = {}): Promise<string> {
  const doc: Record<string, unknown> = {
    type,
    createdAt: Timestamp.now(),
    processed: false,
  };
  if (payload.userId) doc['userId'] = payload.userId;
  if (payload.contactEmail) doc['contactEmail'] = payload.contactEmail;
  if (payload.appUserId) doc['appUserId'] = payload.appUserId;
  if (payload.data) doc['data'] = payload.data;
  if (!options.id) {
    const ref = await db.collection('AppEvents').add(doc);
    return ref.id;
  }
  try {
    await db.collection('AppEvents').doc(options.id).create(doc);
  } catch (err) {
    // 6 = ALREADY_EXISTS: this event was emitted before.
    if ((err as { code?: unknown }).code !== 6) throw err;
  }
  return options.id;
}

function fillTemplate(tpl: string, data: Record<string, unknown>): string {
  return (tpl || '').replace(/##([A-Z_]+)##/g, (_, key) => {
    const camel = key.toLowerCase().replace(/_([a-z])/g, (_m: string, c: string) => c.toUpperCase());
    const v = data[key] ?? data[key.toLowerCase()] ?? data[camel];
    return v == null ? '' : String(v);
  });
}

/** Process an AppEvent against its mapping. */
export const onAppEventCreate = onDocumentCreated(arcDocument('AppEvents/{id}'), async (event) => {
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
    const appUserId: string | undefined = data['appUserId'];
    const email: string | undefined = data['contactEmail'] || (await resolveUserEmail(userId));
    const context: ActionContext = { type, userId, appUserId, email, eventData };

    const rules = applicableRules(mapping, eventData);
    if (!rules.length) {
      await ref.update({ processed: true, processedAt: Timestamp.now(), results: { status: 'no_matching_rule' } });
      return;
    }
    // One rule keeps the flat results older logs have; several are keyed by rule.
    if (rules.length === 1 && !mapping.rules?.length) {
      Object.assign(results, await runActions(rules[0], context));
    } else {
      for (const [i, rule] of rules.entries()) results[rule.name || `rule_${i + 1}`] = await runActions(rule, context);
    }

    await ref.update({ processed: true, processedAt: Timestamp.now(), results: { status: 'ok', ...results } });
  } catch (err) {
    logger.error(`onAppEventCreate: failed for ${id}`, err);
    await ref.update({ processed: true, processedAt: Timestamp.now(), results: { status: 'error', message: (err as Error).message } });
  }
});

interface ActionContext {
  type: string;
  userId?: string;
  appUserId?: string;
  email?: string;
  eventData: Record<string, unknown>;
}

/** Runs one rule's actions. Each action records its own outcome; one failing does not stop the others. */
async function runActions(rule: EventRule, { type, userId, appUserId, email, eventData }: ActionContext): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  // 1. Create an in-app notification.
  if (rule.createNotification && userId) {
    try {
      results['notification'] = await createNotification({
        userId,
        type: rule.createNotification.typeKey,
        title: fillTemplate(rule.createNotification.titleTemplate, eventData),
        body: fillTemplate(rule.createNotification.bodyTemplate, eventData),
        link: rule.createNotification.link,
        createdBy: `event:${type}`,
      });
    } catch (e) {
      results['notification'] = `error: ${(e as Error).message}`;
    }
  }

  // 2. Queue an email.
  if (rule.sendEmail && email && RULE_EMAIL_EXCLUDED_TEMPLATES.includes(rule.sendEmail.templateType)) {
    results['email'] = 'template_not_for_rules';
  }
  if (rule.sendEmail && email && !RULE_EMAIL_EXCLUDED_TEMPLATES.includes(rule.sendEmail.templateType)) {
    try {
      const tpl = await loadTemplate(rule.sendEmail.templateType);
      if (tpl) {
        const r = await queueEmail({
          source: 'event',
          category: rule.sendEmail.category,
          toEmail: email,
          toName: typeof eventData['name'] === 'string' ? eventData['name'] : undefined,
          senderEmail: tpl.senderEmail,
          senderName: tpl.senderName,
          subject: tpl.subject,
          template: tpl.template,
          text: tpl.previewText || '',
          type: rule.sendEmail.templateType,
          templateIsActive: tpl.isActive !== false,
          ...(appUserId ? {
            isSubscribed: await appUserSubscribed(appUserId),
            appUser: {
              id: appUserId,
              docId: eventData['docId'] ? String(eventData['docId']) : undefined,
              fields: await readAppMergeFields(String(eventData['docId'] ?? '')),
            },
          } : {}),
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

  // 3. List membership. App users are not contacts: adding them to a list
  //    would copy them into Contacts, so the App users (live) list covers them.
  if (rule.addToLists?.length || rule.removeFromLists?.length) {
    if (!isFeatureOn('audience')) {
      // No contacts or lists without the audience feature (specs/feature-flags-spec.md);
      // the rule stays saved for when it is on.
      results['lists'] = 'feature_off';
    } else if (appUserId) {
      results['lists'] = 'not_applicable';
    } else if (email) {
      try {
        const emailHash = computeEmailHash(email);
        await upsertContact({ email, source: 'manual' });
        if (rule.addToLists?.length) results['addedToLists'] = await addContactToLists(emailHash, rule.addToLists);
        if (rule.removeFromLists?.length) results['removedFromLists'] = await removeContactFromLists(emailHash, rule.removeFromLists);
      } catch (e) {
        results['lists'] = `error: ${(e as Error).message}`;
      }
    }
  }

  // enrollInDrip is handled in Phase 7.
  return results;
}

/** An app user's marketing consent. No record means subscribed. */
async function appUserSubscribed(appUserId: string): Promise<boolean> {
  const snap = await db.collection(APP_AUDIENCE_STATE).doc(appUserId).get();
  return stateFrom(snap.exists ? snap.data() : undefined).consent === 'subscribed';
}

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
