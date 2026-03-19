/**
 * Broadcast Email Service
 * Service for managing broadcast email operations in Firestore
 */

import { Injectable } from '@angular/core';
import { COLLECTION_NAME, DbService } from '../../../services/db.service';
import { BROADCAST_EMAIL_COLLECTION, IBroadcastEmail } from './send-broadcast-email.model';

@Injectable({
    providedIn: 'root',
    useFactory: () => new BroadcastEmailService(),
    deps: []
})
export class BroadcastEmailService extends DbService<IBroadcastEmail> {
    constructor() {
        super(BROADCAST_EMAIL_COLLECTION);
    }
}
