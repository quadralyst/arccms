/**
 * User Store
 * 
 * NgRx Signals store for managing user data.
 * Uses the generic store factory with UserService.
 */

import { Injectable } from '@angular/core';
import { createGenericStore } from '../../../../shared/services/generic-store.service';
import { IUser } from './user.model';
import { UserService } from './user.service';

const UserStoreBase = createGenericStore<IUser>(UserService);

@Injectable({ providedIn: 'root' })
export class UserStore extends UserStoreBase {
    // Add any user-specific methods or computed properties here
}
