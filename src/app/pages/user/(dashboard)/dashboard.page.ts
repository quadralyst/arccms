import { RouteMeta } from '@analogjs/router';
import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { MatCardModule } from '@angular/material/card';
import { AuthState } from '../../(auth)/auth.store';
import { UserShellComponent } from '../user-shell.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { InstallPromptComponent } from '../../../../shared/components/install-prompt/install-prompt.component';
import { userGuard } from '../user.guards';

export const routeMeta: RouteMeta = {
    title: 'Dashboard | Arc CMS',
    canActivate: [userGuard],
};

/**
 * The member's home, /user/dashboard: a greeting and nothing else, for every app.
 * An app shows its own page here through src/custom/user-dashboard.ts
 * (docs/custom-code.md); payments has its own page, /user/payments.
 */
@Component({
    selector: 'arc-user-dashboard',
    standalone: true,
    imports: [MatCardModule, UserShellComponent, PageHeaderComponent, InstallPromptComponent, TranslocoPipe],
    template: `
        <app-user-shell>
            <div class="dash">
                <arc-page-header [title]="'user.dashboard.welcome' | transloco: { name: firstName() }"></arc-page-header>

                <!-- Shows only where the app can be installed and is not yet (docs/pwa.md) -->
                <arc-install-prompt class="d-block mb-3" />

                <mat-card class="empty">
                    <mat-card-content>
                        <p class="text-muted mb-0">{{ 'user.dashboard.empty' | transloco }}</p>
                    </mat-card-content>
                </mat-card>
            </div>
        </app-user-shell>
    `,
    styles: [`
        .dash { padding: 24px; max-width: 960px; }
        .empty { padding: 24px; text-align: center; }
    `],
})
export default class UserDashboardComponent {
    private authState = inject(AuthState);

    firstName = computed(() => {
        const u = this.authState.currentUser();
        return (u?.name || u?.email || 'there').split(' ')[0].split('@')[0];
    });
}
