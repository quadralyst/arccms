/**
 * User Model
 * 
 * Defines the structure for user data in the application.
 */

import { UserRole, UserStatus } from '../../../../shared/components/base/base.component';
import { IBaseModel, OmitCommonFields } from '../../../../shared/models/base-model';

export interface IUser extends IBaseModel {
    email: string;
    name: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    emailVerified: boolean;
    photo?: string;
    status: UserStatus;
    role: UserRole;
    isActive: boolean;
    uid: string;
    isOnBoardingComplete?: boolean;
    updatedAt?: Date;
}

export type UserFormData = OmitCommonFields<IUser>;

export const COMPONENT_NAME: string = 'Users';
