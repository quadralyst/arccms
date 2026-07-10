import { IBaseModel } from '../../../../shared/models/base-model';

export const TRANSACTIONS_COLLECTION = 'Transactions';

export interface ITransaction extends IBaseModel {
    userId: string;
    userEmail: string;
    dodoPaymentId?: string;
    dodoSubscriptionId?: string;
    productId: string;
    premiumType: string;
    amount: number;
    currency: string;
    status: 'succeeded' | 'failed' | 'refunded' | 'pending';
    type: 'one_time' | 'subscription';
    tierApplied?: string;
    discountCode?: string;
    eventType: string;
}
