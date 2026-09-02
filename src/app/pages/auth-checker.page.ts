import { RouteMeta } from '@analogjs/router';
import { Component, inject, OnInit } from '@angular/core';
import { canActivate, redirectUnauthorizedTo } from '@angular/fire/auth-guard';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { ConstantVariables } from '../../shared/constants';
import { LoadingComponent } from '../../shared/components/loading/loading.component';
import { AuthState } from './(auth)/auth.store';
import { OnboardingSetupService } from './(onboarding)/onboarding-setup.service';

export const routeMeta: RouteMeta = {
    title: 'Authenticating... | Arc CMS',
    ...canActivate(() => redirectUnauthorizedTo(['/'])),
};

@Component({
    selector: 'arc-auth-checker',
    standalone: true,
    imports: [LoadingComponent],
    template: `<arc-loading [isLoading]="isLoading"></arc-loading>`,
})
export default class AuthCheckerComponent implements OnInit {
    authStore = inject(AuthState);
    private setupService = inject(OnboardingSetupService);
    constantVariables = inject(ConstantVariables);
    router = inject(Router);
    isLoading = true;

    ngOnInit() {
        this.isLoading = true;

        // Debug mode: bypass onboarding redirect for deployment verification
        if (new URLSearchParams(window.location.search).has('debug')) {
            this.isLoading = false;
            return;
        }

        // Send first-run and abandoned-wizard installs to onboarding before
        // role-based routing.
        this.setupService.shouldShowOnboarding().pipe(take(1)).subscribe((showOnboarding) => {
            if (showOnboarding) {
                this.router.navigate(['/onboarding']);
                this.isLoading = false;
                return;
            }

            this.authStore.initAuthStateListener().subscribe((res: any) => {
                if (res?.role === this.constantVariables.ADMIN) {
                    this.router.navigate(['/admin/dashboard']);
                } else {
                    this.router.navigate(['/signup']);
                }
                this.isLoading = false;
            });
        });
    }
}
