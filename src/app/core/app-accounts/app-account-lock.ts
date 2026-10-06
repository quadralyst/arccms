/**
 * App accounts are locked (docs/app/app-accounts.html): an account an app made with
 * createAppAccount cannot change itself, unless the app made it with
 * `selfService: true`. The server and the rules enforce it
 * (functions/src/users/lockedAppAccount.ts, firestore.rules isLockedAppRecord); the
 * browser reads it the same way to show a read-only profile, and to keep such an
 * account out of the member pages when the app says so (src/custom/app-accounts.ts).
 */
import { CUSTOM_APP_ACCOUNTS } from '../../../custom/app-accounts';
import { homeFor, type HomePages } from '../home/home';

/** What an app chooses for its locked accounts, in src/custom/app-accounts.ts. */
export interface AppAccountChoice {
    /**
     * Whether a locked app account may open the member pages (/user/..., /account).
     * Default true, with a read-only profile. False sends it to its home page
     * (src/custom/home.ts), or to the site's home when that is a member page.
     */
    memberPages?: boolean;
}

/** The parts of a `users` record the lock reads. */
export interface LockFields {
    by?: unknown;
    selfService?: unknown;
}

/** Whether this record is an app account that cannot change itself. */
export function isLockedAppAccount(record: LockFields | null | undefined): boolean {
    return record?.by === 'app' && record?.selfService !== true;
}

/** Whether this person may open the member pages. */
export function memberPagesOpen(record: LockFields | null | undefined, choice: AppAccountChoice = CUSTOM_APP_ACCOUNTS): boolean {
    return !isLockedAppAccount(record) || choice.memberPages !== false;
}

/** Pages a locked account kept out of the member pages must never be sent to. */
const MEMBER_PAGE = /^\/(user|account|admin)(\/|\?|#|$)/;

/**
 * Where a locked app account goes instead of a member page: its role's home page,
 * unless that is itself a member page (as Arc CMS's default /user/dashboard is), then
 * the site's home. Never a page that sends it back here.
 */
export function lockedAccountLanding(role: string | null | undefined, home?: HomePages): string {
    const page = home ? homeFor(role, home) : homeFor(role);
    return MEMBER_PAGE.test(page) ? '/' : page;
}
