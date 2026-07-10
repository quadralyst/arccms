import { IBaseModel } from '../../../shared/models/base-model';

export const CREDIT_LEDGER_COLLECTION = 'CreditLedger';

export type CreditLedgerReason = 'purchase' | 'renewal' | 'refund' | 'consume' | 'adjustment';

/** Append-only prepaid-credit ledger entry (mirror of the backend CreditLedgerDoc). */
export interface ICreditLedgerEntry extends IBaseModel {
    userId: string;
    delta: number;
    reason: CreditLedgerReason;
    balanceAfter: number;
    productId?: string;
    dodoPaymentId?: string;
    dodoSubscriptionId?: string;
    note?: string;
}
