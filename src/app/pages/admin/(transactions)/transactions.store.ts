import { createGenericStore } from '../../../../shared/services/generic-store.service';
import { ITransaction } from './transaction.model';
import { TransactionsService } from './transactions.service';

export const TransactionsStore = createGenericStore<ITransaction>(TransactionsService, {
    limit: 50,
    sortField: 'createdAt',
    order: 'desc',
});
