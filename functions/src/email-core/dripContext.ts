import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { waitlistDisplayName } from './defaultTemplates.js';
import { isBlank } from '../shared/blank.js';

/**
 * Per-list merge context for drip sends (U5).
 *
 * A drip step knows the contact and the list, but a template may need data that
 * lives elsewhere: a form's welcome wants the form's name, which is on the form,
 * not the contact.
 *
 * Written as a registry (list-kind → resolver) rather than a special case for
 * waitlists, so the next list type that needs context (e.g. `##PLAN##` for
 * `all-customers`) is a new entry rather than another branch in the send path.
 */

/** Extra `data` merged into queueEmail, feeding the ##TAG## resolver. */
export type ListContext = Record<string, unknown>;

interface ContextResolver {
  /** True when this resolver handles the list. */
  matches: (listId: string) => boolean;
  resolve: (listId: string, email: string) => Promise<ListContext>;
}

/**
 * Form-fed lists (`waitlist-{formId}`): the form's name, so `##WAITLIST##`
 * resolves as it did when the welcome was sent directly. Signup forms keep no
 * position or referral link any more (specs/form-gamification-spec.md).
 *
 * Failure is non-fatal: a missing name should degrade the tag, not block the send.
 */
const waitlistResolver: ContextResolver = {
  matches: (listId) => listId.startsWith('waitlist-'),
  resolve: async (listId, email) => {
    const formId = listId.slice('waitlist-'.length);
    if (!formId || isBlank(email)) return {};

    try {
      const formSnap = await db.collection('Waitlists').doc(formId).get();

      const context: ListContext = {};
      // Always set, and never blank — the welcome sent as a day-0 drip step uses
      // `Welcome to ##WAITLIST##` as its subject, and an unmapped or empty tag
      // resolves to '' rather than being left alone.
      context['waitlistName'] = waitlistDisplayName(
        formSnap.exists ? (formSnap.data()?.['name'] as string | undefined) : undefined,
      );
      return context;
    } catch {
      return {};
    }
  },
};

const RESOLVERS: ContextResolver[] = [waitlistResolver];

/**
 * Merge context for a list, or `{}` when nothing extra applies.
 *
 * `emailHash` is accepted for symmetry with future resolvers that key off the
 * contact rather than the address.
 */
export async function resolveListContext(listId: string, email: string): Promise<ListContext> {
  if (!listId) return {};
  const resolver = RESOLVERS.find((r) => r.matches(listId));
  if (!resolver) return {};
  return resolver.resolve(listId, email);
}

/** Exposed for tests / future resolvers that need the contact key. */
export function contactKeyFor(email: string): string {
  return computeEmailHash(email);
}
