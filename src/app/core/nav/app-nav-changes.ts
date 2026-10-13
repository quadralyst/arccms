/**
 * The app's menu changes (docs/app/admin-menu.html#change-arc-cms-s-items):
 * CUSTOM_NAV_CHANGES in src/custom/nav-changes.ts, after any the app wrote in
 * src/custom/nav.ts, where they first lived. nav.ts still ships its empty
 * CUSTOM_NAV_CHANGES, since Arc CMS never edits a starter file it has shipped
 * (docs/app/custom-space.html#why-updates-never-conflict), so both are read.
 */
import { CUSTOM_NAV_CHANGES as NAV_FILE_CHANGES } from '../../../custom/nav';
import { CUSTOM_NAV_CHANGES } from '../../../custom/nav-changes';
import type { NavChange, NavChanges } from './nav-changes';

/** Several sets of changes as one: each menu's lists, in the order given. */
export function joinNavChanges(...all: (NavChanges | undefined)[]): Required<NavChanges> {
    const menu = (name: keyof NavChanges): NavChange[] => all.flatMap((changes) => changes?.[name] ?? []);
    return { admin: menu('admin'), member: menu('member') };
}

/** The app's changes to both menus, read when a menu is built. */
export function appNavChanges(): Required<NavChanges> {
    return joinNavChanges(NAV_FILE_CHANGES, CUSTOM_NAV_CHANGES);
}
