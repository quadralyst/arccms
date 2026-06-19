import { Injectable } from '@angular/core';
import { DbService } from '../../../../shared/services/db.service';
import { ITransaction, TRANSACTIONS_COLLECTION } from './transaction.model';

@Injectable({
    providedIn: 'root',
    useFactory: () => new TransactionsService(),
    deps: [],
})
export class TransactionsService extends DbService<ITransaction> {
    constructor() {
        super(TRANSACTIONS_COLLECTION);
    }
}
