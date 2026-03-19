/**
 * Auth Model
 * 
 * Defines the structure for authenticated user data.
 */

import { IBaseModel } from '../../../shared/models/base-model';

export interface IAuth extends IBaseModel {
    id: string;
    email: string;
    name: string;
    password?: string;
    emailVerified: boolean;
    role?: string;
    photo?: string;
    status: string; // Active, Disable, Pending
    uid: string;
    isActive: boolean;
}

export const COMPONENT_NAME: string = 'Auth';
