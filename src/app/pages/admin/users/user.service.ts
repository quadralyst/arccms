/**
 * User Service
 * 
 * Service for managing user data in Firestore.
 * Extends DbService to provide CRUD operations for users.
 */

import { Injectable } from '@angular/core';
import { DbService } from '../../../../shared/services/db.service';
import { IUser } from './user.model';

@Injectable({
    providedIn: 'root',
})
export class UserService extends DbService<IUser> {
    constructor() {
        super('users');
    }
}
