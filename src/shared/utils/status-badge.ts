/**
 * Maps a domain status string to a shared `.status-badge` modifier class
 * (defined globally in styles.css). Keeps every admin page on one soft-pill
 * badge family instead of hand-mapping Bootstrap `bg-*` classes.
 *
 * Covers the email domain statuses (broadcasts, drips, consent, logs). Unknown
 * values fall back to the neutral pill.
 */
export type BadgeTone = 'is-success' | 'is-warning' | 'is-danger' | 'is-info' | 'is-neutral' | 'is-dark';

const TONE_BY_STATUS: Record<string, BadgeTone> = {
    // positive / delivered / live
    active: 'is-success',
    sent: 'is-success',
    completed: 'is-success',
    delivered: 'is-success',
    subscribed: 'is-success',

    // in-progress / pending / paused
    paused: 'is-warning',
    scheduled: 'is-warning',
    pending: 'is-warning',
    processing: 'is-warning',

    // queued / transient
    queued: 'is-info',
    sending: 'is-info',
    draft: 'is-info',

    // failed / suppressed
    failed: 'is-danger',
    bounced: 'is-danger',
    complaint: 'is-danger',
    unsubscribed: 'is-danger',
    cancelled: 'is-danger',
    canceled: 'is-danger',

    // ended / inactive
    archived: 'is-dark',
    inactive: 'is-neutral',
};

/** Full class string, e.g. `status-badge is-success`. */
export function statusBadgeClass(status: string | null | undefined): string {
    const tone = TONE_BY_STATUS[(status || '').toLowerCase()] ?? 'is-neutral';
    return `status-badge ${tone}`;
}
