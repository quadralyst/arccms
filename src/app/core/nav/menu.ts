/**
 * The menu model the admin menu and the member menu share (docs/app/admin-menu.html,
 * docs/app/member-area.html). Plain data and functions, so a page, a test or a check
 * can read a menu without rendering it.
 */
import { isOn } from '../features/features';
import type { FeatureId } from '../features/feature-registry';

export type MenuItem = {
    /**
     * The item's identity: what an app's menu changes (src/custom/nav.ts) name, and
     * what the menu keys a group's open state and the Profile and Logout items by.
     * Every core item has one; items built from CMS data (content types, signup forms)
     * have none, so an app cannot target them.
     */
    id?: string;
    icon?: string;
    /** The English label. Items built from CMS data show it as it is, since their names are data. */
    label: string;
    /** Translation key for `label`, for the items we author. */
    labelKey?: string;
    route?: string;
    externalUrl?: string;
    subItems?: MenuItem[];
    isOpen?: boolean;
    allowRoles?: string[];
    queryParams?: Record<string, string>;
    separator?: boolean;
    /** The feature this item belongs to; it is left out when that feature is off. */
    feature?: FeatureId;
};

/** A copy of the items, their sub-item lists copied too, so changing it leaves `items` alone. */
export function copyMenu(items: readonly MenuItem[]): MenuItem[] {
    return items.map((item) => (item.subItems ? { ...item, subItems: item.subItems.map((sub) => ({ ...sub })) } : { ...item }));
}

/**
 * The menu without the items of features that are off (specs/feature-flags-spec.md):
 * a group whose sub-items all go goes too, and separators never lead, trail or
 * double up. Returns new objects; `items` is left alone.
 */
export function withoutFeaturesOff(items: readonly MenuItem[], on: (id: FeatureId) => boolean = isOn): MenuItem[] {
    const kept: MenuItem[] = [];
    for (const item of items) {
        if (item.feature && !on(item.feature)) continue;
        if (item.subItems) {
            const subItems = withoutFeaturesOff(item.subItems, on);
            if (!subItems.length) continue;
            kept.push({ ...item, subItems });
            continue;
        }
        if (item.separator && (!kept.length || kept[kept.length - 1].separator)) continue;
        kept.push({ ...item });
    }
    while (kept.length && kept[kept.length - 1].separator) kept.pop();
    return kept;
}

/**
 * Put the app's menu items (CUSTOM_NAV in src/custom/nav.ts, docs/app/custom-space.html)
 * before Profile, or at the end when there is no Profile item. Changes `items` in place.
 */
export function insertCustomNav(items: MenuItem[], custom: readonly MenuItem[]): MenuItem[] {
    if (!custom.length) return items;
    const profileIndex = items.findIndex((i) => i.id === 'profile');
    items.splice(profileIndex === -1 ? items.length : profileIndex, 0, ...custom.map((item) => ({ ...item })));
    return items;
}

/** Whether a person with this role sees the item: one without `allowRoles` is everyone's. */
export function shownTo(item: MenuItem, role: string | null | undefined): boolean {
    return !item.allowRoles || item.allowRoles.includes(role ?? '') || item.allowRoles.includes('showAll');
}

/** Every id in the menu, its sub-items' included, in order. */
export function menuIds(items: readonly MenuItem[]): string[] {
    return items.flatMap((item) => [...(item.id ? [item.id] : []), ...menuIds(item.subItems ?? [])]);
}
