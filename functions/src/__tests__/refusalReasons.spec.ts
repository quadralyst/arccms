/**
 * Every refusal a member can see during sign-in carries a reason, so the page can
 * say it in the member's language (specs/sign-in-codes-spec.md, SC-D6, SC-D8).
 * A refusal without one is on this list (a bug, or an admin's screen) or a mistake.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AUTH = resolve(__dirname, '../auth');
/** Refusals no member sees: a bug in the page, or the admin's phone sign-in check. */
const NOT_FOR_MEMBERS = ["'Unknown request.'", "'Could not check phone sign-in. The function logs have the error.'"];

describe('sign-in refusals', () => {
    it('all carry a reason, through refuse() or details', () => {
        const missing: string[] = [];
        for (const file of readdirSync(AUTH).filter((f) => f.endsWith('.ts'))) {
            const text = readFileSync(resolve(AUTH, file), 'utf8');
            for (const match of text.matchAll(/new HttpsError\(([\s\S]*?)\);/g)) {
                const args = match[1];
                if (/reason[,:\s}]/.test(args) || NOT_FOR_MEMBERS.some((m) => args.includes(m))) continue;
                missing.push(`${file}: new HttpsError(${args.replace(/\s+/g, ' ').slice(0, 90)})`);
            }
        }
        expect(missing).toEqual([]);
    });
});
