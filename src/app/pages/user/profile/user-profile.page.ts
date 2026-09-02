import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UserShellComponent } from '../user-shell.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import ProfileComponent from '../../(auth)/(profile)/profile.page';

/**
 * Renders the existing profile form (name / email / password / photo) inside the
 * member sidebar shell, so /user/profile lives in the user area instead of the
 * admin shell. Reuses <arc-profile> unchanged.
 */
@Component({
    standalone: true,
    imports: [UserShellComponent, ProfileComponent, PageHeaderComponent, TranslocoPipe],
    template: `
        <app-user-shell>
            <div class="profile-wrap">
                <arc-page-header [title]="'user.profile.title' | transloco" [subtitle]="'user.profile.subtitle' | transloco"></arc-page-header>
                <arc-profile></arc-profile>
            </div>
        </app-user-shell>
    `,
    styles: [`
        .profile-wrap { max-width: 900px; margin: 0 auto; padding: 24px; }
        .profile-wrap h1 { margin-bottom: 2px; }
    `],
})
export default class UserProfilePageComponent {}
