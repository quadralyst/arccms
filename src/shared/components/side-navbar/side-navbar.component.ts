import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslocoService } from '@jsverse/transloco';
import { SafeHtml } from '@angular/platform-browser';
import { NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import logoSmall from '../../../assets/images/logo-small.png';
import adminAvatar from '../../../assets/images/admin.png';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import { BaseComponent } from '../base/base.component';
import { ConfirmationPopupComponent } from '../confirmation-popup/confirmation-popup.component';
import { ContentTypesStore } from '../../../app/pages/admin/contents/content-types/content-types.store';
import { ContentType, contentTypeName } from '../../../app/pages/admin/contents/content-types/content-types.model';
import { WaitlistAdminStore } from '../../../app/pages/admin/(waitlists)/waitlist.store';
import { CUSTOM_NAV, CUSTOM_NAV_CHANGES } from '../../../custom/nav';
import { isOn } from '../../../app/core/features/features';
import { insertCustomNav, withoutFeaturesOff, type MenuItem } from '../../../app/core/nav/menu';
import { applyNavChanges } from '../../../app/core/nav/nav-changes';
import { ADMIN_LOCKS, adminContentGroup, coreAdminItems } from '../../../app/core/nav/admin-menu';
import { SiteBrandService } from '../../../app/core/brand/site-brand';

/**
 * Whether a logo is a wordmark rather than a mark: at least twice as wide as it is tall.
 * A wordmark shows alone in the open panel (it already carries the name) and not at all
 * in the collapsed one, which is too narrow to read it.
 */
export function isWideLogo(width: number, height: number): boolean {
    return height > 0 && width / height >= 2;
}

/**
 * An SVG's shape from its own markup: the viewBox, else its width and height. An SVG
 * with only a viewBox has no natural size in the browser, so its loaded size cannot say.
 */
export function svgSize(markup: string): { width: number; height: number } | null {
    const root = /<svg\b[^>]*>/i.exec(markup)?.[0];
    if (!root) return null;
    const box = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(root);
    if (box) return { width: Number(box[1]), height: Number(box[2]) };
    const width = /\bwidth\s*=\s*["']\s*([\d.]+)(px)?\s*["']/i.exec(root);
    const height = /\bheight\s*=\s*["']\s*([\d.]+)(px)?\s*["']/i.exec(root);
    return width && height ? { width: Number(width[1]), height: Number(height[1]) } : null;
}

function isSvg(src: string): boolean {
    return /^data:image\/svg\+xml/i.test(src) || /\.svg(\?|#|$)/i.test(src);
}

/** What a group's open state is kept by: its id, or its label for a group built from CMS data. */
function groupKey(item: MenuItem): string {
    return item.id ?? item.label;
}

/** The menu model, in src/app/core/nav/menu.ts; exported here too, where apps' src/custom/nav.ts imports it. */
export { insertCustomNav, withoutFeaturesOff, type MenuItem };

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
    readonly adminAvatar = adminAvatar;

    /** The site's name and logo (core/brand/site-brand.ts); nothing until they are in, so Arc CMS's never flashes. */
    private readonly siteBrand = inject(SiteBrandService);
    readonly brand = this.siteBrand.brand;
    /** The logo to show: the site's, or Arc CMS's small one when the site has set neither. */
    readonly panelLogo = computed(() => {
        const brand = this.brand();
        return brand ? (brand.arc ? logoSmall : brand.logo) : '';
    });
    /** The last logo measured, and whether it is a wordmark. */
    private readonly measuredLogo = signal<{ src: string; wide: boolean } | null>(null);
    /** Whether the logo shown is a wordmark: null until it has loaded. Arc CMS's own shows as a square mark, as always. */
    readonly logoWide = computed(() => {
        if (this.brand()?.arc) return false;
        const measured = this.measuredLogo();
        return measured && measured.src === this.panelLogo() ? measured.wide : null;
    });

    async measureLogo(event: Event): Promise<void> {
        const img = event.target as HTMLImageElement;
        const src = this.panelLogo();
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        if (isSvg(src)) {
            // Read from the file; a logo on another host that refuses the read keeps its loaded size.
            const size = await fetch(src).then((r) => (r.ok ? r.text() : '')).then(svgSize).catch(() => null);
            if (size) ({ width, height } = size);
        }
        if (this.panelLogo() === src) this.measuredLogo.set({ src, wide: isWideLogo(width, height) });
    }
    @Output() selectedMenu = new EventEmitter();
    @Output() toggleMenu = new EventEmitter();
    activaUrl: string = '';

    /** Current router URL, kept in sync on NavigationEnd so OnPush change detection re-evaluates active state. */
    readonly currentUrl = signal<string>(this.router.url);
    /** Explicit user expand/collapse choices, keyed by group id (label for a signup form's group). Overrides route-based auto-expand. */
    private readonly manualToggles = signal<Record<string, boolean>>({});

    private destroyRef = inject(DestroyRef);
    readonly contentTypesStore = inject(ContentTypesStore);

    /**
     * Re-read on every language change so the computed menu below recomputes.
     * The labels are resolved in TypeScript rather than by the template pipe
     * because they are also fed to `matTooltip`, sorted, and compared.
     */
    private readonly activeLang = signal(this.transloco.getActiveLang());
    /**
     * Bumped when a translation file finishes loading. The labels are resolved
     * with a synchronous `translate()`, which returns the bare key until the
     * file is in. On a first visit that can be after the nav has rendered (a
     * fresh install arrives from the onboarding wizard, which loads no admin
     * strings), and the active language never changes, so without this the
     * menu keeps showing keys until a reload.
     */
    private readonly translationsLoaded = signal(0);
    readonly waitlistAdminStore = inject(WaitlistAdminStore);

    /** Arc CMS's own items (src/app/core/nav/admin-menu.ts). */
    baseMenuItems: MenuItem[] = coreAdminItems();

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

        // A content type's name is CMS data, but the admin authored a
        // translation of it for the public pages (M-D19) and asked to read the
        // admin in this language — so use it where one exists. Untranslated
        // types keep their authored name, the same fallback the rest of the
        // admin uses. Sorting follows the displayed label, so the order is the
        // one this reader sees.
        const lang = this.activeLang();
        const contentTypeLinks: MenuItem[] = validTypes.map((t: ContentType) => ({
            icon: t.icon || 'fa-solid fa-folder',
            label: contentTypeName(t, lang),
            route: `/admin/contents/${t.slug}`,
        })).sort((a: MenuItem, b: MenuItem) => (a.label || '').localeCompare(b.label || ''));

        const contentGroup = adminContentGroup(contentTypeLinks);

        // Dynamic waitlist items
        const waitlists = this.waitlistAdminStore.items();
        const dynamicWaitlistItems: MenuItem[] = waitlists.map((w: any) => ({
            icon: 'fa-solid fa-clipboard-list',
            label: w.name,
            allowRoles: [this.constantVariables.ADMIN],
            feature: 'forms' as const,
            subItems: [
                { label: 'Dashboard', labelKey: 'admin.nav.dashboard', route: `/admin/waitlists/dashboard/${w.id}`, icon: 'fa-solid fa-gauge-high' } as MenuItem,
                { label: 'Users', labelKey: 'admin.nav.users', route: `/admin/waitlists/users/${w.id}`, icon: 'fa-solid fa-users', queryParams: { returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
                // The form's list hub (U4): its audience, broadcast history and
                // sequence. The list id mirrors the form id (`waitlistListId()`).
                { label: 'Audience & emails', labelKey: 'admin.nav.audience_and_emails', route: `/admin/lists/waitlist-${w.id}`, icon: 'fa-solid fa-paper-plane', feature: 'audience' } as MenuItem,
                { label: 'Tags', labelKey: 'admin.nav.tags', route: `/admin/waitlists/tags`, icon: 'fa-solid fa-tags', queryParams: { waitlistId: w.id, waitlistName: w.name, returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
                { label: 'Email Templates', labelKey: 'admin.nav.email_templates', route: `/admin/waitlists/templates/${w.id}`, icon: 'fa-solid fa-envelope', queryParams: { returnUrl: `/admin/waitlists/dashboard/${w.id}` } } as MenuItem,
            ]
        })).sort((a: MenuItem, b: MenuItem) => (a.label || '').localeCompare(b.label || ''));

        // Dashboard, Signup Forms and each form's own group, Media Manager, then
        // Content between separators, then the rest. The legacy Subscribers link
        // is gone (U6): it viewed the frozen `WaitlistedUsers` collection, and
        // Audience → Contacts supersedes it.
        const separator = (): MenuItem => ({ label: '', separator: true, allowRoles: [this.constantVariables.ADMIN, this.constantVariables.USER] });
        const [dashboard, signupForms, mediaManager, ...rest] = this.baseMenuItems;
        // Items of features that are off go (specs/feature-flags-spec.md), and
        // with them any separator left with nothing to separate.
        const items = withoutFeaturesOff([
            dashboard, signupForms, ...dynamicWaitlistItems, mediaManager,
            separator(), contentGroup, separator(),
            ...rest,
        ]);
        // The app's own items (src/custom/nav.ts), before Profile.
        insertCustomNav(items, withoutFeaturesOff(CUSTOM_NAV));
        // Then the app's changes for this person's role (src/custom/nav.ts), which can
        // neither bring back an item of a feature that is off nor take away Profile or Logout.
        const changed = applyNavChanges(items, CUSTOM_NAV_CHANGES.admin, this.authStore.currentUser()?.role, ADMIN_LOCKS);
        // A separator before Profile, wherever it is; then none leading, trailing or doubled.
        const profileIndex = changed.findIndex(i => i.id === 'profile');
        if (profileIndex > -1) changed.splice(profileIndex, 0, separator());
        const menu = withoutFeaturesOff(changed);

        // Resolve each group's open state: honour explicit user toggles, otherwise
        // auto-expand the group whose child matches the current route so the active
        // item stays visible after the page loads.
        const url = this.currentUrl();
        const toggles = this.manualToggles();
        for (const item of menu) {
            if (!item.subItems?.length) continue;
            const containsActiveRoute = item.subItems.some(sub => this.isUrlUnder(url, sub.route));
            const key = groupKey(item);
            item.isOpen = key in toggles ? toggles[key] : containsActiveRoute;
        }
        return menu;
    });

    /** A menu item's display label: translated when we authored it, data otherwise. */
    menuLabel(item: MenuItem): string {
        this.activeLang();
        this.translationsLoaded();
        return item.labelKey ? this.transloco.translate(item.labelKey) : item.label;
    }

    ngOnInit() {
        void this.siteBrand.load();
        this.transloco.langChanges$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(lang => this.activeLang.set(lang));
        this.transloco.events$
            .pipe(
                filter((event) => event.type === 'translationLoadSuccess'),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(() => this.translationsLoaded.update((n) => n + 1));
        // Each read feeds only its feature's menu, so a feature that is off costs none.
        if (isOn('content')) this.contentTypesStore.getAll();
        if (isOn('forms')) this.waitlistAdminStore.subscribe();
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
            this.manualToggles.update(toggles => ({ ...toggles, [groupKey(item)]: nextOpen }));
        } else if (item.id === 'logout') {
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
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            this.transloco.translate('admin.nav.logout_confirm'),
        );
        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                // dialogType is a discriminator the dialog switches on, not
                // display text — it stays English.
                dialogType: 'Logout',
        titleKey: 'common.dialog.logout',
                dialogMessage: msg,
                btnText: this.transloco.translate('common.actions.logout'),
                panelType: 'warn',
            },
        });
        dialogRef.afterClosed().subscribe((result: any) => {
            if (!!result) {
                this.authStore.logout().subscribe({
                    next: () => {
                        this.toastService.openCustomSnackbar(this.transloco.translate('admin.nav.logout_success'), 'success', 'check_circle');
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
