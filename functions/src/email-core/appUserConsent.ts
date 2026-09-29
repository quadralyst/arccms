/**
 * Whether an app user may get marketing email, given the consent of a contact
 * with the same address (null when there is none) and their own App audience
 * consent. A contact's opt-out wins. A contact still `pending` (a form sign-up
 * not confirmed yet) has not opted out, so it does not block someone who is
 * subscribed as an app user (review C4, decided 2026-09-28): it used to, and a
 * sequence then ended as if they had unsubscribed. The one rule for sends,
 * broadcasts and the broadcast count.
 */
export function appUserSubscribed(contactConsent: string | null | undefined, appUserIsSubscribed: boolean): boolean {
  if (contactConsent === 'unsubscribed') return false;
  if (contactConsent === 'subscribed') return true;
  return appUserIsSubscribed;
}
