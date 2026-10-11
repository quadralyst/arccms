import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, inject, signal, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
    MatDrawer,
    MatDrawerContainer,
    MatDrawerContent,
    MatDrawerMode,
    MatSidenavModule,
} from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterOutlet } from '@angular/router';
import { BaseComponent } from '../../shared/components/base/base.component';
import SideNavbarComponent from '../../shared/components/side-navbar/side-navbar.component';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { useAdminOverlay } from '../core/brand/admin-overlay';
import { SiteBrandService } from '../core/brand/site-brand';

@Component({
    standalone: true,
    imports: [
        RouterOutlet,
        MatDrawer,
        MatDrawerContainer,
        MatDrawerContent,
        SideNavbarComponent,
        MatIconModule,
        MatSidenavModule,
        MatToolbarModule,
        MatButtonModule,
        CommonModule,
        TranslocoPipe,
    ],
    templateUrl: './admin/admin.html',
    styles: [`
        :host {
            display: block;
            height: 100vh;
            width: 100vw;
        }
        
        .arc-admin {
            height: 100%;
        }
        
        .arc-main-page {
            height: 100vh;
        }
        
        /* The panel scrolls its menu itself (side-navbar), so the drawer around it never
           scrolls: two scrolling boxes would each give the other a scrollbar. */
        .arc-side-panel {
            height: 100%;
            overflow: hidden;
        }

        :host ::ng-deep .arc-side-panel > .mat-drawer-inner-container {
            overflow: hidden;
        }
        
        mat-drawer {
            height: 100%;
        }

        /* On a phone the menu bar stays at the top while the page scrolls; the page's own
           sticky bars sit below it (--arc-admin-sticky-top, src/styles.css). */
        .arc-admin.is-phone {
            --arc-admin-sticky-top: 48px;
        }

        .arc-mobile-bar {
            position: sticky;
            top: 0;
            z-index: 30;
            height: 48px;
            box-sizing: border-box;
            background-color: #fff;
            border-bottom: 1px solid #e9ecef;
            padding: 6px 12px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
        }

        .arc-mobile-bar span {
            font-weight: 600;
        }
    `]
})
export default class AdminComponent extends BaseComponent {
    isExpanded = true;
    /** 'over' on a phone. A signal, so a window crossing the width redraws the layout (there is no zone.js). */
    readonly drawerMode = signal<MatDrawerMode>('side');
    @ViewChild('drawer') drawer!: MatDrawer;
    breakpointObserver = inject(BreakpointObserver);
    /** The site's name for the mobile bar (core/brand/site-brand.ts). */
    readonly brandName = inject(SiteBrandService).name;

    constructor() {
        super();
        // The dialog layer takes the admin's colours while the admin is open.
        useAdminOverlay();
        this.breakpointObserver.observe('(max-width: 768px)').subscribe((state) => {
            this.drawerMode.set(state.matches ? 'over' : 'side');
        });
    }

    ngOnInit() {
        // Open until this browser has collapsed it.
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('isExpanded');
            if (stored !== null) this.isExpanded = stored === 'true';
        }
    }

    public toggleMenu() {
        // On a phone the panel slides over the page: this closes it, and the
        // choice of an open or collapsed panel on a wider screen stays as it was.
        if (this.drawerMode() === 'over') {
            this.drawer.toggle();
            return;
        }
        this.isExpanded = !this.isExpanded;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('isExpanded', this.isExpanded.toString());
        }
    }
}
