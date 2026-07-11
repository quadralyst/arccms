/**
 * E5 kill-switch audit (source scan).
 *
 * After Phase 1, the queueEmail() chokepoint in `email-core/` is the ONLY place
 * allowed to CREATE `EmailLogs` documents. This test walks every non-test source
 * file under functions/src and fails if any file outside `email-core/` creates an
 * EmailLogs doc via `.add(...)` or `.doc(...).set(...)`.
 *
 * (Updates to existing docs — `.doc(id).update(...)` in sendMail / webhook /
 * open-tracking — are allowed; they modify, they don't queue new sends.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '..');

/** Recursively collect .ts files, excluding tests and the sanctioned email-core module. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'email-core') continue;
      collectSourceFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

// Matches EmailLogs *creation*: `collection('EmailLogs').add(` and
// `collection('EmailLogs').doc(...).set(`. Tolerant of whitespace/newlines.
const ADD_PATTERN = /collection\(\s*['"]EmailLogs['"]\s*\)\s*\.add\s*\(/;
const DOC_SET_PATTERN = /collection\(\s*['"]EmailLogs['"]\s*\)\s*\.doc\([^)]*\)\s*\.set\s*\(/;

describe('E5: no direct EmailLogs writes outside email-core', () => {
  const files = collectSourceFiles(SRC_ROOT);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no file outside email-core creates an EmailLogs doc', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (ADD_PATTERN.test(content) || DOC_SET_PATTERN.test(content)) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the queueEmail chokepoint IS the writer (sanity check on the scan)', () => {
    const queueEmailSrc = readFileSync(resolve(SRC_ROOT, 'email-core/queueEmail.ts'), 'utf-8');
    expect(ADD_PATTERN.test(queueEmailSrc)).toBe(true);
  });
});
