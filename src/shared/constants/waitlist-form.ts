/**
 * The default signup form's id (Waitlists/{id}): the form onboarding creates and
 * the bundled landing pages post to (`data-waitlist-id`). One value, so a fresh
 * install ends up with one default form rather than two.
 *
 * Keep in step with functions/src/waitlists/defaultForm.ts.
 */
export const DEFAULT_WAITLIST_FORM_ID = 'waitlist-form';

/**
 * Ids the default form had before it was unified (onboarding used `default`, the
 * landing page `get-early-access-to-arc-cms`). A page asking for the default form
 * on an install that has one of these, but no `waitlist-form`, is pointed at it,
 * so its existing signups keep collecting in the same place. Order is preference:
 * the landing page's form is the one that had public signups.
 */
export const LEGACY_DEFAULT_WAITLIST_FORM_IDS: readonly string[] = ['get-early-access-to-arc-cms', 'default'];
