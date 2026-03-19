/**
 * Disposable Email Domains
 *
 * A list of common disposable/temporary email domains.
 * Used to flag potentially low-quality leads.
 */

export const DISPOSABLE_EMAIL_DOMAINS: Set<string> = new Set([
  // Common disposable email services
  '10minutemail.com',
  '10minutemail.net',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamail.biz',
  'guerrillamail.de',
  'sharklasers.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailinator.org',
  'mailinator2.com',
  'tempmail.com',
  'tempmail.net',
  'temp-mail.org',
  'temp-mail.io',
  'throwaway.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'fakeinbox.com',
  'fakeemail.com',
  'disposablemail.com',
  'dispostable.com',
  'getnada.com',
  'nada.email',
  'getairmail.com',
  'airmail.cc',
  'burnermail.io',
  'mailcatch.com',
  'inboxed.im',
  'inboxed.pw',
  'mytemp.email',
  'mohmal.com',
  'tempinbox.com',
  'tmpmail.org',
  'tmpmail.net',
  '1secmail.com',
  '1secmail.org',
  '1secmail.net',
  'emailondeck.com',
  'spambox.us',
  'spamgourmet.com',
  'safetymail.info',
  'tempmailaddress.com',
  'tempr.email',
  'discard.email',
  'discardmail.com',
  'mailsac.com',
  'mt2015.com',
  'mt2014.com',
  'minutemail.com',
  'tempmailo.com',
  'fakemailgenerator.com',
  'hidemail.de',
  'instantemailaddress.com',
  'jetable.org',
  'mailfreeonline.com',
  'mailpoof.com',
  'mail-temp.com',
  'mintemail.com',
  'moakt.com',
  'nowmymail.com',
  'objectmail.com',
  'otherinbox.com',
  'proxymail.eu',
  'punkmail.com',
  'rcpt.at',
  'spamevader.com',
  'spamfree24.org',
  'spamspot.com',
  'spamtroll.net',
  'superrito.com',
  'teleworm.us',
  'tempemail.co.za',
  'tempemail.net',
  'tempinbox.co.uk',
  'tempmailgen.com',
  'uggsrock.com',
  'veryrealemail.com',
  'whatpaas.com',
  'willhackforfood.biz',
  'willselfdestruct.com',
  'wuzup.net',
  'wuzupmail.net',
  'yepmail.net',
  'yourdomain.com',
  'zoemail.org',
]);

/**
 * Check if an email domain is disposable
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
