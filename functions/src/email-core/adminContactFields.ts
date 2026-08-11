import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';
import {
  upsertFieldDef,
  deleteFieldDef,
  setContactFields,
  getFieldRegistry,
  validateFieldKey,
  type ContactFieldDef,
} from './contactFields.js';

function requireAdmin(request: { auth?: { token?: Record<string, unknown> } }): void {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }
}

/** Admin: create or update a custom field definition (U4.5). */
export const adminUpsertContactField = onCall(async (request) => {
  requireAdmin(request);
  const label = String(request.data?.label || '').trim();
  if (!label) throw new HttpsError('invalid-argument', 'label is required.');

  const check = validateFieldKey(request.data?.key || label);
  if (!check.ok) throw new HttpsError('invalid-argument', check.error || 'Invalid field key.');

  try {
    const key = await upsertFieldDef({
      key: request.data?.key,
      label,
      type: request.data?.type || 'text',
      options: Array.isArray(request.data?.options) ? request.data.options : undefined,
      writePolicy: request.data?.writePolicy === 'overwrite' ? 'overwrite' : 'fill',
      defaultValue: request.data?.defaultValue,
    } as ContactFieldDef);
    return { ok: true, key };
  } catch (err) {
    logger.error('adminUpsertContactField failed', err);
    throw new HttpsError('internal', err instanceof Error ? err.message : 'Failed to save field.');
  }
});

/** Admin: remove a field definition. Values on contacts are left intact. */
export const adminDeleteContactField = onCall(async (request) => {
  requireAdmin(request);
  const key = String(request.data?.key || '');
  if (!key) throw new HttpsError('invalid-argument', 'key is required.');
  try {
    await deleteFieldDef(key);
    return { ok: true };
  } catch (err) {
    logger.error('adminDeleteContactField failed', err);
    throw new HttpsError('internal', 'Failed to delete field.');
  }
});

/** Admin: set field values on one contact (Contacts is functions-only). */
export const adminSetContactFields = onCall(async (request) => {
  requireAdmin(request);
  const emailHash = String(request.data?.emailHash || '');
  const values = request.data?.values;
  if (!emailHash) throw new HttpsError('invalid-argument', 'emailHash is required.');
  if (!values || typeof values !== 'object') throw new HttpsError('invalid-argument', 'values object is required.');

  try {
    // An admin editing a contact directly always wins over the fill policy —
    // that policy exists to stop *forms* clobbering each other, not people.
    const res = await setContactFields(emailHash, values, { force: true });
    return { ok: true, ...res };
  } catch (err) {
    logger.error('adminSetContactFields failed', err);
    throw new HttpsError('internal', 'Failed to set contact fields.');
  }
});

/**
 * Admin: lift historical `formData` onto `Contacts.fields` via each form's
 * `fieldMap` (U4.5, runbook step 9).
 *
 * Idempotent — the per-field `fill` policy means a re-run does not overwrite. Logs
 * conflicts (the same key arriving with different values from different forms)
 * rather than silently picking a winner, so a real data question surfaces instead
 * of being decided by iteration order.
 */
export const migrateFormDataToContactFields = onCall(async (request) => {
  requireAdmin(request);
  const dryRun = request.data?.dryRun === true;

  try {
    const registry = await getFieldRegistry();
    if (!Object.keys(registry).length) {
      return { dryRun, forms: 0, note: 'No custom fields defined yet — nothing to map.' };
    }

    const forms = await db.collection('Waitlists').get();
    let membersScanned = 0;
    let contactsUpdated = 0;
    let valuesWritten = 0;
    let membersWithoutContact = 0;
    const unmappedForms: string[] = [];
    /** emailHash → key → values seen, so genuine disagreements are reported. */
    const seenValues = new Map<string, Map<string, Set<string>>>();
    const conflicts: string[] = [];

    for (const form of forms.docs) {
      const fieldMap = (form.data()['fieldMap'] as Record<string, string>) || {};
      if (!Object.keys(fieldMap).length) {
        unmappedForms.push(form.id);
        continue;
      }

      const members = await form.ref.collection('users').get();
      for (const m of members.docs) {
        const data = m.data();
        const email: string | undefined = data['email'];
        const formData = (data['formData'] as Record<string, unknown>) || {};
        if (!email || !Object.keys(formData).length) continue;
        membersScanned++;

        const values: Record<string, unknown> = {};
        for (const [formField, fieldKey] of Object.entries(fieldMap)) {
          const v = formData[formField];
          if (v === undefined || v === null || v === '') continue;
          if (!registry[fieldKey]) continue; // mapping points at a deleted field
          values[fieldKey] = v;
        }
        if (!Object.keys(values).length) continue;

        const emailHash = computeEmailHash(email);

        // Record what each contact was offered, per key, to spot disagreements.
        const perContact = seenValues.get(emailHash) || new Map<string, Set<string>>();
        for (const [k, v] of Object.entries(values)) {
          const set = perContact.get(k) || new Set<string>();
          set.add(String(v));
          if (set.size > 1) conflicts.push(`${email}: ${k} = ${[...set].join(' | ')}`);
          perContact.set(k, set);
        }
        seenValues.set(emailHash, perContact);

        if (!(await db.collection('Contacts').doc(emailHash).get()).exists) {
          membersWithoutContact++;
          continue;
        }

        if (dryRun) {
          valuesWritten += Object.keys(values).length;
          contactsUpdated++;
          continue;
        }

        const res = await setContactFields(emailHash, values);
        if (res.written.length) {
          valuesWritten += res.written.length;
          contactsUpdated++;
        }
      }
    }

    const result = {
      dryRun,
      forms: forms.size,
      unmappedForms,
      membersScanned,
      contactsUpdated,
      valuesWritten,
      membersWithoutContact,
      conflicts,
    };
    logger.info('migrateFormDataToContactFields complete', result);
    return result;
  } catch (err) {
    logger.error('migrateFormDataToContactFields failed', err);
    throw new HttpsError('internal', 'Field migration failed.');
  }
});
