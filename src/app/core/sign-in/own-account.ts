/**
 * What a person may do to their own account (src/custom/own-account.ts,
 * docs/app/member-area.html#own-account). The functions read the same choice from
 * functions/src/own-account.gen.ts, which scripts/arc-features.mjs writes.
 */
import { CUSTOM_OWN_ACCOUNT } from '../../../custom/own-account';
import { resolveOwnAccount, type OwnAccount } from '../../../shared/utils/own-account';

export const OWN_ACCOUNT: OwnAccount = resolveOwnAccount(CUSTOM_OWN_ACCOUNT);
