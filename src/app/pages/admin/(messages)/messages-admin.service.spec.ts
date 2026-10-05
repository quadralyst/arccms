/**
 * The admin Messages inbox (specs/site-sections-spec.md, SS5).
 */
import { describe, it, expect } from 'vitest';
import { Timestamp } from '@angular/fire/firestore';
import { replyLink, toContactMessage } from './messages-admin.service';

describe('messages inbox', () => {
    it('reads a message as the inbox shows it, malformed fields as empty', () => {
        const when = Timestamp.fromDate(new Date('2026-10-05T10:00:00Z'));
        expect(toContactMessage('m1', {
            name: 'Asha', email: 'asha@example.com', message: 'Hello', subject: 42, page: 'https://evil.example', status: 'spam', createdAt: when,
        })).toEqual({
            id: 'm1', name: 'Asha', email: 'asha@example.com', phone: '', subject: '', message: 'Hello',
            page: '', status: 'spam', createdAt: when.toDate(),
        });
        expect(toContactMessage('m2', { status: 'archived', page: '/info/contact' })).toMatchObject({ status: 'new', page: '/info/contact', createdAt: null });
    });

    it('replies in the admin\'s email client, with the subject and the message quoted', () => {
        const item = toContactMessage('m1', { email: 'asha+site@example.com', subject: 'Delivery to Pune', message: 'Do you deliver?\nThanks' });
        const link = replyLink(item);
        expect(link.startsWith('mailto:asha%2Bsite@example.com?')).toBe(true);
        const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
        expect(params.get('subject')).toBe('Re: Delivery to Pune');
        expect(params.get('body')).toBe('\n\n> Do you deliver?\n> Thanks');
        expect(link).not.toContain('+');
    });

    it('uses the start of the message as the topic when there is no subject', () => {
        const link = replyLink(toContactMessage('m1', { email: 'a@b.c', message: 'Can I   return\nit?' }));
        expect(new URLSearchParams(link.slice(link.indexOf('?') + 1)).get('subject')).toBe('Re: Can I return it?');
    });
});
