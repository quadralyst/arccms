export interface INotification {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string;
    icon?: string;
    read: boolean;
    createdAt?: { seconds: number; nanoseconds: number } | Date;
    emailDelivery?: { requested: boolean; emailLogId?: string; skippedReason?: string };
}

export interface INotificationTypeConfig {
    label: string;
    description: string;
    category: 'transactional' | 'marketing';
    defaultChannels: { inApp: boolean; email: boolean };
    userConfigurable: boolean;
    emailTemplateType?: string;
    enabled: boolean;
}
