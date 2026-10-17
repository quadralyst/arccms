import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UserShellComponent } from '../user-shell.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import ProfileComponent from '../../(auth)/(profile)/profile.page';

/**
 * Renders the existing profile form (name / email / password / photo) inside the
 * member sidebar shell, so /user/profile lives in the user area instead of the
 * admin shell. Reuses <arc-profile>, minus its own heading and Back button: the page
 * header above it is the one heading (with the bell), and the menu is the way back.
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
        /* <arc-profile> draws its own heading, Back button and padding for the page it also serves alone; here the page header above it is the heading. */
        .profile-wrap ::ng-deep .profile-header { display: none; }
        .profile-wrap ::ng-deep .profile-container { padding: 0; }
        @media (max-width: 768px) {
            .profile-wrap { padding: 12px; }
        }
    `],
})
export default class UserProfilePageComponent {}
