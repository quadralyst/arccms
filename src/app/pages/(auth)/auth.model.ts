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
    /**
     * The admin UI language this person reads (M-D11). Independent of the
     * languages the site publishes in — see core/i18n/admin-language.service.ts.
     */
    preferredLanguage?: string;
}

export const COMPONENT_NAME: string = 'Auth';
