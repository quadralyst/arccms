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

    /**
     * Role, block and delete go through the server (functions/src/users/adminUserAccess.ts),
     * which refuses to leave the site without an active admin. The rules refuse these
     * writes from the browser, an admin's too.
     */
    async setRole(id: string, role: string): Promise<{ role: string; changed: boolean }> {
        return (await arcCallable<{ id: string; role: string }, { role: string; changed: boolean }>(this.functions, 'adminSetUserRole')({ id, role })).data;
    }

    async setBlocked(id: string, blocked: boolean): Promise<{ blocked: boolean }> {
        return (await arcCallable<{ id: string; blocked: boolean }, { blocked: boolean }>(this.functions, 'adminSetUserBlocked')({ id, blocked })).data;
    }

    /** Deletes the record; the server then removes the rest (functions/src/users/onUserDelete.ts). */
    async deleteUser(id: string): Promise<{ deleted: boolean }> {
        return (await arcCallable<{ id: string }, { deleted: boolean }>(this.functions, 'adminDeleteUser')({ id })).data;
    }

    /** A member's new phone number, proved by a code at their next phone sign-in (functions/src/users/adminSetPhone.ts). */
    async setPhone(id: string, phone: string): Promise<{ updated: boolean; phone: string }> {
        return (await arcCallable<{ id: string; phone: string }, { updated: boolean; phone: string }>(this.functions, 'adminSetPhone')({ id, phone })).data;
    }

    /** Give every record made before Arc CMS recorded how a `by` (functions/src/users/fillAccountSources.ts). */
    async fillAccountSources(): Promise<{ filled: number; total: number }> {
        const result = await arcCallable<Record<string, never>, { filled: number; total: number }>(this.functions, 'fillAccountSources')({});
        return result.data;
    }
}
