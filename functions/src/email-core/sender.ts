import { getSiteConfig } from '../shared/site-settings.js';
import type { EmailSettings } from '../types.js';

/**
 * What Arc CMS used to save on a default template when nothing named a sender. It says
 * nothing about the site, so anything the site has named replaces it. In Settings, Email it
 * stays: that form shows it and offers the site's name (docs/features/email.html).
 */
const OLD_DEFAULT_SENDER = 'Arc CMS';

/**
 * The name an email goes out under: its template's, else Settings, Email's sender or
 * company name, else the site's (Settings, About), else none. Reads the site only when
 * nothing nearer has a name, so a sign-in code on a set-up site waits for no extra read.
 */
export async function senderNameFor(own: string | undefined, settings: EmailSettings | undefined): Promise<string> {
  const name = own?.trim() || '';
  if (name && name !== OLD_DEFAULT_SENDER) return name;
  const general = settings?.senderName?.trim() || settings?.companyName?.trim();
  if (general) return general;
  return siteName();
}

async function siteName(): Promise<string> {
  try {
    return (await getSiteConfig()).siteName?.trim() || '';
  } catch (err) {
    // A site name is not worth a lost email: it goes out from the address alone.
    console.warn('senderNameFor: could not read the site name', err);
    return '';
  }
}

/**
 * A `From` or `To` line: `Name <address>`, the name quoted when a comma, full stop or quote
 * in it would break the line, and the address alone when there is no name (never
 * `"" <address>`). A name can come from a public form, and written into the line as it is,
 * `x", someone@else.test, "y` would add a recipient.
 */
export function addressLine(name: string | undefined, address: string): string {
  const clean = (name ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return address;
  const plain = /^[\p{L}\p{M}\p{N} !#$%&'*+\-/=?^_`{|}~]+$/u.test(clean);
  return plain ? `${clean} <${address}>` : `"${clean.replace(/(["\\])/g, '\\$1')}" <${address}>`;
}
