/**
 * The sign-up notice and the contact form's line, worded by the app in its languages
 * (docs/app/sign-up-notice.html). Arc CMS ships this empty and never edits it again.
 * Empty means Arc CMS's own notices.
 *
 *   export const CUSTOM_NOTICES: CustomNotices = {
 *       signup: {
 *           en: 'By signing up, you agree to our [Terms of Service](https://acme.example/terms) and {privacy}.',
 *           de: 'Mit der Anmeldung akzeptierst du die [AGB]({terms}) und den [Datenschutz]({privacy}).',
 *       },
 *   };
 *
 * A link goes to a path on the site, an https: address or a mailto: address. {terms}
 * and {privacy} are the site's terms and privacy pages. A mistake stops the build.
 */
import type { CustomNotices } from '../shared/utils/notice-text';

export const CUSTOM_NOTICES: CustomNotices = {};
