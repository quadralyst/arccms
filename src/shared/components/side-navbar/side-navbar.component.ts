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
            icon: 'fa-solid fa-list-alt',
            label: 'Waitlists',
            route: '/admin/waitlists',
            allowRoles: [this.constantVariables.ADMIN],
        },
        {
            icon: 'fa-solid fa-newspaper',
            label: 'Contents Type',
            route: '/admin/contents/content-types',
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
            icon: 'fa-solid fa-envelope-open-text',
            label: 'Email Logs',
            route: '/admin/email-logs',
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

        const dynamicContentItems: MenuItem[] = validTypes.map((t: ContentType) => ({
            icon: t.icon || 'fa-solid fa-folder',
            label: t.name,
            allowRoles: [this.constantVariables.ADMIN],
            subItems: [
                { label: `List ${t.name}`, route: `/admin/contents/${t.slug}`, icon: 'fa-solid fa-list' },
                { label: `Add ${t.singularName || t.name}`, route: `/admin/contents/${t.slug}/add`, icon: 'fa-solid fa-plus' }
            ]
        })).sort((a: MenuItem, b: MenuItem) => (a.label || '').localeCompare(b.label || ''));

        // Dynamic waitlist items
        const waitlists = this.waitlistAdminStore.items();
        const dynamicWaitlistItems: MenuItem[] = waitlists.map((w: any) => ({
            icon: 'fa-solid fa-clipboard-list',
            label: w.name,
            allowRoles: [this.constantVariables.ADMIN],
            subItems: [
                { label: 'Dashboard', route: `/admin/waitlists/dashboard/${w.id}`, icon: 'fa-solid fa-gauge-high' } as MenuItem,
                { label: 'Users', route: `/admin/waitlists/users/${w.id}`, icon: 'fa-solid fa-users', queryParams: { returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
                { label: 'Tags', route: `/admin/waitlists/tags`, icon: 'fa-solid fa-tags', queryParams: { waitlistId: w.id, waitlistName: w.name, returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
                { label: 'Email Templates', route: `/admin/waitlists/templates/${w.id}`, icon: 'fa-solid fa-envelope', queryParams: { returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
            ]
        })).sort((a: MenuItem, b: MenuItem) => (a.label || '').localeCompare(b.label || ''));

        const items = [...this.baseMenuItems];
        // Insert waitlist items after Waitlists (index 2), with Subscribers link first
        const subscribersItem: MenuItem = {
            icon: 'fa-solid fa-address-book',
            label: 'Subscribers',
            route: '/admin/waitlists/subscribers',
            allowRoles: [this.constantVariables.ADMIN],
        };
        items.splice(2, 0, subscribersItem, ...dynamicWaitlistItems);
        // Add separator after waitlist section
        const waitlistSectionEnd = 3 + dynamicWaitlistItems.length;
        items.splice(waitlistSectionEnd, 0, { label: '', separator: true, allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER] });
        // Insert content type items after the separator
        items.splice(waitlistSectionEnd + 1, 0, ...dynamicContentItems);
        // Add separator after content types section (before Users)
        const contentSectionEnd = waitlistSectionEnd + 1 + dynamicContentItems.length + 1; // +1 for Contents Type static item
        items.splice(contentSectionEnd, 0, { label: '', separator: true, allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER] });
        // Add separator before Profile (find its index)
        const profileIndex = items.findIndex(i => i.label === 'Profile');
        if (profileIndex > -1) {
            items.splice(profileIndex, 0, { label: '', separator: true, allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER] });
        }
        return items;
    });

    ngOnInit() {
        this.contentTypesStore.getAll();
        this.waitlistAdminStore.subscribe();
        this.router.events
            .pipe(filter((event: any): event is NavigationEnd => event instanceof NavigationEnd))
            .subscribe((event) => { });
    }

    toggleDropdown(item: MenuItem) {
        this.selectedMenu.emit(item);
        if (item.subItems) {
            item.isOpen = !item.isOpen;
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
        return this.router.isActive(route, {
            paths: 'exact',
            queryParams: 'exact',
            matrixParams: 'ignored',
            fragment: 'ignored',
        });
    }
}
