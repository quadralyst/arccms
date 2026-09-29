/**
 * Who owns a user's Firebase Auth account (docs/coexistence-spec.md, CO-D16).
 *
 * In a project shared with a host app, one sign-in pool serves both. A `users`
 * record may belong to someone whose login the host app also uses (`shared`) or
 * owns outright (`host`). ArcCMS must never delete such a login: removing the
 * person from ArcCMS must not lock them out of the app they actually use. A
 * record without the field is `arccms`, which is every record ArcCMS created
 * before this existed.
 *
 * Only the Admin SDK sets `authOwner`; the Firestore rules refuse it from clients.
 */
export const AUTH_OWNER = { ARCCMS: 'arccms', HOST: 'host', SHARED: 'shared' } as const;

/** Whether ArcCMS may delete this user's Auth account. */
export function arccmsOwnsAuthAccount(userDoc: Record<string, unknown> | undefined): boolean {
    const owner = userDoc?.['authOwner'];
    return owner === undefined || owner === null || owner === AUTH_OWNER.ARCCMS;
}
