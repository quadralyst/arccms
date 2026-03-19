/**
 * Test Email Store
 * NgRx Signal store for managing test email state
 */

import { Injectable } from '@angular/core';
import { createGenericStore } from '../../services/generic-store.service';
import { ITestEmail } from './test-email.model';
import { TestEmailService } from './test-email.service';

const TestEmailStoreBase = createGenericStore<ITestEmail>(TestEmailService);

@Injectable({ providedIn: 'root' })
export class TestEmailStore extends TestEmailStoreBase {
    // Add any test-email-specific methods or computed properties here
}
