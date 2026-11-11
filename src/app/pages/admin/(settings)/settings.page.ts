import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, RouterModule, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { roleGuard } from '../../../guards/role.guard';
import { isOn } from '../../../core/features/features';
import type { FeatureId } from '../../../core/features/feature-registry';

export const routeMeta: RouteMeta = {
    title: 'Settings',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

/** The hub's groups, in the order they show. Names: admin.settings.hub.groups.<id>. */
export const SETTING_GROUPS = ['site', 'members', 'email', 'payments', 'connections', 'data'] as const;
export type SettingGroupId = typeof SETTING_GROUPS[number];

/** One setting page. Its name and line are admin.settings.hub.<id>.label and .description. */
export interface SettingCategory {
    id: string;
    group: SettingGroupId;
    icon: string;
    route: string;
    /** The feature this page belongs to; it is left out when that feature is off. */
    feature?: FeatureId;
}

export interface SettingGroup {
    id: SettingGroupId;
    items: SettingCategory[];
}

const CATEGORIES: SettingCategory[] = [
    { id: 'about', group: 'site', icon: 'fa-solid fa-circle-info', route: '/admin/settings/about' },
    { id: 'localization', group: 'site', icon: 'fa-solid fa-language', route: '/admin/settings/localization' },
    { id: 'misc', group: 'site', icon: 'fa-solid fa-palette', route: '/admin/settings/misc' },
    { id: 'message', group: 'site', icon: 'fa-solid fa-bullhorn', route: '/admin/settings/message' },
    { id: 'site-usage', group: 'site', icon: 'fa-solid fa-cookie-bite', route: '/admin/settings/site-usage' },
    { id: 'discoverability', group: 'site', icon: 'fa-solid fa-robot', route: '/admin/settings/discoverability', feature: 'seo' },
    { id: 'user', group: 'members', icon: 'fa-solid fa-user-check', route: '/admin/settings/user' },
    { id: 'app-audience', group: 'members', icon: 'fa-solid fa-users-viewfinder', route: '/admin/settings/app-audience', feature: 'audience' },
    { id: 'email', group: 'email', icon: 'fa-solid fa-envelope', route: '/admin/settings/email' },
    { id: 'sms', group: 'email', icon: 'fa-solid fa-comment-sms', route: '/admin/settings/sms', feature: 'sms' },
    { id: 'automations', group: 'email', icon: 'fa-solid fa-bolt', route: '/admin/settings/automations' },
    { id: 'payments', group: 'payments', icon: 'fa-solid fa-credit-card', route: '/admin/settings/payments', feature: 'payments' },
    { id: 'analytics', group: 'connections', icon: 'fa-solid fa-chart-line', route: '/admin/settings/analytics', feature: 'analytics' },
    { id: 'ai', group: 'connections', icon: 'fa-solid fa-wand-magic-sparkles', route: '/admin/settings/ai', feature: 'ai' },
    { id: 'integrations', group: 'connections', icon: 'fa-solid fa-plug', route: '/admin/settings/integrations' },
    { id: 'search', group: 'data', icon: 'fa-solid fa-magnifying-glass', route: '/admin/settings/search', feature: 'search' },
];

@Component({
    standalone: true,
    imports: [
        CommonModule,
        RouterOutlet,
        RouterModule,
        PageHeaderComponent,
        TranslocoPipe,
    ],
    template: `
        <div class="settings-container">
            <arc-page-header [title]="'admin.settings.hub.title' | transloco"
                [subtitle]="'admin.settings.hub.subtitle' | transloco"></arc-page-header>

            <div class="settings-layout">
                <aside class="settings-sidebar" [class.open]="menuOpen()">
                    <!-- On a phone the menu folds away under this button: the page opens on the setting itself. -->
                    <button type="button" class="settings-menu-toggle"
                        (click)="menuOpen.set(!menuOpen())"
                        [attr.aria-expanded]="menuOpen()"
                        aria-controls="settings-menu">
                        @if (current(); as c) {
                            <i [class]="c.icon" aria-hidden="true"></i>
                            <span class="toggle-current">{{ 'admin.settings.hub.' + c.id + '.label' | transloco }}</span>
                        }
                        <span class="toggle-all">{{ 'admin.settings.hub.all_settings' | transloco }}</span>
                        <i class="fa-solid fa-chevron-down toggle-chevron" aria-hidden="true"></i>
                    </button>

                    <nav id="settings-menu" class="settings-menu" [attr.aria-label]="'admin.settings.hub.menu_label' | transloco">
                        @for (group of settingGroups(); track group.id) {
                            <section class="setting-group">
                                <h2 class="setting-group-title" [id]="'settings-group-' + group.id">{{ 'admin.settings.hub.groups.' + group.id | transloco }}</h2>
                                <ul [attr.aria-labelledby]="'settings-group-' + group.id">
                                    @for (category of group.items; track category.id) {
                                        <li>
                                            <a [routerLink]="category.route"
                                               routerLinkActive="active"
                                               ariaCurrentWhenActive="page"
                                               class="setting-item"
                                               [attr.data-setting]="category.id"
                                               (click)="menuOpen.set(false)">
                                                <i [class]="category.icon" aria-hidden="true"></i>
                                                <span class="setting-text">
                                                    <span class="setting-label">{{ 'admin.settings.hub.' + category.id + '.label' | transloco }}</span>
                                                    <span class="setting-description">{{ 'admin.settings.hub.' + category.id + '.description' | transloco }}</span>
                                                </span>
                                            </a>
                                        </li>
                                    }
                                </ul>
                            </section>
                        }
                    </nav>
                </aside>

                <main class="settings-content">
                    <router-outlet></router-outlet>
                </main>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            height: 100%;
        }

        .settings-container {
            padding: 24px;
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        .settings-layout {
            display: flex;
            gap: 24px;
            flex: 1;
            min-height: 0;
        }

        .settings-sidebar {
            width: 260px;
            flex-shrink: 0;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow-y: auto; /* scroll the menu when it is taller than the panel */
        }

        .settings-menu-toggle {
            display: none;
        }

        .settings-menu {
            padding: 8px 6px;
        }

        .setting-group + .setting-group {
            margin-top: 8px;
        }

        .setting-group-title {
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: #495057;
            margin: 8px 10px 4px;
        }

        .setting-group ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .setting-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px 10px;
            border-radius: 6px;
            color: #212529;
            text-decoration: none;
            min-height: 44px;
        }

        .setting-item:hover {
            background-color: #f1f3f5;
        }

        .setting-item:focus-visible {
            outline: 2px solid var(--arc-admin-accent);
            outline-offset: -2px;
        }

        .setting-item.active {
            background-color: color-mix(in srgb, var(--arc-admin-accent) 12%, #fff);
            color: var(--arc-admin-accent-dark);
        }

        .setting-item i {
            font-size: 1rem;
            color: #5c636a;
            width: 20px;
            text-align: center;
            margin-top: 2px;
        }

        .setting-item.active i {
            color: var(--arc-admin-accent-dark);
        }

        .setting-text {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        .setting-label {
            font-weight: 500;
            font-size: 0.875rem;
        }

        .setting-description {
            font-size: 0.75rem;
            color: #5c636a; /* 5.9:1 on white and on the hover grey */
            margin-top: 1px;
        }

        .settings-content {
            flex: 1;
            min-width: 0;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 24px;
            overflow-y: auto;
        }

        @media (max-width: 992px) {
            :host {
                height: auto;
                min-height: 100vh;
            }

            .settings-container {
                padding: 16px;
                height: auto;
            }

            .settings-layout {
                flex-direction: column;
                flex: none;
                gap: 16px;
            }

            .settings-sidebar {
                width: 100%;
                overflow: visible;
            }

            /* The menu folds under one button; no sideways row of chips. */
            .settings-menu-toggle {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                min-height: 48px;
                padding: 10px 14px;
                border: 0;
                border-radius: 8px;
                background: transparent;
                color: #212529;
                font: inherit;
                text-align: left;
                cursor: pointer;
            }

            .settings-menu-toggle i {
                color: var(--arc-admin-accent-dark);
            }

            .toggle-current {
                font-weight: 600;
                flex: 1;
                min-width: 0;
                overflow-wrap: anywhere;
            }

            .toggle-all {
                font-size: 0.8125rem;
                color: #495057;
                white-space: nowrap;
            }

            .toggle-chevron {
                transition: transform 0.15s;
            }

            .settings-sidebar.open .toggle-chevron {
                transform: rotate(180deg);
            }

            .settings-menu {
                display: none;
                border-top: 1px solid #dee2e6;
            }

            .settings-sidebar.open .settings-menu {
                display: block;
            }

            .setting-group ul {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 2px 8px;
            }

            .setting-description {
                display: none;
            }

            .settings-content {
                overflow-y: visible;
                flex: none;
                height: auto;
                padding: 16px;
            }
        }
    `],
})
export default class SettingsPageComponent extends BaseComponent {
    /** Every setting page this build has, in group order. */
    readonly settingCategories = signal<SettingCategory[]>(
        SETTING_GROUPS.flatMap((group) => CATEGORIES.filter((c) => c.group === group))
            .filter((category) => !category.feature || isOn(category.feature)),
    );

    /** The groups with at least one page in this build. */
    readonly settingGroups = computed<SettingGroup[]>(() =>
        SETTING_GROUPS
            .map((id) => ({ id, items: this.settingCategories().filter((c) => c.group === id) }))
            .filter((group) => group.items.length > 0),
    );

    /** The phone menu: folded away until its button is pressed. */
    readonly menuOpen = signal(false);

    private readonly url = toSignal(
        this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), map((e) => e.urlAfterRedirects)),
        { initialValue: this.router.url },
    );

    /** The setting on screen, named on the phone menu button. */
    readonly current = computed(() => {
        const path = (this.url() ?? '').split(/[?#]/)[0];
        return this.settingCategories().find((c) => path === c.route || path.startsWith(c.route + '/')) ?? null;
    });
}
