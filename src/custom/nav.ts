/**
 * The app's items in the admin menu (docs/app/custom-space.html), shown before Profile.
 * Arc CMS ships this empty and never edits it again. Give each item a `labelKey`
 * from src/custom/i18n so it is translated like the core items.
 */
import type { MenuItem } from '../shared/components/side-navbar/side-navbar.component';
import type { NavChanges } from '../app/core/nav/nav-changes';

/**
 * The app's changes to the admin and member menus: change, hide, add and move items by
 * their id, for every role or some (docs/app/admin-menu.html, docs/app/member-area.html).
 */
export const CUSTOM_NAV_CHANGES: NavChanges = {};

export const CUSTOM_NAV: MenuItem[] = [];
