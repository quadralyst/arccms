/**
 * Collections that can never be searchable (docs/feature-flags-spec.md, F-D13):
 * they grow by thousands of documents a day, or are the index itself. Search
 * settings shows them greyed out with the reason; naming one in
 * functions/src/custom/search-sources.ts stops the functions from loading.
 */

export const REFUSED_COLLECTIONS: Readonly<Record<string, string>> = {
    EmailLogs: 'one document per email sent',
    SmsLogs: 'one document per text message sent',
    AppEvents: 'one document per event',
    Notifications: 'one document per notification',
    WebhookEvents: 'one document per payment webhook',
    PwaStats: 'one document per day of installs',
    CreditLedger: 'one document per credit movement',
    SearchIndex: 'the search index itself',
};

/** Why a collection can never be searchable, or null when it can. */
export function refusedReason(collection: string): string | null {
    if (collection.startsWith('_')) return 'a queue, emptied as it is processed';
    return REFUSED_COLLECTIONS[collection] ?? null;
}
