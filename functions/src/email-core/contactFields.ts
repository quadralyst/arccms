import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Contact custom fields (audience-unification spec U4.5).
 *
 * A field collected by any form becomes durable data on the **contact**, not on
 * the form's member doc — which is what lets a send to any list personalise with
 * it. The registry (`Settings/contact_fields`) is account-level so two forms
 * collecting "company" populate the *same* field rather than two unrelated ones;
 * this is the model Kit and MailerLite use, and it is what makes cross-form merge
 * tags and field targeting safe.
 *
 * Values live in `Contacts.fields` as a flat `Record<key, unknown>`.
 */

export type ContactFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select';

export interface ContactFieldDef {
  key: string;
  label: string;
  type: ContactFieldType;
  options?: string[];
  /**
   * How a later submission treats an existing value.
   * `fill` (default) keeps what the contact already gave; `overwrite` replaces it.
   * Default is `fill` so one form can never silently clobber another's data.
   */
  writePolicy?: 'fill' | 'overwrite';
  /** Rendered when a contact has no value, so a merge tag never leaves a gap. */
  defaultValue?: string;
}

/**
 * Keys that already mean something on a contact. Allowing these would let a form
 * field quietly overwrite identity or consent.
 */
export const RESERVED_FIELD_KEYS = new Set([
  'email', 'emailhash', 'name', 'firstname', 'userid', 'consent', 'listids',
  'tags', 'sources', 'disabled', 'createdat', 'updatedat', 'fields',
]);

/** Same slug rule as tags, so a label maps to one predictable key. */
export function fieldKeyFromLabel(label: string): string {
  return (label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export interface FieldKeyValidation {
  ok: boolean;
  key: string;
  error?: string;
}

/** Validate a proposed field key: sluggable and not reserved. */
export function validateFieldKey(label: string): FieldKeyValidation {
  const key = fieldKeyFromLabel(label);
  if (!key) return { ok: false, key, error: 'Needs at least one letter or number.' };
  if (RESERVED_FIELD_KEYS.has(key)) {
    return { ok: false, key, error: `"${key}" is reserved by the contact record.` };
  }
  return { ok: true, key };
}

/** Read the field registry. Missing doc ⇒ no fields defined yet. */
export async function getFieldRegistry(): Promise<Record<string, ContactFieldDef>> {
  try {
    const snap = await db.collection('Settings').doc('contact_fields').get();
    return (snap.data()?.['fields'] as Record<string, ContactFieldDef>) || {};
  } catch {
    return {};
  }
}

/** Create or update one field definition. Returns the resolved key. */
export async function upsertFieldDef(def: Omit<ContactFieldDef, 'key'> & { key?: string }): Promise<string> {
  const validation = validateFieldKey(def.key || def.label);
  if (!validation.ok) throw new Error(validation.error);
  const key = validation.key;

  const existing = await getFieldRegistry();
  const merged: ContactFieldDef = {
    ...(existing[key] || {}),
    key,
    label: def.label,
    type: def.type || 'text',
    writePolicy: def.writePolicy || existing[key]?.writePolicy || 'fill',
  };
  if (def.options) merged.options = def.options;
  if (def.defaultValue !== undefined) merged.defaultValue = def.defaultValue;

  await db.collection('Settings').doc('contact_fields').set(
    { fields: { [key]: merged }, updatedAt: Timestamp.now() },
    { merge: true },
  );
  return key;
}

/**
 * Delete a field definition.
 *
 * Values already on contacts are left alone — dropping a definition should not
 * destroy collected data, and re-adding the field makes it visible again. Cleaning
 * up values is a separate, explicit action.
 */
export async function deleteFieldDef(key: string): Promise<void> {
  const existing = await getFieldRegistry();
  if (!existing[key]) return;
  const next = { ...existing };
  delete next[key];
  await db.collection('Settings').doc('contact_fields').set(
    { fields: next, updatedAt: Timestamp.now() },
    // Not merge:true for `fields` — a merge would re-add the deleted key.
    { merge: false },
  );
}

export interface SetFieldsResult {
  written: string[];
  skipped: string[];
  unknown: string[];
}

/**
 * Write field values onto a contact, honouring each field's write policy.
 *
 * - `fill` (default): only writes when the contact has no value yet, so a second
 *   form submission cannot overwrite what the person told us first.
 * - `overwrite`: always writes.
 * Unknown keys (no registry entry) are reported, not written — otherwise a typo in
 * a form mapping would silently create junk fields.
 */
export async function setContactFields(
  emailHash: string,
  values: Record<string, unknown>,
  opts: { force?: boolean } = {},
): Promise<SetFieldsResult> {
  const out: SetFieldsResult = { written: [], skipped: [], unknown: [] };
  const entries = Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return out;

  const registry = await getFieldRegistry();
  const ref = db.collection('Contacts').doc(emailHash);
  const snap = await ref.get();
  if (!snap.exists) return out;

  const current = (snap.data()?.['fields'] as Record<string, unknown>) || {};
  const patch: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    const def = registry[key];
    if (!def) {
      out.unknown.push(key);
      continue;
    }
    const hasValue = current[key] !== undefined && current[key] !== null && current[key] !== '';
    const overwrite = opts.force || def.writePolicy === 'overwrite';
    if (hasValue && !overwrite) {
      out.skipped.push(key);
      continue;
    }
    patch[`fields.${key}`] = value;
    out.written.push(key);
  }

  if (out.written.length) {
    await ref.update({ ...patch, updatedAt: Timestamp.now() });
  }
  return out;
}
