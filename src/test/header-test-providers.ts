import { of } from 'rxjs';
import { AuthState } from '../app/pages/(auth)/auth.store';
import { NotificationService } from '../shared/services/notification.service';
import { SearchService } from '../app/core/services/search.service';

/**
 * The shared <arc-page-header> embeds the notification bell, which needs
 * NotificationService (a Firestore + Functions realtime feed) and AuthState.
 * Page specs that render a page component now pull these in.
 *
 * Mocking NotificationService here means the bell never touches Firebase, even
 * when a spec's own AuthState reports a signed-in user (which would otherwise
 * trigger a live `watch()` subscription against a stub Firestore and throw).
 *
 * SPREAD THESE FIRST in a spec's providers array so any provider the spec
 * declares for the same token still wins (last provider in the array wins):
 *
 *   providers: [ ...headerTestProviders(), ...myOwnProviders ]
 */
export function headerTestProviders() {
    return [
        {
            provide: NotificationService,
            useValue: {
                watch: () => of([]),
                markRead: () => Promise.resolve(),
                markAllRead: () => Promise.resolve(),
            },
        },
        { provide: AuthState, useValue: { currentUser: () => null, isAdmin: () => false } },
        // The header's admin search box (rendered when isAdmin() is true)
        // calls the `search` callable through this service.
        {
            provide: SearchService,
            useValue: {
                isSearchable: (q: string) => q.trim().length >= 2,
                search: () => Promise.resolve({ results: [], tookMs: 0 }),
                reindex: () => Promise.resolve([]),
                clearCache: () => undefined,
            },
        },
    ];
}
