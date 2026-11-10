import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * What the public form callables accept (joinForm, requestFormOtp, verifyFormOtp):
 * checked here, so a caller with no account cannot store or send whatever it likes.
 *
 * What a person typed (the name, the form's fields) is refused when it is too big,
 * so they are told and can shorten it. The signup metadata is gathered by the page,
 * not typed, so it is trimmed instead: a long referrer must never cost a signup.
 */

export const HOUR = 60 * 60 * 1000;

/** A name, a source: one short line. */
export const MAX_NAME = 100;
/** The form's own fields. */
export const MAX_FORM_FIELDS = 50;
export const MAX_FIELD_KEY = 100;
export const MAX_FIELD_VALUE = 5000;
/** All of the form's fields together, as JSON. */
export const MAX_FORM_DATA = 20000;
/** Signup metadata: keys kept, string length, and the nested query parameters. */
export const MAX_META_KEYS = 60;
export const MAX_META_KEY = 64;
export const MAX_META_VALUE = 500;
export const MAX_META_PARAMS = 20;
export const MAX_META_PARAM = 200;

/** A form id from the request: a string with no slash, so it names one document. */
export function readFormId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 200 || id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) {
    throw new HttpsError('invalid-argument', 'waitlistId is required.');
  }
  return id;
}

/** An email address from the request, lower-cased, or refused. */
export function readEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || !email.includes('@') || email.length > 254) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }
  return email;
}

/** An optional short text (a name, a source): '' when absent, refused when not text or too long. */
export function readShortText(value: unknown, message: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', message);
  const text = value.trim();
  if (text.length > MAX_NAME) throw new HttpsError('invalid-argument', message);
  return text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const FORM_DATA_REFUSED = 'This form sent too much. Please shorten your answers and try again.';

/** The form's fields: text, numbers and yes/no only, within the caps; refused otherwise. */
export function readFormData(value: unknown): Record<string, string | number | boolean | null> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', FORM_DATA_REFUSED);
  const entries = Object.entries(value);
  if (entries.length > MAX_FORM_FIELDS) throw new HttpsError('invalid-argument', FORM_DATA_REFUSED);
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, field] of entries) {
    if (!key || key.length > MAX_FIELD_KEY || /^__.*__$/.test(key)) throw new HttpsError('invalid-argument', FORM_DATA_REFUSED);
    if (typeof field === 'string') {
      if (field.length > MAX_FIELD_VALUE) throw new HttpsError('invalid-argument', FORM_DATA_REFUSED);
      out[key] = field;
    } else if ((typeof field === 'number' && Number.isFinite(field)) || typeof field === 'boolean' || field === null) {
      out[key] = field;
    } else {
      throw new HttpsError('invalid-argument', FORM_DATA_REFUSED);
    }
  }
  if (JSON.stringify(out).length > MAX_FORM_DATA) throw new HttpsError('invalid-argument', FORM_DATA_REFUSED);
  return out;
}

type MetaValue = string | number | boolean | Record<string, string>;

/** The signup metadata, trimmed to the caps: anything else is dropped, never refused. */
export function trimSignupMetadata(value: unknown): Record<string, MetaValue> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, MetaValue> = {};
  let kept = 0;
  for (const [key, field] of Object.entries(value)) {
    if (kept >= MAX_META_KEYS) break;
    if (!key || key.length > MAX_META_KEY || /^__.*__$/.test(key)) continue;
    if (typeof field === 'string') {
      out[key] = field.slice(0, MAX_META_VALUE);
    } else if ((typeof field === 'number' && Number.isFinite(field)) || typeof field === 'boolean') {
      out[key] = field;
    } else if (isPlainObject(field)) {
      // queryParams: one level of text.
      const params: Record<string, string> = {};
      for (const [name, param] of Object.entries(field).slice(0, MAX_META_PARAMS)) {
        if (name && name.length <= MAX_META_KEY && !/^__.*__$/.test(name) && typeof param === 'string') {
          params[name] = param.slice(0, MAX_META_PARAM);
        }
      }
      out[key] = params;
    } else {
      continue;
    }
    kept++;
  }
  return out;
}

/**
 * The form, which must exist and be open. A closed form (`isActive: false`) takes
 * no signups and sends no codes, whatever a page still showing it asks.
 */
export async function requireActiveForm(waitlistId: string): Promise<DocumentSnapshot> {
  const snap = await db.collection('Waitlists').doc(waitlistId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'This form does not exist.', { reason: 'form-missing' });
  if (snap.data()?.['isActive'] === false) throw new HttpsError('failed-precondition', 'This form is closed.', { reason: 'form-closed' });
  return snap;
}
