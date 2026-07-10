import { Injectable } from '@angular/core';
import { DbService } from '../../../shared/services/db.service';
import { IUser } from '../admin/users/user.model';

/**
 * Reads the current user's `users/{uid}` document (including the Cloud-Function-
 * written entitlement fields: isPro, premiumType, premiumStatus, premiumExpiresAt,
 * updatesUntil, …). Used by the public account / checkout-success screens to show
 * the result of a payment. Firestore rules allow a user to read their own doc.
 */
@Injectable({
    providedIn: 'root',
    useFactory: () => new MembershipService(),
    deps: [],
})
export class MembershipService extends DbService<IUser> {
    constructor() {
        super('users');
    }
}
