import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { upsertContact, ensureList } from './contacts.js';

/** A parsed, valid contact row. */
export interface ParsedContactRow {
  email: string;
  name?: string;
}

export interface CsvParseResult {
  valid: ParsedContactRow[];
  invalidRows: string[];
  duplicateEmails: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse CSV text into contact rows (pure — no I/O, unit-testable).
 *
 * Accepts `email` or `email,name` columns, with or without a header row.
 * Classifies each data row as valid / invalid (bad email) / duplicate (email
 * already seen earlier in the file).
 */
export function parseContactsCsv(text: string): CsvParseResult {
  const valid: ParsedContactRow[] = [];
  const invalidRows: string[] = [];
  const duplicateEmails: string[] = [];
  const seen = new Set<string>();

  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let startIdx = 0;
  if (lines.length && /(^|,)\s*email\s*(,|$)/i.test(lines[0])) {
    startIdx = 1; // skip header
  }

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    const cols = raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const email = (cols[0] || '').toLowerCase();
    const name = cols[1] || undefined;

    if (!EMAIL_RE.test(email)) {
      invalidRows.push(raw);
      continue;
    }
    if (seen.has(email)) {
      duplicateEmails.push(email);
      continue;
    }
    seen.add(email);
    valid.push({ email, name });
  }

  return { valid, invalidRows, duplicateEmails };
}

/** Admin callable: preview a CSV import (counts + parsed rows), no writes. */
export const previewContactImport = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }
  const csvText = String(request.data?.csvText || '');
  const result = parseContactsCsv(csvText);
  return {
    validCount: result.valid.length,
    invalidCount: result.invalidRows.length,
    duplicateCount: result.duplicateEmails.length,
    valid: result.valid,
    invalidRows: result.invalidRows,
  };
});

/**
 * Admin callable: import parsed contacts into a list.
 *
 * Consent gating (D6): contacts are marked `subscribed` ONLY when the admin
 * affirms they have permission to email them; otherwise `pending` (excluded
 * from marketing sends until they opt in).
 */
export const importContacts = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const rows = Array.isArray(request.data?.rows) ? (request.data.rows as ParsedContactRow[]) : [];
  const listId = String(request.data?.listId || '');
  const consentAffirmed = request.data?.consentAffirmed === true;
  if (!listId) {
    throw new HttpsError('invalid-argument', 'A target listId is required.');
  }

  await ensureList(listId, { name: listId, type: 'manual' });

  let imported = 0;
  for (const row of rows) {
    if (!row?.email || !EMAIL_RE.test(row.email)) continue;
    await upsertContact({
      email: row.email,
      name: row.name,
      source: 'import',
      addLists: [listId],
      consent: consentAffirmed ? 'subscribed' : 'pending',
    });
    imported++;
  }

  logger.info(`importContacts: imported ${imported} into ${listId} (consent=${consentAffirmed}).`);
  return { imported };
});
