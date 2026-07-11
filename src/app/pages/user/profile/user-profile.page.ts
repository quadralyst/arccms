import { Component } from '@angular/core';
import { UserShellComponent } from '../user-shell.component';
import ProfileComponent from '../../(auth)/(profile)/profile.page';

/**
 * Renders the existing profile form (name / email / password / photo) inside the
 * member sidebar shell, so /user/profile lives in the user area instead of the
 * admin shell. Reuses <arc-profile> unchanged.
 */
@Component({
    standalone: true,
    imports: [UserShellComponent, ProfileComponent],
    template: `
        <app-user-shell>
            <div class="profile-wrap">
                <h1>Profile</h1>
                <p class="text-muted">Manage your name, email, password and photo.</p>
                <arc-profile></arc-profile>
            </div>
        </app-user-shell>
    `,
    styles: [`
        .profile-wrap { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
        .profile-wrap h1 { margin-bottom: 2px; }
    `],
})
export default class UserProfilePageComponent {}
