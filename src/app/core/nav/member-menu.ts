/**
 * Arc CMS's member menu as data (docs/app/member-area.html), rendered by the member
 * area's layout (src/app/pages/user/user-shell.component.ts). The Sign out button is
 * not one of these items: it is always there.
 */
import { isOn } from '../features/features';
import type { FeatureId } from '../features/feature-registry';
import { menuIds, shownTo, withoutFeaturesOff, type MenuItem } from './menu';
import { applyNavChanges, type NavChange } from './nav-changes';

/** What decides which core items a person gets. */
export type MemberMenuState = {
    /** The app's home page for this person (src/custom/home.ts), or null when it is the member dashboard. */
    home: string | null;
    /** Whether this person may open Arc CMS's member pages (src/custom/app-accounts.ts). */
    memberPages: boolean;
    /** The signed-in person's role. */
    role?: string | null;
};

/** The ids of the items only people who may open the member pages get. */
const MEMBER_PAGES = new Set(['dashboard', 'payments', 'account', 'premium', 'profile']);

/** Every core item, in order, with Home leading to `home`. */
export function coreMemberItems(home: string): MenuItem[] {
    return [
        { id: 'home', label: 'Home', labelKey: 'user.nav.home', icon: 'fa-solid fa-house', route: home },
        { id: 'dashboard', label: 'Dashboard', labelKey: 'user.nav.dashboard', icon: 'fa-solid fa-gauge', route: '/user/dashboard' },
        { id: 'payments', label: 'Payments', labelKey: 'user.nav.payments', icon: 'fa-solid fa-coins', route: '/user/payments', feature: 'payments' },
        { id: 'account', label: 'Account & Billing', labelKey: 'user.nav.account', icon: 'fa-solid fa-receipt', route: '/account', feature: 'payments' },
        { id: 'premium', label: 'Premium', labelKey: 'user.nav.premium', icon: 'fa-solid fa-star', route: '/user/premium', feature: 'payments' },
        { id: 'profile', label: 'Profile', labelKey: 'user.nav.profile', icon: 'fa-solid fa-user', route: '/user/profile' },
        { id: 'plans', label: 'Plans', labelKey: 'user.nav.plans', icon: 'fa-solid fa-tag', route: '/pricing', feature: 'payments' },
    ];
}

/** Every core member menu id, in menu order: the ids an app's changes may name. */
export const MEMBER_MENU_IDS: readonly string[] = menuIds(coreMemberItems('/'));

/**
 * The member menu a person sees: the core items they get (Home only when their home
 * is an app page, the member pages only when they may open them, the payment pages
 * only with payments on), then the app's changes for their role, then the items of
 * features that are off and of other roles left out.
 */
export function memberMenu(state: MemberMenuState, changes: readonly NavChange[] = [], on: (id: FeatureId) => boolean = isOn): MenuItem[] {
    const core = coreMemberItems(state.home ?? '').filter((item) =>
        item.id === 'home' ? !!state.home : !MEMBER_PAGES.has(item.id!) || state.memberPages,
    );
    const changed = applyNavChanges(withoutFeaturesOff(core, on), changes, state.role);
    return withoutFeaturesOff(changed, on)
        .filter((item) => shownTo(item, state.role))
        .map((item) => (item.subItems ? { ...item, subItems: item.subItems.filter((sub) => shownTo(sub, state.role)) } : item));
}
