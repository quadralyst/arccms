/**
 * Arc CMS's admin menu as data (docs/app/admin-menu.html), read by the side menu
 * (src/shared/components/side-navbar/side-navbar.component.ts), which adds the content
 * types, the signup forms, the app's items and changes, and the separators.
 */
import { isOn } from '../features/features';
import { menuIds, type MenuItem } from './menu';
import type { NavLocks } from './nav-changes';

const ADMIN = 'admin';
const USER = 'user';

/** The items in their order, Dashboard, Signup Forms and Media Manager first: the menu puts the forms' groups and Content after them. */
export function coreAdminItems(): MenuItem[] {
    return [
        { id: 'dashboard', icon: 'fa-solid fa-gauge-high', label: 'Dashboard', labelKey: 'admin.nav.dashboard', route: '/admin/dashboard', allowRoles: [ADMIN] },
        // Reframed as "Signup Forms" (U3). Route + collection unchanged: label only.
        { id: 'signup-forms', icon: 'fa-solid fa-list-alt', label: 'Signup Forms', labelKey: 'admin.nav.signup_forms', route: '/admin/waitlists', allowRoles: [ADMIN], feature: 'forms' },
        { id: 'media', icon: 'fa-solid fa-images', label: 'Media Manager', labelKey: 'admin.nav.media_manager', route: '/admin/media', allowRoles: [ADMIN] },
        { id: 'users', icon: 'fa-solid fa-users', label: 'Users', labelKey: 'admin.nav.users', route: '/admin/users', allowRoles: [ADMIN] },
        {
            id: 'audience',
            icon: 'fa-solid fa-address-book',
            label: 'Audience',
            labelKey: 'admin.nav.audience',
            allowRoles: [ADMIN],
            feature: 'audience',
            subItems: [
                { id: 'contacts', label: 'Contacts', labelKey: 'admin.nav.contacts', route: '/admin/contacts', icon: 'fa-solid fa-user-group' },
                { id: 'lists', label: 'Lists', labelKey: 'admin.nav.lists', route: '/admin/lists', icon: 'fa-solid fa-rectangle-list' },
                { id: 'contact-tags', label: 'Tags', labelKey: 'admin.nav.tags', route: '/admin/contact-tags', icon: 'fa-solid fa-tags' },
                { id: 'contact-fields', label: 'Fields', labelKey: 'admin.nav.fields', route: '/admin/contact-fields', icon: 'fa-solid fa-table-columns' },
                { id: 'app-users', label: 'App users', labelKey: 'admin.nav.app_users', route: '/admin/app-users', icon: 'fa-solid fa-mobile-screen' },
            ],
        },
        {
            id: 'email',
            icon: 'fa-solid fa-palette',
            label: 'Email + SMS',
            // Without SMS the group is only email, and says so.
            labelKey: isOn('sms') ? 'admin.nav.email' : 'admin.nav.email_only',
            allowRoles: [ADMIN],
            subItems: [
                { id: 'brand-kit', label: 'Brand Kit', labelKey: 'admin.nav.brand_kit', route: '/admin/email/brand-kit', icon: 'fa-solid fa-palette' },
                { id: 'composer', label: 'Composer', labelKey: 'admin.nav.composer', route: '/admin/email/composer', icon: 'fa-solid fa-pen-ruler' },
                { id: 'broadcasts', label: 'Broadcasts', labelKey: 'admin.nav.broadcasts', route: '/admin/email/broadcasts', icon: 'fa-solid fa-tower-broadcast', feature: 'email-marketing' },
                { id: 'drip-campaigns', label: 'Drip Campaigns', labelKey: 'admin.nav.drip_campaigns', route: '/admin/email/drip-campaigns', icon: 'fa-solid fa-droplet', feature: 'email-marketing' },
                { id: 'announcements', label: 'Announcements', labelKey: 'admin.nav.announcements', route: '/admin/email/announcements', icon: 'fa-solid fa-bullhorn', feature: 'email-marketing' },
                { id: 'email-logs', label: 'Email Logs', labelKey: 'admin.nav.email_logs', route: '/admin/email-logs', icon: 'fa-solid fa-envelope-open-text' },
                { id: 'sms-logs', label: 'SMS Logs', labelKey: 'admin.nav.sms_logs', route: '/admin/sms-logs', icon: 'fa-solid fa-comment-sms', feature: 'sms' },
            ],
        },
        { id: 'feedback', icon: 'fa-solid fa-comment-dots', label: 'Feedback', labelKey: 'admin.nav.feedback', route: '/admin/feedback', allowRoles: [ADMIN] },
        { id: 'messages', icon: 'fa-solid fa-envelope', label: 'Messages', labelKey: 'admin.nav.messages', route: '/admin/messages', allowRoles: [ADMIN], feature: 'contact' },
        { id: 'products', icon: 'fa-solid fa-box-open', label: 'Products', labelKey: 'admin.nav.products', route: '/admin/products', allowRoles: [ADMIN], feature: 'payments' },
        { id: 'transactions', icon: 'fa-solid fa-receipt', label: 'Transactions', labelKey: 'admin.nav.transactions', route: '/admin/transactions', allowRoles: [ADMIN], feature: 'payments' },
        {
            id: 'data',
            icon: 'fa-solid fa-database',
            label: 'Data',
            labelKey: 'admin.nav.data',
            allowRoles: [ADMIN],
            feature: 'data',
            subItems: [
                { id: 'export-data', label: 'Export Data', labelKey: 'admin.nav.export_data', route: '/admin/data/export-data', icon: 'fa-solid fa-file-export' },
                { id: 'import-data', label: 'Import Data', labelKey: 'admin.nav.import_data', route: '/admin/data/import-data', icon: 'fa-solid fa-file-import' },
                { id: 'export-files', label: 'Export Files', labelKey: 'admin.nav.export_files', route: '/admin/data/export-files', icon: 'fa-solid fa-cloud-arrow-down' },
                { id: 'import-files', label: 'Import Files', labelKey: 'admin.nav.import_files', route: '/admin/data/import-files', icon: 'fa-solid fa-cloud-arrow-up' },
            ],
        },
        { id: 'profile', icon: 'fa-solid fa-user', label: 'Profile', labelKey: 'admin.nav.profile', route: '/admin/profile', allowRoles: [ADMIN, USER] },
        { id: 'settings', icon: 'fa-solid fa-gear', label: 'Settings', labelKey: 'admin.nav.settings', route: '/admin/settings', allowRoles: [ADMIN] },
        { id: 'about', icon: 'fa-solid fa-circle-info', label: 'About', labelKey: 'admin.nav.about', externalUrl: 'https://arccms.com/about', allowRoles: [ADMIN, USER] },
        { id: 'logout', icon: 'fa-solid fa-right-from-bracket', label: 'Logout', labelKey: 'admin.nav.logout', route: '', allowRoles: [ADMIN, USER] },
    ];
}

/** The Content group: Content types and Authors, then a link per content type (`typeLinks`). */
export function adminContentGroup(typeLinks: MenuItem[] = []): MenuItem {
    return {
        id: 'content',
        icon: 'fa-solid fa-layer-group',
        label: 'Content',
        labelKey: 'admin.nav.content',
        allowRoles: [ADMIN],
        feature: 'content',
        subItems: [
            { id: 'content-types', label: 'Content types', labelKey: 'admin.nav.content_types', route: '/admin/contents/content-types', icon: 'fa-solid fa-newspaper' },
            { id: 'authors', label: 'Authors', labelKey: 'admin.nav.authors', route: '/admin/authors', icon: 'fa-solid fa-user-pen' },
            ...typeLinks,
        ],
    };
}

/**
 * Profile and Logout stay in the admin menu whatever an app changes: people must always
 * be able to reach their profile and sign out. Logout always opens the sign-out dialog.
 */
export const ADMIN_LOCKS: NavLocks = {
    profile: ['hide', 'allowRoles'],
    logout: ['hide', 'allowRoles', 'route', 'queryParams', 'externalUrl'],
};

/** Every core admin menu id, in menu order: the ids an app's changes may name. */
export const ADMIN_MENU_IDS: readonly string[] = (() => {
    const [dashboard, signupForms, media, ...rest] = coreAdminItems();
    return menuIds([dashboard, signupForms, media, adminContentGroup(), ...rest]);
})();
