import { Type } from '@angular/core';
import { EmailProvider } from '../email-setting.model';
import { IEmailProviderComponent } from './email-provider-base';
import { GmailProviderComponent } from './gmail-provider.component';
import { ResendProviderComponent } from './resend-provider.component';
import { SmtpProviderComponent } from './smtp-provider.component';
import { DebugProviderComponent } from './debug-provider.component';

/**
 * Maps each email provider ID to its Angular component.
 * To add a new provider, add one entry here and create the component.
 */
export const PROVIDER_COMPONENT_MAP: Record<EmailProvider, Type<IEmailProviderComponent>> = {
    smtp: SmtpProviderComponent as unknown as Type<IEmailProviderComponent>,
    gmail: GmailProviderComponent as unknown as Type<IEmailProviderComponent>,
    resend: ResendProviderComponent as unknown as Type<IEmailProviderComponent>,
    debug_log: DebugProviderComponent as unknown as Type<IEmailProviderComponent>,
};
