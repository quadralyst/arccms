/**
 * Broadcast Email Store
 * NgRx Signal store for managing broadcast email state
 */

import { Injectable } from '@angular/core';
import { createGenericStore } from '../../../services/generic-store.service';
import { IBroadcastEmail } from './send-broadcast-email.model';
import { BroadcastEmailService } from './send-broadcast-email.service';

const BroadcastEmailStoreBase = createGenericStore<IBroadcastEmail>(BroadcastEmailService);

@Injectable({ providedIn: 'root' })
export class BroadcastEmailStore extends BroadcastEmailStoreBase {
    // Add any broadcast-specific methods or computed properties here
}
