import { RouteMeta } from '@analogjs/router';
import { AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { catchError, map, of } from 'rxjs';

export const routeMeta: RouteMeta = {
    title: 'Unauthorized | Arc CMS',
};

const FALLBACK_HTML =
    '<div class="container p-5 text-center"><h1>403 - Forbidden</h1><p>Access Denied</p><a href="/signup">Go to Signup</a></div>';

@Component({
    selector: 'app-unauthorized',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AsyncPipe],
    template: `
    <div [innerHTML]="pageContent$ | async"></div>
  `,
})
export default class UnauthorizedComponent {
    private http = inject(HttpClient);
    private sanitizer = inject(DomSanitizer);

    pageContent$ = this.http.get('/403.html', { responseType: 'text' }).pipe(
        map((html) => this.sanitizer.bypassSecurityTrustHtml(html)),
        catchError((err) => {
            console.error('Failed to load unauthorized template', err);
            return of(this.sanitizer.bypassSecurityTrustHtml(FALLBACK_HTML));
        }),
    );
}
