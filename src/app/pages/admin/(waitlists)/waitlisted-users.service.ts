/**
 * Waitlisted Users Service
 * 
 * Lightweight service for efficient count queries on WaitlistedUsers collection.
 * Extends DbService to use getCollectionTotalCount for dashboard metrics.
 */

import { Injectable } from '@angular/core';
import { DbService } from '../../../../shared/services/db.service';
import { IWaitlistUser } from '../../waitlist/waitlist.model';

@Injectable({
    providedIn: 'root',
})
export class WaitlistedUsersService extends DbService<IWaitlistUser> {
    constructor() {
        super('WaitlistedUsers');
    }
}
