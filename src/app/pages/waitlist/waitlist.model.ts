/**
 * Waitlist Model Interfaces
 * 
 * Core interfaces for the waitlist feature including:
 * - Waitlist configuration
 * - Waitlist users
 * - OTP verification
 */

import { IBaseModel, OmitCommonFields } from '../../../shared/models/base-model';
import { ISignupMetadata } from './signup-metadata.model';

/**
 * Step types for the waitlist form wizard
 */
export type StepType = 'signup' | 'verify' | 'success' | 'existing-user' | 'error';

/**
 * UI configuration for waitlist appearance
 */
export interface IWaitlistUiConfig {
    title: string;
    description: string;
    buttonText: string;
    theme: 'light' | 'dark';
    width: string;
    maxWidth: string;
}

/**
 * Waitlist configuration interface
 */
export interface IWaitlist extends IBaseModel {
    slug: string;
    name: string;
    description?: string;
    coverImage?: string;
    isActive: boolean;
    otpEnabled?: boolean;
    disabledMessage?: string;
    totalSignups: number;
    isFormRequired?: boolean;
    fields?: string[];
    formHtml?: string;
    fieldsVersion?: number;
    uiConfig: IWaitlistUiConfig;
    defaultTagId?: string;
    /**
     * Lists this form feeds (U3). Always includes its own `waitlist-{id}` system
     * list; may add manual lists so several forms can feed one audience. Absent
     * on pre-U3 forms — the backend falls back to `[waitlist-{id}]`.
     */
    targetListIds?: string[];
}

/**
 * Form data collected from dynamic forms
 */
export interface IWaitlistFormData {
    email: string;
    firstName: string;
    phone?: string;
    company?: string;
    message?: string;
    [key: string]: string | undefined;
}

/**
 * User in a waitlist
 */
export interface IWaitlistUser extends IBaseModel {
    email: string;
    firstName: string;
    source?: string;
    formData?: IWaitlistFormData;
    signupTimestamp: Date;
    emailVerified: boolean;
    isConfirmed: boolean;
    verificationCode: string;
    verificationExpires: Date;
    verifiedAt?: Date;
    waitlistedUserId: string;
    ipAddress?: string;
    isSubscribed: boolean;
    waitlistId: string;
    waitlistIds?: string[];
    signupMetadata?: ISignupMetadata;
}

/**
 * Result from joining a waitlist
 */
export interface IJoinWaitlistResult {
    exists: boolean;
    verified?: boolean;
    userData?: IWaitlistUser;
    userId?: string;
    email?: string;
    verificationCode?: string;
}

/**
 * Form field for dynamic form parsing
 */
export interface IFormField {
    name: string;
    variableName: string[];
}

/**
 * Form field parsing result
 */
export interface IFormFieldParsingResult {
    success: boolean;
    fields: IFormField[];
    error?: string;
}

export type WaitlistFormData = OmitCommonFields<IWaitlist>;

export const COMPONENT_NAME = 'Waitlist';

/**
 * Default UI configuration
 */
export const DEFAULT_UI_CONFIG: IWaitlistUiConfig = {
    title: 'Join the Waitlist',
    description: 'Be the first to know when we launch',
    buttonText: 'Join Waitlist',
    theme: 'light',
    width: '100%',
    maxWidth: '400px',
};

/**
 * OTP expiration time in minutes
 */
export const OTP_EXPIRATION_MINUTES = 15;
