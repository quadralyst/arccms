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
    /**
     * Charge from an admin "test this tier" checkout. Real at the gateway, but it
     * granted no access or credits and never counted toward a product's
     * purchase count. Absent on genuine customer transactions.
     */
    isTest?: boolean;
}
