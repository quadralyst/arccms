import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';

/**
 * Per-list merge context for drip sends (U5).
 *
 * A drip step knows the contact and the list, but a template may need data that
 * lives elsewhere — a waitlist welcome wants the member's queue position and
 * referral link, which are on the form's member doc, not the contact.
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
 * Form-fed lists (`waitlist-{formId}`): load the member's funnel doc so the
 * gamification tags resolve exactly as they did when welcome was sent directly.
 *
 * The member doc id is not the contact id, so it is found by email. Failure is
 * non-fatal — a missing position should degrade the tag, not block the send.
 */
const waitlistResolver: ContextResolver = {
  matches: (listId) => listId.startsWith('waitlist-'),
  resolve: async (listId, email) => {
    const formId = listId.slice('waitlist-'.length);
    if (!formId || !email) return {};

    try {
      const [formSnap, memberSnap] = await Promise.all([
        db.collection('Waitlists').doc(formId).get(),
        db.collection('Waitlists').doc(formId).collection('users')
          .where('email', '==', email).limit(1).get(),
      ]);

      const context: ListContext = {};
      if (formSnap.exists) context['waitlistName'] = formSnap.data()?.['name'] || '';

      if (!memberSnap.empty) {
        const m = memberSnap.docs[0].data();
        context['referralLink'] = m['referralLink'] || '';
        context['leaderboardLink'] = m['leaderboardLink'] || '';
        context['position'] = m['queuePosition'];
      }
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
