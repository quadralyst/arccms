import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthState } from '../(auth)/auth.store';
import { homeFor } from '../../core/home/home';

export const routeMeta: RouteMeta = {
    title: 'Unauthorized',
    data: { titleKey: 'member.titles.unauthorized' },
};

/**
 * What someone sees without permission for a page, in their language. The way back fits
 * who is looking: signed in, their own home (src/custom/home.ts, else the member
 * dashboard); signed out, the sign-in page. public/403.html is the plain page the
 * hosting serves for a 403 and cannot know either.
 */
@Component({
    selector: 'app-unauthorized',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, TranslocoPipe],
    template: `
        <div class="denied">
            <h1>{{ 'member.unauthorized.heading' | transloco }}</h1>
            <p>{{ 'member.unauthorized.description' | transloco }}</p>
            @if (home(); as path) {
                <a class="btn btn-primary" [routerLink]="path">{{ 'member.unauthorized.go_home' | transloco }}</a>
            } @else {
                <a class="btn btn-primary" routerLink="/signup">{{ 'member.unauthorized.sign_in' | transloco }}</a>
            }
        </div>
    `,
    styles: [`
        /* The side margin keeps the button off a phone's edges. */
        .denied { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px 16px; box-sizing: border-box; }
        .denied h1 { font-size: clamp(1.75rem, 8vw, 3rem); font-weight: 700; }
        .denied p { margin-bottom: 1.5rem; }
    `],
})
export default class UnauthorizedComponent {
    private authState = inject(AuthState);

    /** Where a signed-in person goes from here; null when nobody is signed in. */
    readonly home = computed(() => {
        const user = this.authState.currentUser();
        return user ? homeFor(user.role) : null;
    });
}
