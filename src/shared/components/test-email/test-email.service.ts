/**
 * Test Email Service
 * Service for managing test email operations in Firestore
 */

import { Injectable } from '@angular/core';
import { DbService } from '../../services/db.service';
import { ITestEmail, TEST_EMAIL_COLLECTION } from './test-email.model';

@Injectable({
    providedIn: 'root',
    useFactory: () => new TestEmailService(),
    deps: []
})
export class TestEmailService extends DbService<ITestEmail> {
    constructor() {
        super(TEST_EMAIL_COLLECTION);
    }
}
