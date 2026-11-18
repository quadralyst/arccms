/**
 * What a person may do to their own account on the profile page
 * (docs/app/member-area.html#own-account). Arc CMS ships this empty and never edits
 * it again. Empty means both are allowed.
 *
 *   export const CUSTOM_OWN_ACCOUNT: OwnAccountChoice = {
 *       selfDelete: false,        // no Delete my account; deleteMyAccount refuses
 *       moveIdentifiers: false,   // an email or number on another account is refused, not moved here
 *   };
 *
 * The functions read it too: deploy deleteMyAccount, checkIdentifierForLink,
 * linkEmail and linkPhone after changing it.
 */
import type { OwnAccountChoice } from '../shared/utils/own-account';

export const CUSTOM_OWN_ACCOUNT: OwnAccountChoice = {};
