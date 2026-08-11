import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltip } from '@angular/material/tooltip';
import { SafeHtml } from '@angular/platform-browser';
import { NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import logoSmall from '../../../assets/images/logo-small.png';
import adminAvatar from '../../../assets/images/admin.png';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import MediaManagerComponent from '../../../app/pages/admin/(media)/media.page';
import { BaseComponent } from '../base/base.component';
import { ConfirmationPopupComponent } from '../confirmation-popup/confirmation-popup.component';
import { ContentTypesStore } from '../../../app/pages/admin/contents/content-types/content-types.store';
import { ContentType } from '../../../app/pages/admin/contents/content-types/content-types.model';
import { WaitlistAdminStore } from '../../../app/pages/admin/(waitlists)/waitlist.store';

export type MenuItem = {
    icon?: string;
    label: string;
    route?: string;
    externalUrl?: string;
    subItems?: MenuItem[];
    isOpen?: boolean;
    allowRoles?: string[];
    queryParams?: Record<string, string>;
    separator?: boolean;
};

@Component({
    selector: 'arc-side-navbar',
    standalone: true,
    animations: [
        trigger('expandContractMenu', [
            transition(':enter', [
                style({ height: 0, opacity: 0 }),
                animate('500ms ease-in-out', style({ height: '*', opacity: 1 })),
            ]),
            transition(':leave', [
                style({ height: '*', opacity: 1 }),
                animate('500ms ease-in-out', style({ height: 0, opacity: 0 })),
            ]),
        ]),
    ],
    imports: [
        CommonModule,
        MatIconModule,
        MatSidenavModule,
        MatListModule,
        RouterModule,
        MatCardModule,
        MatSidenavModule,
        MatButtonModule,
        MatTooltip,
    ],
    templateUrl: './side-navbar.component.html',
    styleUrls: ['./side-navbar.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class NavbarComponent extends BaseComponent {
    @Input() isExpanded: boolean | undefined;
    @Input() drawerMode: string | undefined;
    readonly dialog = inject(MatDialog);
    readonly authStore = inject(AuthState);
    readonly logoSmall = logoSmall;
    readonly adminAvatar = adminAvatar;
    @Output() selectedMenu = new EventEmitter();
    @Output() toggleMenu = new EventEmitter();
    activaUrl: string = '';

    /** Current router URL, kept in sync on NavigationEnd so OnPush change detection re-evaluates active state. */
    readonly currentUrl = signal<string>(this.router.url);
    /** Explicit user expand/collapse choices, keyed by group label. Overrides route-based auto-expand. */
    private readonly manualToggles = signal<Record<string, boolean>>({});

    readonly contentTypesStore = inject(ContentTypesStore);
    readonly waitlistAdminStore = inject(WaitlistAdminStore);

    baseMenuItems: MenuItem[] = [
        {
            icon: 'fa-solid fa-gauge-high',
            label: 'Dashboard',
            route: '/admin/dashboard',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            // Reframed as "Signup Forms" (U3): a waitlist is a signup form with
            // gamification on. Route + collection unchanged — label only.
            icon: 'fa-solid fa-list-alt',
            label: 'Signup Forms',
            route: '/admin/waitlists',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            icon: 'fa-solid fa-images',
            label: 'Media Manager',
            route: '/admin/media',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            icon: 'fa-solid fa-users',
            label: 'Users',
            route: '/admin/users',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            icon: 'fa-solid fa-address-book',
            label: 'Audience',
            allowRoles: [this.constantVariables.ADMIN],
            subItems: [
                { label: 'Contacts', route: '/admin/contacts', icon: 'fa-solid fa-user-group' },
                { label: 'Lists', route: '/admin/lists', icon: 'fa-solid fa-rectangle-list' },
                { label: 'Tags', route: '/admin/contact-tags', icon: 'fa-solid fa-tags' },
                { label: 'Fields', route: '/admin/contact-fields', icon: 'fa-solid fa-table-columns' },
            ],
        },
        {
            icon: 'fa-solid fa-palette',
            label: 'Email',
            allowRoles: [this.constantVariables.ADMIN],
            subItems: [
                { label: 'Brand Kit', route: '/admin/email/brand-kit', icon: 'fa-solid fa-palette' },
                { label: 'Composer', route: '/admin/email/composer', icon: 'fa-solid fa-pen-ruler' },
                { label: 'Broadcasts', route: '/admin/email/broadcasts', icon: 'fa-solid fa-tower-broadcast' },
                { label: 'Drip Campaigns', route: '/admin/email/drip-campaigns', icon: 'fa-solid fa-droplet' },
                { label: 'Announcements', route: '/admin/email/announcements', icon: 'fa-solid fa-bullhorn' },
                { label: 'Email Logs', route: '/admin/email-logs', icon: 'fa-solid fa-envelope-open-text' },
            ],
        },
        {
            icon: 'fa-solid fa-box-open',
            label: 'Products',
            route: '/admin/products',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            icon: 'fa-solid fa-receipt',
            label: 'Transactions',
            route: '/admin/transactions',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            icon: 'fa-solid fa-database',
            label: 'Data',
            allowRoles: [this.constantVariables.ADMIN],
            subItems: [
                { label: 'Export Data', route: '/admin/data/export-data', icon: 'fa-solid fa-file-export' },
                { label: 'Import Data', route: '/admin/data/import-data', icon: 'fa-solid fa-file-import' },
                { label: 'Export Files', route: '/admin/data/export-files', icon: 'fa-solid fa-cloud-arrow-down' },
                { label: 'Import Files', route: '/admin/data/import-files', icon: 'fa-solid fa-cloud-arrow-up' },
            ],
        },
        {
            icon: 'fa-solid fa-user',
            label: 'Profile',
            route: '/admin/profile',
            allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER],
        },
        {
            icon: 'fa-solid fa-gear',
            label: 'Settings',
            route: '/admin/settings',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            icon: 'fa-solid fa-circle-info',
            label: 'About',
            externalUrl: 'https://arccms.com/about',
            allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER],
        },
        {
            icon: 'fa-solid fa-right-from-bracket',
            label: 'Logout',
            route: '',
            allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER],
        },
    ];

    menuItems = computed(() => {
        const types = this.contentTypesStore.items();
        // Filter out content types without valid slugs
        const validTypes = types.filter((t: ContentType) => {
            if (!t.slug) {
                console.warn(`Content type "${t.name}" is missing a slug and will not appear in navigation`);
                return false;
            }
            return true;
        });

        const contentTypeLinks: MenuItem[] = validTypes.map((t: ContentType) => ({
            icon: t.icon || 'fa-solid fa-folder',
            label: t.name,
            route: `/admin/contents/${t.slug}`,
        })).sort((a: MenuItem, b: MenuItem) => (a.label || '').localeCompare(b.label || ''));

        const contentGroup: MenuItem = {
            icon: 'fa-solid fa-layer-group',
            label: 'Content',
            allowRoles: [this.constantVariables.ADMIN],
            subItems: [
                { label: 'Content types', route: '/admin/contents/content-types', icon: 'fa-solid fa-newspaper' },
                ...contentTypeLinks,
            ],
        };

        // Dynamic waitlist items
        const waitlists = this.waitlistAdminStore.items();
        const dynamicWaitlistItems: MenuItem[] = waitlists.map((w: any) => ({
            icon: 'fa-solid fa-clipboard-list',
            label: w.name,
            allowRoles: [this.constantVariables.ADMIN],
            subItems: [
                { label: 'Dashboard', route: `/admin/waitlists/dashboard/${w.id}`, icon: 'fa-solid fa-gauge-high' } as MenuItem,
                { label: 'Users', route: `/admin/waitlists/users/${w.id}`, icon: 'fa-solid fa-users', queryParams: { returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
                // The form's list hub (U4): its audience, broadcast history and
                // sequence. The list id mirrors the form id (`waitlistListId()`).
                { label: 'Audience & emails', route: `/admin/lists/waitlist-${w.id}`, icon: 'fa-solid fa-paper-plane' } as MenuItem,
                { label: 'Tags', route: `/admin/waitlists/tags`, icon: 'fa-solid fa-tags', queryParams: { waitlistId: w.id, waitlistName: w.name, returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
                { label: 'Email Templates', route: `/admin/waitlists/templates/${w.id}`, icon: 'fa-solid fa-envelope', queryParams: { returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
            ]
        })).sort((a: MenuItem, b: MenuItem) => (a.label || '').localeCompare(b.label || ''));

        const items = [...this.baseMenuItems];
        // Insert the per-form items after Waitlists (index 2). The legacy
        // Subscribers link is gone (U6): it viewed the frozen `WaitlistedUsers`
        // collection, and Audience → Contacts supersedes it.
        items.splice(2, 0, ...dynamicWaitlistItems);
        // Add separator after waitlist section
        const waitlistSectionEnd = 3 + dynamicWaitlistItems.length;
        items.splice(waitlistSectionEnd, 0, { label: '', separator: true, allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER] });
        // Insert the Content group after the separator
        items.splice(waitlistSectionEnd + 1, 0, contentGroup);
        // Add separator after the Content group (before Media Manager)
        items.splice(waitlistSectionEnd + 2, 0, { label: '', separator: true, allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER] });
        // Add separator before Profile (find its index)
        const profileIndex = items.findIndex(i => i.label === 'Profile');
        if (profileIndex > -1) {
            items.splice(profileIndex, 0, { label: '', separator: true, allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER] });
        }

        // Resolve each group's open state: honour explicit user toggles, otherwise
        // auto-expand the group whose child matches the current route so the active
        // item stays visible after the page loads.
        const url = this.currentUrl();
        const toggles = this.manualToggles();
        for (const item of items) {
            if (!item.subItems?.length) continue;
            const containsActiveRoute = item.subItems.some(sub => this.isUrlUnder(url, sub.route));
            item.isOpen = item.label in toggles ? toggles[item.label] : containsActiveRoute;
        }
        return items;
    });

    ngOnInit() {
        this.contentTypesStore.getAll();
        this.waitlistAdminStore.subscribe();
        this.router.events
            .pipe(filter((event: any): event is NavigationEnd => event instanceof NavigationEnd))
            .subscribe((event: NavigationEnd) => {
                this.currentUrl.set(event.urlAfterRedirects);
            });
    }

    toggleDropdown(item: MenuItem) {
        this.selectedMenu.emit(item);
        if (item.subItems) {
            const nextOpen = !item.isOpen;
            item.isOpen = nextOpen;
            // Remember the explicit choice so a route-driven recompute doesn't override it.
            this.manualToggles.update(toggles => ({ ...toggles, [item.label]: nextOpen }));
        } else if (item.label === 'Logout') {
            this.confirmLogout();
        }
        if (this.drawerMode === 'over' && item.route) {
            this.toggleMenu.emit();
        }
    }

    public subItemClick(): void {
        if (this.drawerMode === 'over') {
            this.toggleMenu.emit();
        }
    }

    confirmLogout() {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(`Are you sure you want to logout ?`);
        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                dialogType: 'Logout',
                dialogMessage: msg,
                btnText: 'Logout',
                panelType: 'warn',
            },
        });
        dialogRef.afterClosed().subscribe((result: any) => {
            if (!!result) {
                this.authStore.logout().subscribe({
                    next: () => {
                        this.toastService.openCustomSnackbar('Logout successful.', 'success', 'check_circle');
                        this.router.navigate(['/signup']);
                    },
                    error: (err) => {
                        console.error('Logout error', err);
                        // Navigate anyway to clear local state
                        this.router.navigate(['/signup']);
                    }
                });
            }
        });
    }

    public openMediaManager(): void {
        this.dialog.open(MediaManagerComponent, {
            enterAnimationDuration: '450ms',
            exitAnimationDuration: '300ms',
            minWidth: '134vh',
            maxHeight: '90vh',
            panelClass: 'common-dialog-box',
            disableClose: true,
            data: {
                isDialogOpen: true,
            },
        });
    }

    isRouteActive(route: string): boolean {
        // Read the signal so this binding re-evaluates under OnPush whenever navigation occurs.
        this.currentUrl();
        if (!route) return false;
        return this.router.isActive(route, {
            paths: 'exact',
            queryParams: 'ignored',
            matrixParams: 'ignored',
            fragment: 'ignored',
        });
    }

    /** True when `url` targets `route` or a descendant of it (path-only, ignoring query string). */
    private isUrlUnder(url: string, route?: string): boolean {
        if (!route) return false;
        const path = url.split('?')[0].split('#')[0];
        return path === route || path.startsWith(route + '/');
    }
}
