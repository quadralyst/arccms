import { RouteMeta } from '@analogjs/router';
import { AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { catchError, map, of } from 'rxjs';

export const routeMeta: RouteMeta = {
    title: 'Unauthorized',
    data: { titleKey: 'member.titles.unauthorized' },
};

/** What shows when /403.html cannot be read: the same message, in the person's language. */
export function fallbackHtml(t: (key: string) => string): string {
    return `<div class="container p-5 text-center"><h1>${t('member.unauthorized.heading')}</h1><p>${t('member.unauthorized.description')}</p><a href="/signup">${t('member.unauthorized.sign_up')}</a></div>`;
}

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
    private transloco = inject(TranslocoService);

    pageContent$ = this.http.get('/403.html', { responseType: 'text' }).pipe(
        map((html) => this.sanitizer.bypassSecurityTrustHtml(html)),
        catchError((err) => {
            console.error('Failed to load unauthorized template', err);
            return of(this.sanitizer.bypassSecurityTrustHtml(fallbackHtml((key) => this.transloco.translate(key))));
        }),
    );
}
