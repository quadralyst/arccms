import { IBaseModel } from '../../../../shared/models/base-model';

export const TRANSACTIONS_COLLECTION = 'Transactions';

export type PaymentProvider = 'dodo' | 'stripe' | 'razorpay';

export interface ITransaction extends IBaseModel {
    userId: string;
    userEmail: string;
    provider?: PaymentProvider;
    providerPaymentId?: string;
    providerSubscriptionId?: string;
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
