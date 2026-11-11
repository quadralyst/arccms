import { TranslocoService } from '@jsverse/transloco';

/**
 * Stored statuses the audience pages show (consent, broadcast and sequence
 * states). Each has a key under admin.audience.status; anything else is shown as
 * it is stored, so a status added later still reads as something.
 */
export const AUDIENCE_STATUSES = [
    'subscribed', 'pending', 'unsubscribed', 'disabled',
    'draft', 'scheduled', 'queued', 'sending', 'sent', 'failed', 'cancelled',
    'active', 'paused', 'completed', 'archived',
] as const;

/** A stored status in the admin's language. */
export function audienceStatusText(transloco: TranslocoService, value: string | null | undefined): string {
    const v = String(value ?? '');
    return (AUDIENCE_STATUSES as readonly string[]).includes(v)
        ? transloco.translate(`admin.audience.status.${v}`)
        : v;
}
