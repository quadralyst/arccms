/**
 * An app's changes to the core menus (CUSTOM_NAV_CHANGES in src/custom/nav-changes.ts,
 * docs/app/admin-menu.html, docs/app/member-area.html): change, hide, add and move items,
 * named by their `id`, for every role or only some.
 *
 * The menus only show links. Who may open a page is decided by its route guard alone,
 * so no change here lets anyone reach a page their role is refused.
 */
import { copyMenu, type MenuItem } from './menu';

/** Just before or just after the item with this id: in its list, top level or a group's sub-items. */
export type NavPlace = { before?: string; after?: string };

/** The fields of an item a change may set. */
export type NavFields = Pick<MenuItem, 'route' | 'queryParams' | 'externalUrl' | 'icon' | 'label' | 'labelKey' | 'allowRoles'>;

/** A change to an item the menu has: new fields, hidden, or moved with `before` or `after`. */
export type NavEdit = NavFields & NavPlace & {
    id: string;
    hide?: boolean;
    /** The roles this change is for; without it, every role. */
    roles?: string[];
};

/** A new item, put before or after an item, or at the end of the menu. */
export type NavAdd = NavPlace & {
    add: MenuItem & { id: string };
    /** The roles this change is for; without it, every role. */
    roles?: string[];
};

export type NavChange = NavEdit | NavAdd;

/** The app's changes to each menu, applied in the order listed. */
export type NavChanges = { admin?: NavChange[]; member?: NavChange[] };

/** What a change may not do to an item, by the item's id. */
export type NavLocks = Readonly<Record<string, readonly (keyof NavEdit)[]>>;

const FIELDS: readonly (keyof NavFields)[] = ['route', 'queryParams', 'externalUrl', 'icon', 'label', 'labelKey', 'allowRoles'];

type Spot = { list: MenuItem[]; index: number; nested: boolean };

/** Where the item with this id is: the top level or a group's sub-items. */
function find(menu: MenuItem[], id: string): Spot | null {
    for (let index = 0; index < menu.length; index++) {
        if (menu[index].id === id) return { list: menu, index, nested: false };
        const subs = menu[index].subItems;
        const subIndex = subs?.findIndex((sub) => sub.id === id) ?? -1;
        if (subs && subIndex > -1) return { list: subs, index: subIndex, nested: true };
    }
    return null;
}

/** Put the item before or after its anchor, or at the end. False when it cannot go there. */
function place(menu: MenuItem[], item: MenuItem, where: NavPlace): boolean {
    const anchor = where.before ?? where.after;
    if (!anchor) {
        menu.push(item);
        return true;
    }
    const spot = find(menu, anchor);
    // A group never goes inside another group: the menus show one level of sub-items.
    if (!spot || (spot.nested && item.subItems)) return false;
    spot.list.splice(spot.index + (where.before ? 0 : 1), 0, item);
    return true;
}

/** Whether the change is for this role. */
function forRole(change: NavChange, role: string | null | undefined): boolean {
    return !change.roles || change.roles.includes(role ?? '');
}

/**
 * The menu with the app's changes made, for a person with this role. Returns a new
 * menu; `items` is left alone. A change that names an id the menu does not have (an
 * item of a feature that is off, or a mistake the checks in src/app/custom-space.spec.ts
 * report) changes nothing, and so does an add whose id the menu already has. An add
 * whose anchor is missing goes at the end; a move whose anchor is missing stays put.
 *
 * `locks` keeps fields of some items out of reach: a locked `hide` is ignored, and a
 * locked `allowRoles` can only add roles, so whoever saw the item still does.
 */
export function applyNavChanges(items: readonly MenuItem[], changes: readonly NavChange[] = [], role?: string | null, locks: NavLocks = {}): MenuItem[] {
    const menu = copyMenu(items);
    for (const change of changes) {
        if (!forRole(change, role)) continue;
        if ('add' in change) {
            if (!change.add?.id || find(menu, change.add.id)) continue;
            const item = copyMenu([change.add])[0];
            if (!place(menu, item, change)) menu.push(item);
            continue;
        }
        const spot = find(menu, change.id);
        if (!spot) continue;
        const locked = locks[change.id] ?? [];
        const item = spot.list[spot.index];
        if (change.hide) {
            if (!locked.includes('hide')) spot.list.splice(spot.index, 1);
            continue;
        }
        for (const field of FIELDS) {
            if (change[field] === undefined) continue;
            if (field === 'allowRoles' && locked.includes('allowRoles')) {
                item.allowRoles = [...new Set([...(item.allowRoles ?? []), ...change.allowRoles!])];
                continue;
            }
            if (locked.includes(field)) continue;
            (item as Record<string, unknown>)[field] = structuredClone(change[field]);
            // An item opens a page here or an outside address, never both.
            if (field === 'route') delete item.externalUrl;
            if (field === 'externalUrl') delete item.route;
            // A label of the app's own, with no key, shows as written.
            if (field === 'label' && change.labelKey === undefined) delete item.labelKey;
        }
        if (change.before !== undefined || change.after !== undefined) {
            spot.list.splice(spot.index, 1);
            if (!place(menu, item, change)) spot.list.splice(spot.index, 0, item);
        }
    }
    return menu;
}

/** What a menu allows changes to name and do: its ids, and what is locked. */
export type MenuRules = { ids: readonly string[]; locks?: NavLocks };

const isPath = (route: unknown) => typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') && !route.startsWith('/\\');
const isHttps = (url: unknown) => typeof url === 'string' && /^https:\/\/[^/\s]+/.test(url);

/**
 * The mistakes in one menu's changes, as sentences for the test that reads
 * src/custom/nav.ts (src/app/custom-space.spec.ts). An id is valid when the menu has
 * it (`rules.ids`) or an add in the same list brings it.
 */
export function navChangeProblems(menuName: string, changes: readonly NavChange[] = [], rules: MenuRules): string[] {
    const added = changes.flatMap((c) => ('add' in c && c.add?.id ? [c.add.id, ...(c.add.subItems ?? []).flatMap((s) => (s.id ? [s.id] : []))] : []));
    const known = new Set([...rules.ids, ...added]);
    const valid = `valid ids: ${[...known].join(', ')}`;
    const problems: string[] = [];
    const say = (change: NavChange, problem: string) => {
        const name = 'add' in change ? `add '${change.add?.id ?? '?'}'` : `'${change.id}'`;
        problems.push(`${menuName} ${name}: ${problem}`);
    };
    const checkLinks = (change: NavChange, item: Partial<MenuItem>) => {
        if (item.route !== undefined && !isPath(item.route)) say(change, `route '${item.route}' is not a path on this site starting with /`);
        if (item.externalUrl !== undefined && !isHttps(item.externalUrl)) say(change, `externalUrl '${item.externalUrl}' is not an https:// address`);
        for (const sub of item.subItems ?? []) checkLinks(change, sub);
    };
    for (const change of changes) {
        if (change.before !== undefined && change.after !== undefined) say(change, 'give before or after, not both');
        for (const anchor of [change.before, change.after]) {
            if (anchor !== undefined && !known.has(anchor)) say(change, `before/after '${anchor}' is not an item of the ${menuName} menu (${valid})`);
        }
        if (change.roles !== undefined && (!Array.isArray(change.roles) || !change.roles.length)) say(change, 'roles must list at least one role, or be left out for every role');
        if ('add' in change) {
            const item = change.add;
            if (!item?.id) {
                problems.push(`${menuName} add: the new item needs an id`);
                continue;
            }
            if (rules.ids.includes(item.id) || added.filter((id) => id === item.id).length > 1) say(change, 'the menu already has an item with this id');
            if (!item.label && !item.separator) say(change, 'the new item needs a label');
            checkLinks(change, item);
            continue;
        }
        if (!known.has(change.id)) say(change, `not an item of the ${menuName} menu (${valid})`);
        const locked = rules.locks?.[change.id] ?? [];
        for (const field of locked) {
            if (field === 'allowRoles' || change[field] === undefined) continue;
            say(change, field === 'hide'
                ? 'this item cannot be hidden: people must always be able to reach their profile and sign out'
                : `${field} cannot be changed on this item: it always does the same thing`);
        }
        checkLinks(change, change);
    }
    return problems;
}

/** The items a menu's changes add, and the label keys its edits set, as items: what the translation checks read. */
export function navChangeLabels(changes: readonly NavChange[] = []): MenuItem[] {
    return changes.flatMap((c): MenuItem[] => ('add' in c ? (c.add ? [c.add] : []) : c.labelKey ? [{ label: c.label ?? c.id, labelKey: c.labelKey }] : []));
}
