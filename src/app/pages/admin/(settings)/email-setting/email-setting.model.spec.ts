import { describe, it, expect } from 'vitest';
import { DEFAULT_EMAIL_SETTINGS, suggestedSender } from './email-setting.model';

describe('the name emails come from', () => {
    const site = { name: 'Acme Studio', arc: false };
    const arc = { name: 'Arc CMS', arc: true };

    it('is not Arc CMS by default: an app is not', () => {
        expect(DEFAULT_EMAIL_SETTINGS.senderName).toBe('');
    });

    it('offers the site\'s own name for a blank field', () => {
        expect(suggestedSender('', site)).toBe('Acme Studio');
        expect(suggestedSender(undefined, site)).toBe('Acme Studio');
    });

    it('offers it for the old default too, on a site with a name of its own', () => {
        expect(suggestedSender('Arc CMS', site)).toBe('Acme Studio');
    });

    it('offers nothing beside a name someone chose', () => {
        expect(suggestedSender('Team Acme', site)).toBe('');
    });

    it('offers nothing on a site with no name of its own, or before the name is in', () => {
        expect(suggestedSender('', arc)).toBe('');
        expect(suggestedSender('Arc CMS', arc)).toBe('');
        expect(suggestedSender('', null)).toBe('');
    });
});
