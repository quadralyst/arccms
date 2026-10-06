/**
 * User Service
 * 
 * Service for managing user data in Firestore.
 * Extends DbService to provide CRUD operations for users.
 */

import { inject, Injectable } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { DbService } from '../../../../shared/services/db.service';
import { arcCallable } from '../../../core/config/arc-functions';
import { accountKindConditions, AccountKind, IUser } from './user.model';

@Injectable({
    providedIn: 'root',
})
export class UserService extends DbService<IUser> {
    private functions = inject(Functions);

    constructor() {
        super('users');
    }

    /** How many records there are of each kind, to tell whether some have no `by` yet. */
    async countByKind(): Promise<Record<AccountKind, number>> {
        const count = (kind: AccountKind) =>
            firstValueFrom(this.getCollectionTotalCount({ whereConditions: accountKindConditions(kind), limitCount: 0, currentPageNumber: 0, previousPageNumber: 0 }));
        const [all, people, app] = await Promise.all([count('all'), count('people'), count('app')]);
        return { all, people, app };
    }

    /** Give every record made before Arc CMS recorded how a `by` (functions/src/users/fillAccountSources.ts). */
    async fillAccountSources(): Promise<{ filled: number; total: number }> {
        const result = await arcCallable<Record<string, never>, { filled: number; total: number }>(this.functions, 'fillAccountSources')({});
        return result.data;
    }
}
