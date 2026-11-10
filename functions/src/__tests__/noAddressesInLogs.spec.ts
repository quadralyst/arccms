/**
 * Function logs never carry an email address or a phone number (specs/dev-review-fixes-spec.md,
 * RF2 2.11): a log line names a person by emailForLog() (auth/logSafe.ts) or maskPhone().
 *
 * A source scan: any logger or console call that puts a value named like an address or a
 * number (`${toEmail}`, `${recipient.email}`, `${phone}`) straight into its text fails.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Lines known to log an address, in code another change owns. Remove an entry once it is fixed. */
const KNOWN: string[] = ['dodo-payments/paymentEmailHelper.ts'];

const LOG_CALL = /\b(logger\.(info|warn|error|log|debug)|console\.(log|warn|error|info|debug))\(/;
const RAW_ADDRESS = /\$\{\s*[\w.?]*(email|Email|recipient|Recipient|phone|Phone)\s*\}/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (LOG_CALL.test(line) && RAW_ADDRESS.test(line)) found.push(`${relative(ROOT, file)}:${i + 1}`);
    });
  }
  return found;
}

describe('function logs', () => {
  it('never write an email address or phone number', () => {
    const files = offenders().filter((o) => !KNOWN.some((k) => o.startsWith(`${k}:`)));
    expect(files).toEqual([]);
  });

  it('the known exceptions still need their fix (remove them from KNOWN once fixed)', () => {
    const all = offenders();
    for (const known of KNOWN) expect(all.some((o) => o.startsWith(`${known}:`))).toBe(true);
  });
});
