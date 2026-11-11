import { inject, Injector } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { from, switchMap } from 'rxjs';
import { AuthState } from '../pages/(auth)/auth.store';

/** A page with work that may not be stored yet, such as the content editor. */
export interface HasUnsavedChanges {
    hasUnsavedChanges(): boolean;
}

/**
 * Asks before a route change leaves a page with unsaved work: a link, Close,
 * the browser's back button, Sign out (specs/dev-review-fixes-spec.md, RF4 4.2). Closing
 * or reloading the tab is the page's own `beforeunload`, which the browser
 * answers with its own question. The question itself (unsaved-changes-dialog.ts)
 * loads only when there is something to ask, so the first script stays small.
 */
export const unsavedChangesGuard: CanDeactivateFn<unknown> = (component) => {
    if (!(component as Partial<HasUnsavedChanges> | null)?.hasUnsavedChanges?.()) return true;
    // Signed out already (a blocked account is signed out by the app): the
    // work cannot be saved any more, so there is nothing to stay for.
    if (!inject(AuthState).currentUser()) return true;
    const injector = inject(Injector);
    return from(import('./unsaved-changes-dialog')).pipe(switchMap(({ askToLeave }) => askToLeave(injector)));
};
