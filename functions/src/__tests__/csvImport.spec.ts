/**
 * Tests for the pure CSV parser (functions/src/email-core/csvImport.ts).
 */
import { describe, it, expect } from 'vitest';
import { parseContactsCsv } from '../email-core/csvImport.js';

describe('parseContactsCsv', () => {
  it('parses email,name rows and skips a header', () => {
    const csv = 'email,name\nalice@example.com,Alice\nbob@example.com,Bob';
    const r = parseContactsCsv(csv);
    expect(r.valid).toEqual([
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
    ]);
    expect(r.invalidRows).toHaveLength(0);
    expect(r.duplicateEmails).toHaveLength(0);
  });

  it('works without a header and with email-only rows', () => {
    const r = parseContactsCsv('alice@example.com\nbob@example.com');
    expect(r.valid.map((v) => v.email)).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('classifies invalid emails and in-file duplicates (3 valid / 1 dup / 1 invalid)', () => {
    const csv = [
      'email,name',
      'alice@example.com,Alice',
      'not-an-email,Bad',
      'bob@example.com,Bob',
      'alice@example.com,Alice Again', // duplicate
      'carol@example.com,Carol',
    ].join('\n');
    const r = parseContactsCsv(csv);
    expect(r.valid).toHaveLength(3);
    expect(r.invalidRows).toEqual(['not-an-email,Bad']);
    expect(r.duplicateEmails).toEqual(['alice@example.com']);
  });

  it('lowercases and trims emails, strips quotes', () => {
    const r = parseContactsCsv('"Alice@Example.com" , "Alice"');
    expect(r.valid[0]).toEqual({ email: 'alice@example.com', name: 'Alice' });
  });

  it('ignores blank lines', () => {
    const r = parseContactsCsv('\n\nalice@example.com\n\n');
    expect(r.valid).toHaveLength(1);
  });
});
