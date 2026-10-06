/**
 * The languages this app shows its members (docs/app/member-languages.html), besides
 * English. Arc CMS ships this empty and never edits it again. The admin keeps Arc CMS's
 * own languages. Put each language's translations in src/custom/i18n/<code>.json.
 *
 *   export const MEMBER_LANGUAGES: readonly MemberLanguage[] = [
 *       { code: 'de', label: 'Deutsch', locale: 'de-CH', localeData: () => import('@angular/common/locales/de-CH') },
 *   ];
 *
 * Empty means members see what they always did.
 */
import type { MemberLanguage } from '../app/core/i18n/member-languages';

export const MEMBER_LANGUAGES: readonly MemberLanguage[] = [];
