/**
 * Base Model Interface
 * 
 * Common fields shared across all Firestore documents.
 */

export interface IBaseModel {
    id: string;
    createdBy: string;
    createdAt: Date;
    modifiedBy: string;
    modifiedAt: Date;
}

export type OmitCommonFields<T> = Omit<T, keyof IBaseModel>;

export function generateCommonFields(userId: string): Omit<IBaseModel, 'id'> {
    const now = new Date();
    return {
        createdBy: userId,
        createdAt: now,
        modifiedBy: userId,
        modifiedAt: now,
    };
}

export function updateCommonFields(userId: string): Pick<IBaseModel, 'modifiedBy' | 'modifiedAt'> {
    return {
        modifiedBy: userId,
        modifiedAt: new Date(),
    };
}
