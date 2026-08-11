/**
 * U7 audit (source scan): list membership has one write path.
 *
 * `addContactToLists` / `removeContactFromLists` in `email-core/contacts.ts` are the only
 * places allowed to change a contact's `listIds` or a list's `memberCount`. They do it in
 * a transaction, and joining a list also enrols the contact in that list's active drip
 * campaigns — so a write that bypasses them does not just risk a wrong count, it silently
 * skips the sequence the person should have entered.
 *
 * The codebase already satisfies this. The audit is here to keep it that way: `listIds`
 * and `memberCount` are ordinary-looking fields, and adding `arrayUnion` to one from a new
 * trigger is an easy, plausible mistake that no per-file test would notice.
 *
 * Companion to `waitlistedUsersRetired.spec.ts`, written after the same failure mode —
 * two individually-correct files disagreeing about who owns a piece of state — cost three
 * bugs during U6.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '..');

/** The one module that owns membership state, and why each other exemption exists. */
const ALLOWED: Record<string, string> = {
  'email-core/contacts.ts':
    'defines addContactToLists / removeContactFromLists — the chokepoint itself',
};

/** Comments stripped, so prose about membership does not read as a write. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'lib') continue;
      collectSourceFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Writes that change membership state.
 *
 * Deliberately matches the *field* rather than the collection: membership is changed by
 * touching `listIds` on a Contact or `memberCount` on a List, and a bypass is far more
 * likely to be a stray `update({ listIds: … })` than a hand-rolled transaction.
 */
const WRITE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'listIds assigned or mutated', pattern: /\blistIds\s*:\s*(FieldValue\.|arrayUnion|arrayRemove|\[)/ },
  { name: 'memberCount assigned or incremented', pattern: /\bmemberCount\s*:\s*(FieldValue\.|increment|\d)/ },
];

describe('list membership chokepoint (source scan)', () => {
  const files = collectSourceFiles(SRC_ROOT);

  it('scans a plausible number of files, so a broken walk cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('changes membership state only inside the chokepoint', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWED[rel]) continue;
      const content = codeOnly(readFileSync(file, 'utf-8'));
      for (const { name, pattern } of WRITE_PATTERNS) {
        if (pattern.test(content)) offenders.push(`${rel} — ${name}`);
      }
    }

    expect(offenders, 'Membership state written outside email-core/contacts.ts. Call '
      + 'addContactToLists / removeContactFromLists instead: they update listIds and '
      + 'memberCount in one transaction AND enrol the contact in the list\'s active drip '
      + `campaigns, which a direct write skips:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('still exposes both halves of the chokepoint', () => {
    // If either helper were renamed or removed, the audit above would keep passing while
    // callers had nowhere correct to go.
    const contacts = readFileSync(resolve(SRC_ROOT, 'email-core/contacts.ts'), 'utf-8');

    expect(contacts).toContain('export async function addContactToLists');
    expect(contacts).toContain('export async function removeContactFromLists');
  });

  it('keeps the join path wired to drip enrolment', () => {
    // The reason a direct write is worse than a wrong count: joining a list is also what
    // enrols someone in that list's sequences.
    const contacts = readFileSync(resolve(SRC_ROOT, 'email-core/contacts.ts'), 'utf-8');
    const joinBody = contacts.slice(contacts.indexOf('export async function addContactToLists'));

    expect(joinBody).toContain('enrollInListCampaigns');
  });

  it('keeps every allowlist entry honest — no stale exemptions', () => {
    const stale = Object.keys(ALLOWED).filter((rel) => !existsSync(resolve(SRC_ROOT, rel)));
    expect(stale, `Allowlisted but missing:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
