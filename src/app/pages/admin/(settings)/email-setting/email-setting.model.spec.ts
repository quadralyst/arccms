import { describe, it, expect } from 'vitest';
import { DEFAULT_EMAIL_SETTINGS, senderNameFor } from './email-setting.model';

describe('the name emails come from', () => {
    const site = { name: 'Acme Studio', arc: false };
    const arc = { name: 'Arc CMS', arc: true };

    it('is not Arc CMS by default: an app is not', () => {
        expect(DEFAULT_EMAIL_SETTINGS.senderName).toBe('');
    });

    it('keeps the name someone saved', () => {
        expect(senderNameFor('Team Acme', site)).toBe('Team Acme');
    });

    it('starts from the site\'s own name', () => {
        expect(senderNameFor('', site)).toBe('Acme Studio');
        expect(senderNameFor(undefined, site)).toBe('Acme Studio');
    });

    it('does not take the old default for a choice, on a site with a name of its own', () => {
        expect(senderNameFor('Arc CMS', site)).toBe('Acme Studio');
    });

    it('leaves a site with no name of its own alone', () => {
        expect(senderNameFor('', arc)).toBe('');
        expect(senderNameFor('Arc CMS', arc)).toBe('Arc CMS');
        expect(senderNameFor('', null)).toBe('');
    });
});
