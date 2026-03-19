import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, inject, ViewChild } from '@angular/core';
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
        MatIconModule,
        CommonModule
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
        
        .arc-side-panel {
            height: 100%;
        }
        
        mat-drawer {
            height: 100%;
        }
    `]
})
export default class AdminComponent extends BaseComponent {
    isExpanded = true;
    drawerMode: MatDrawerMode = 'side';
    @ViewChild('drawer') drawer!: MatDrawer;
    breakpointObserver = inject(BreakpointObserver);

    constructor() {
        super();
        this.breakpointObserver.observe('(max-width: 768px)').subscribe((state: any) => {
            if (state.matches) {
                this.drawerMode = 'over';
            } else {
                this.drawerMode = 'side';
            }
        });
    }

    ngOnInit() {
        if (typeof localStorage !== 'undefined') {
            this.isExpanded = localStorage.getItem('isExpanded') === 'true';
        }
    }

    public toggleMenu() {
        if (this.drawerMode === 'over') {
            this.drawer.toggle();
        }
        this.isExpanded = !this.isExpanded;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('isExpanded', this.isExpanded.toString());
        }
    }
}
