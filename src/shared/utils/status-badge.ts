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
    success: 'is-success',

    // in-progress / pending / paused
    paused: 'is-warning',
    scheduled: 'is-warning',
    pending: 'is-warning',
    processing: 'is-warning',
    retrying: 'is-warning',
    deferred: 'is-warning',

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
    suppressed: 'is-danger',

    // ended / inactive
    archived: 'is-dark',
    inactive: 'is-neutral',
    // Deliberately withheld by a queueEmail gate — not a delivery failure, but
    // emphatically not a success either.
    skipped: 'is-neutral',
};

/** Full class string, e.g. `status-badge is-success`. */
export function statusBadgeClass(status: string | null | undefined): string {
    const tone = TONE_BY_STATUS[(status || '').toLowerCase()] ?? 'is-neutral';
    return `status-badge ${tone}`;
}

/**
 * Human label for a raw status value — `'skipped'` → `'Skipped'`.
 *
 * Statuses are single lowercase words, so capitalising is enough; the point of
 * routing through here is that a caller cannot quietly relabel one state as
 * another (which is how a gated `skipped` email came to be shown as "Success").
 */
export function statusBadgeLabel(status: string | null | undefined): string {
    const raw = (status || '').trim();
    if (!raw) return 'Unknown';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}
