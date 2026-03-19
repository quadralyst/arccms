import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterModule, RouterOutlet } from '@angular/router';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { roleGuard } from '../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Settings | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface SettingCategory {
    id: string;
    label: string;
    icon: string;
    route: string;
    description: string;
}

@Component({
    standalone: true,
    imports: [
        CommonModule,
        RouterOutlet,
        RouterModule,
        MatCardModule,
        MatIconModule,
        MatListModule,
    ],
    template: `
        <div class="settings-container">
            <!-- Settings Header -->
            <div class="settings-header">
                <h1 class="m-0">Settings</h1>
                <p class="text-muted mb-0">Manage your application settings</p>
            </div>

            <div class="settings-layout">
                <!-- Left Panel: Settings Navigation -->
                <aside class="settings-sidebar">
                    <mat-nav-list>
                        @for (category of settingCategories(); track category.id) {
                            <a mat-list-item
                               [routerLink]="category.route"
                               routerLinkActive="active"
                               class="setting-item">
                                <div class="setting-item-content">
                                    <div class="setting-item-header">
                                        <i [class]="category.icon + ' me-2'"></i>
                                        <span class="setting-label">{{ category.label }}</span>
                                    </div>
                                    <span class="setting-description">{{ category.description }}</span>
                                </div>
                            </a>
                        }
                    </mat-nav-list>
                </aside>

                <!-- Right Panel: Setting Content -->
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

        .settings-header {
            margin-bottom: 24px;
        }

        .settings-header h1 {
            font-size: 1.75rem;
            font-weight: 600;
            color: #212529;
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
        }

        .settings-sidebar mat-nav-list {
            padding-top: 4px;
            padding-bottom: 4px;
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .setting-item {
            flex: 1 !important;
            height: auto !important;
            padding: 10px 12px !important;
            margin: 2px 6px !important;
            border-radius: 6px !important;
        }

        .setting-item:hover {
            background-color: #f8f9fa !important;
        }

        .setting-item.active {
            background-color: #e7f3ff !important;
            color: #0d6efd;
        }

        .setting-item.active i {
            color: #0d6efd;
        }

        .setting-item i {
            font-size: 1rem;
            color: #6c757d;
            width: 20px;
            text-align: center;
        }

        .setting-item-content {
            display: flex;
            flex-direction: column;
        }

        .setting-item-header {
            display: flex;
            align-items: center;
        }

        .setting-label {
            font-weight: 500;
            font-size: 0.875rem;
        }

        .setting-description {
            font-size: 0.7rem;
            color: #6c757d;
            margin-top: 1px;
        }

        .settings-content {
            flex: 1;
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
                flex: none; /* Allow it to grow naturally */
            }

            .settings-sidebar {
                width: 100%;
                margin-bottom: 24px;
                background: transparent;
                box-shadow: none;
                border-radius: 0;
            }

            .settings-sidebar mat-nav-list {
                padding-top: 0;
                padding-bottom: 4px;
                display: flex;
                flex-direction: row;
                gap: 6px;
                overflow-x: auto;  /* scroll horizontally when items don't fit */
                -webkit-overflow-scrolling: touch;
            }

            .setting-item {
                flex: 0 0 auto; /* fixed size — don't squash */
                margin: 0 !important;
                border-radius: 8px !important;
                padding: 7px 10px !important;
                border: 1px solid #dee2e6;
                background: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                white-space: nowrap;
            }

            .setting-item.active {
                background-color: #0d6efd36 !important;
                color: #fff !important;
                // border-color: #0d6efd !important;

                .setting-label {
                    color: #000 !important;
                }
            }

            .setting-item.active i {
                color: #0d6efd !important;
            }

            .setting-label {
                font-size: 0.85rem; /* Slightly smaller text */
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .setting-description {
                display: none;
            }

            .settings-content {
                overflow-y: visible; /* Remove internal scroll */
                flex: none; /* Allow it to grow naturally */
                height: auto;
            }
        }
    `],
})
export default class SettingsPageComponent extends BaseComponent {
    settingCategories = signal<SettingCategory[]>([
        {
            id: 'about',
            label: 'About',
            icon: 'fa-solid fa-circle-info',
            route: '/admin/settings/about',
            description: 'Site name, URL & address',
        },
        {
            id: 'email',
            label: 'Email Settings',
            icon: 'fa-solid fa-envelope',
            route: '/admin/settings/email',
            description: 'SMTP configuration and sender info',
        },
        {
            id: 'integrations',
            label: 'Integrations',
            icon: 'fa-solid fa-plug',
            route: '/admin/settings/integrations',
            description: 'Third-party API keys & services',
        },
        {
            id: 'analytics',
            label: 'Analytics',
            icon: 'fa-solid fa-chart-line',
            route: '/admin/settings/analytics',
            description: 'Google Analytics OAuth connection',
        },
        {
            id: 'user',
            label: 'User Settings',
            icon: 'fa-solid fa-users',
            route: '/admin/settings/user',
            description: 'Signup & role settings',
        },
        {
            id: 'message',
            label: 'Global Messages',
            icon: 'fa-solid fa-comment',
            route: '/admin/settings/message',
            description: 'System-wide notifications',
        },
        {
            id: 'site-usage',
            label: 'Site Usage',
            icon: 'fa-solid fa-cookie-bite',
            route: '/admin/settings/site-usage',
            description: 'Site usage banner message and style',
        },
        {
            id: 'misc',
            label: 'Miscellaneous',
            icon: 'fa-solid fa-cog',
            route: '/admin/settings/misc',
            description: 'Branding and media upload',
        },
    ]);
}
