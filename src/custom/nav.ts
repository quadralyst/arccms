/**
 * The app's admin and member menus (docs/app/admin-menu.html, docs/app/member-area.html).
 * CUSTOM_NAV: the app's own items in the admin menu, shown before Profile.
 * CUSTOM_NAV_CHANGES: changes to Arc CMS's items in both menus, by id and role.
 * Arc CMS ships both empty and never changes what the app writes here. Give each item a
 * `labelKey` from src/custom/i18n so it is translated like the core items.
 */
import type { MenuItem } from '../shared/components/side-navbar/side-navbar.component';
import type { NavChanges } from '../app/core/nav/nav-changes';

/**
 * The app's changes to the admin and member menus: change, hide, add and move items by
 * their id, for every role or some (docs/app/admin-menu.html, docs/app/member-area.html).
 */
export const CUSTOM_NAV_CHANGES: NavChanges = {};

export const CUSTOM_NAV: MenuItem[] = [];
