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
    title: 'Data Management | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface DataCategory {
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
        <div class="data-container">
            <div class="data-header">
                <h1 class="m-0">Data Management</h1>
                <p class="text-muted mb-0">Import and export data and files</p>
            </div>

            <div class="data-layout">
                <aside class="data-sidebar">
                    <mat-nav-list>
                        @for (category of dataCategories(); track category.id) {
                            <a mat-list-item
                               [routerLink]="category.route"
                               routerLinkActive="active"
                               class="data-item">
                                <i [class]="category.icon + ' me-3'"></i>
                                <div class="data-item-content">
                                    <span class="data-label">{{ category.label }}</span>
                                    <span class="data-description">{{ category.description }}</span>
                                </div>
                            </a>
                        }
                    </mat-nav-list>
                </aside>

                <main class="data-content">
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

        .data-container {
            padding: 24px;
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        .data-header {
            margin-bottom: 24px;
        }

        .data-header h1 {
            font-size: 1.75rem;
            font-weight: 600;
            color: #212529;
        }

        .data-layout {
            display: flex;
            gap: 24px;
            flex: 1;
            min-height: 0;
        }

        .data-sidebar {
            width: 280px;
            flex-shrink: 0;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }

        .data-sidebar mat-nav-list {
            padding-top: 8px;
        }

        .data-item {
            height: auto !important;
            padding: 16px !important;
            margin: 4px 8px !important;
            border-radius: 6px !important;
        }

        .data-item:hover {
            background-color: #f8f9fa !important;
        }

        .data-item.active {
            background-color: #e7f3ff !important;
            color: #0d6efd;
        }

        .data-item.active i {
            color: #0d6efd;
        }

        .data-item i {
            font-size: 1.25rem;
            color: #6c757d;
            width: 24px;
            text-align: center;
        }

        .data-item-content {
            display: flex;
            flex-direction: column;
        }

        .data-label {
            font-weight: 500;
            font-size: 0.95rem;
        }

        .data-description {
            font-size: 0.75rem;
            color: #6c757d;
            margin-top: 2px;
        }

        .data-content {
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

            .data-container {
                padding: 16px;
                height: auto;
            }

            .data-layout {
                flex-direction: column;
                flex: none;
            }

            .data-sidebar {
                width: 100%;
                margin-bottom: 24px;
                background: transparent;
                box-shadow: none;
                border-radius: 0;
            }

            .data-sidebar mat-nav-list {
                padding-top: 0;
                display: flex;
                flex-direction: row;
                gap: 8px;
                padding-bottom: 4px;
                justify-content: center;
            }

            .data-item {
                flex: 1 1 auto;
                margin: 0 !important;
                border-radius: 8px !important;
                padding: 8px 12px !important;
                border: 1px solid #dee2e6;
                background: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 0;
            }

            .data-item.active {
                background-color: #0d6efd36 !important;
                color: #fff !important;

                .data-label {
                    color: #000 !important;
                }
            }

            .data-item.active i {
                color: #0d6efd !important;
            }

            .data-label {
                font-size: 0.85rem;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .data-description {
                display: none;
            }

            .data-content {
                overflow-y: visible;
                flex: none;
                height: auto;
            }
        }
    `],
})
export default class DataPageComponent extends BaseComponent {
    dataCategories = signal<DataCategory[]>([
        {
            id: 'export-data',
            label: 'Export Data',
            icon: 'fa-solid fa-file-export',
            route: '/admin/data/export-data',
            description: 'Export Firestore collections to JSON',
        },
        {
            id: 'import-data',
            label: 'Import Data',
            icon: 'fa-solid fa-file-import',
            route: '/admin/data/import-data',
            description: 'Import JSON data into Firestore',
        },
        {
            id: 'export-files',
            label: 'Export Files',
            icon: 'fa-solid fa-cloud-arrow-down',
            route: '/admin/data/export-files',
            description: 'Download files from Storage',
        },
        {
            id: 'import-files',
            label: 'Import Files',
            icon: 'fa-solid fa-cloud-arrow-up',
            route: '/admin/data/import-files',
            description: 'Upload files to Storage',
        },
    ]);
}
