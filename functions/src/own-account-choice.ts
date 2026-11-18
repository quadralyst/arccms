/**
 * What a person may do to their own account (src/custom/own-account.ts,
 * docs/app/member-area.html#own-account). OWN_ACCOUNT is generated from that file by
 * scripts/arc-features.mjs before every build and test run.
 */
import { OWN_ACCOUNT } from './own-account.gen.js';

/** Mirror of OwnAccount in src/shared/utils/own-account.ts: every field decided. */
export interface OwnAccount {
    selfDelete: boolean;
    moveIdentifiers: boolean;
}

export function ownAccount(): OwnAccount {
    return OWN_ACCOUNT;
}
