/**
 * U6/U7 audit (source scan): the `WaitlistedUsers` registry is retired.
 *
 * The collection is frozen — nothing writes it, and only an explicit allowlist of
 * legacy readers still touches it. This test walks every non-test source file under
 * `functions/src` and fails on any new reference.
 *
 * **Why a source scan and not a unit test.** The same bug class bit this project three
 * times during U6: a write moved to a new home and a *reader* was left pointed at the
 * old one. Each time the unit tests passed, because each side was individually correct
 * — the stale leaderboard rank, the admin referral panel showing nothing, and a
 * referrer's count decremented twice. Nothing in a per-file test can see "this file
 * still reads a collection that another file stopped writing". A whole-tree scan can.
 *
 * When a genuinely new legacy reader is needed, add it to ALLOWED with a reason. The
 * point is that doing so is a deliberate, reviewable act rather than an accident.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '..');

/**
 * Files whose **code** may still reference the registry, each for a stated reason.
 *
 * All are read-only or migration paths; none writes the collection in normal operation.
 * Comments are stripped before scanning, so a file explaining the history — and several
 * do, deliberately — does not need an exemption. Keeping the allowlist to real
 * dependencies is what makes it reviewable.
 */
const ALLOWED: Record<string, string> = {
  'email-core/migrateWaitlistedUsers.ts':
    'the migration itself — it reads the registry to copy historical referral records out',
  'email-core/backfillContacts.ts':
    'legacy importer — builds Contacts from pre-unification signups',
  'email-core/handleUnsubscribe.ts':
    'keeps pre-cutover records consistent when someone unsubscribes',
  'email-core/unsubscribeLegacyLink.ts':
    'resolves /unsubscribe/:waitlistId/:userId links already sent by email',
  'waitlists/leaderboard/getLeaderBoardData.ts':
    'documented compatibility path — an already-deployed frontend may still pass the '
    + 'legacy collectionName, so the callable keeps accepting it',
};

/**
 * Source with comments removed, so historical notes do not register as dependencies.
 * Deliberately simple: block comments, line comments, and nothing clever about strings
 * containing comment-like text — a false positive here costs one allowlist entry, while
 * a false negative would let a real reference through.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * The collection name as a standalone word.
 *
 * A plain substring match also hits identifiers that merely contain it —
 * `migrateWaitlistedUsers`, `onWaitlistedUsersCreate` — so `index.ts` failed purely for
 * exporting the migration module. The lookbehind keeps this about the collection.
 */
const REFERENCE = /(?<![A-Za-z])WaitlistedUsers(?![A-Za-z])/;

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

/** A *write* to the registry: `.add(`, `.set(` or `.update(` reached from it. */
const WRITE_PATTERNS = [
  /collection\(\s*['"]WaitlistedUsers['"]\s*\)\s*\.add\s*\(/,
  /collection\(\s*['"]WaitlistedUsers['"]\s*\)\s*\.doc\([^)]*\)\s*\.set\s*\(/,
  /collection\(\s*['"]WaitlistedUsers['"]\s*\)\s*\.doc\([^)]*\)\s*\.update\s*\(/,
];

describe('WaitlistedUsers is retired (source scan)', () => {
  const files = collectSourceFiles(SRC_ROOT);

  it('scans a plausible number of files, so a broken walk cannot pass silently', () => {
    // Guards the guard: if collectSourceFiles ever returns nothing, every assertion
    // below would vacuously pass.
    expect(files.length).toBeGreaterThan(40);
  });

  it('is referenced only by the allowlisted legacy readers', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWED[rel]) continue;
      if (REFERENCE.test(codeOnly(readFileSync(file, 'utf-8')))) offenders.push(rel);
    }

    expect(offenders, `New WaitlistedUsers references. The collection is frozen (U6) — read `
      + `the member doc under Waitlists/{id}/users instead, or add the file to ALLOWED `
      + `with a reason:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('is never written outside the migration', () => {
    const writers: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (rel === 'email-core/migrateWaitlistedUsers.ts') continue;
      const content = codeOnly(readFileSync(file, 'utf-8'));
      if (WRITE_PATTERNS.some((p) => p.test(content))) writers.push(rel);
    }

    expect(writers, `These write to a frozen collection:\n  ${writers.join('\n  ')}`).toEqual([]);
  });

  it('has no leftover trigger directory', () => {
    // onWaitlistedUsersCreate / onWaitlistedUserUpdate fired on the registry to email an
    // OTP. Resurrecting either would send mail derived from data nothing updates.
    expect(existsSync(resolve(SRC_ROOT, 'waitlists/waitlistedUsers'))).toBe(false);
  });

  it('keeps every allowlist entry honest — no stale exemptions', () => {
    // An exemption for a file that no longer mentions the registry is misleading: it
    // implies a dependency that is gone, and it would silently permit a future one.
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const full = resolve(SRC_ROOT, rel);
      return !existsSync(full) || !REFERENCE.test(codeOnly(readFileSync(full, 'utf-8')));
    });

    expect(stale, `Allowlisted but no longer referencing the registry — remove these `
      + `entries:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
