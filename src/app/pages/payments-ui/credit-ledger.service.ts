import { Injectable } from '@angular/core';
import { DbService } from '../../../shared/services/db.service';
import { CREDIT_LEDGER_COLLECTION, ICreditLedgerEntry } from './credit-ledger.model';

/**
 * Reads a user's own prepaid-credit ledger entries. Firestore rules allow an
 * owner to read entries where `userId == their uid`; writes are Cloud Function /
 * callable only.
 */
@Injectable({
    providedIn: 'root',
    useFactory: () => new CreditLedgerService(),
    deps: [],
})
export class CreditLedgerService extends DbService<ICreditLedgerEntry> {
    constructor() {
        super(CREDIT_LEDGER_COLLECTION);
    }
}
