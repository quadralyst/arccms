import { describe, it, expect } from 'vitest';
import { availableEvents, draftProblems, draftToMapping, emptyRule, eventInfo, mappingToDraft } from './automation-model';

describe('automation model (CO6.5d)', () => {
    it('offers built-in events, app-user events per watched field when connected, and anything already mapped', () => {
        const types = (o: Parameters<typeof availableEvents>[0]) => availableEvents(o).map((e) => e.type);
        expect(types({ appConnected: false, watchedFields: ['isPro'], mapped: [] }))
            .toEqual(['user.signed_up', 'payment.succeeded', 'payment.failed', 'waitlist.joined']);
        expect(types({ appConnected: true, watchedFields: ['isPro'], mapped: ['custom.thing', 'user.signed_up'] })).toEqual([
            'user.signed_up', 'payment.succeeded', 'payment.failed', 'waitlist.joined',
            'app_user.created', 'app_user.changed.isPro', 'app_user.deleted', 'custom.thing',
        ]);
        expect(eventInfo('app_user.changed.plan.tier')).toEqual({ type: 'app_user.changed.plan.tier', appUser: true, field: 'plan.tier' });
        expect(eventInfo('user.signed_up')).toEqual({ type: 'user.signed_up', appUser: false });
    });

    it('leaves out the events of features that are off, even when mapped', () => {
        const types = availableEvents({
            appConnected: true,
            watchedFields: ['isPro'],
            mapped: ['payment.succeeded', 'custom.thing'],
            on: (id) => id !== 'payments' && id !== 'audience',
        }).map((e) => e.type);
        expect(types).toEqual(['user.signed_up', 'waitlist.joined', 'custom.thing']);
    });

    it('reads the older one-set-of-actions shape as a first rule without conditions', () => {
        const d = mappingToDraft('user.signed_up', { enabled: false, addToLists: ['all-users'] });
        expect(d.enabled).toBe(false);
        expect(d.rules).toHaveLength(1);
        expect(d.rules[0]).toMatchObject({ name: 'Default', addToLists: ['all-users'], fromKind: 'any', toKind: 'any' });
    });

    it('round-trips the upgrade and downgrade rules', () => {
        const saved = {
            enabled: true,
            rules: [
                { name: 'Upgraded', when: { to: { equals: true } }, sendEmail: { templateType: 'app_user_upgraded', category: 'transactional' } },
                { name: 'Downgraded', when: { from: { noneOf: ['', 'free'] }, to: { anyOf: ['', 'free'] } }, sendEmail: { templateType: 'bye', category: 'marketing' } },
            ],
        };
        const d = mappingToDraft('app_user.changed.isPro', saved);
        expect(d.rules[0]).toMatchObject({ toKind: 'equals', toText: 'true', templateType: 'app_user_upgraded' });
        expect(d.rules[1]).toMatchObject({ fromKind: 'none_of', fromText: ', free', toKind: 'any_of', category: 'marketing' });
        expect(draftToMapping(d, saved)).toEqual({
            enabled: true,
            rules: [
                { name: 'Upgraded', when: { to: { equals: 'true' } }, sendEmail: { templateType: 'app_user_upgraded', category: 'transactional' } },
                { name: 'Downgraded', when: { from: { noneOf: ['', 'free'] }, to: { anyOf: ['', 'free'] } }, sendEmail: { templateType: 'bye', category: 'marketing' } },
            ],
        });
    });

    it('saves everything as rules, drops the old action keys, and keeps keys it does not edit', () => {
        const original = { enabled: false, addToLists: ['a'], enrollInDrip: 'd1' };
        const d = mappingToDraft('user.signed_up', original);
        d.enabled = true;
        expect(draftToMapping(d, original)).toEqual({ enabled: true, enrollInDrip: 'd1', rules: [{ name: 'Default', addToLists: ['a'] }] });
    });

    it('never gives an app-user event list or notification actions, nor conditions to events without values', () => {
        const rule = { ...emptyRule('R'), sendEmail: true, templateType: 't', notify: true, notificationType: 'x', notificationTitle: 'T', addToLists: ['a'], toKind: 'equals' as const, toText: 'x' };
        expect(draftToMapping({ type: 'app_user.created', enabled: true, rules: [rule] }, undefined))
            .toEqual({ enabled: true, rules: [{ name: 'R', sendEmail: { templateType: 't', category: 'transactional' } }] });
        expect(draftToMapping({ type: 'user.signed_up', enabled: true, rules: [{ ...rule, enabled: false }] }, undefined).rules).toEqual([{
            name: 'R', enabled: false,
            sendEmail: { templateType: 't', category: 'transactional' },
            createNotification: { typeKey: 'x', titleTemplate: 'T', bodyTemplate: '' },
            addToLists: ['a'],
        }]);
    });

    it('reports what stops a save', () => {
        const ok = { ...emptyRule('R'), sendEmail: true, templateType: 't' };
        expect(draftProblems({ type: 'x', enabled: true, rules: [ok] })).toEqual([]);
        expect(draftProblems({ type: 'x', enabled: true, rules: [{ ...ok, name: ' ', templateType: '' }, emptyRule('Empty'), { ...emptyRule('N'), notify: true }] }))
            .toEqual(['rule_needs_name', 'email_needs_template', 'rule_needs_action', 'notification_incomplete']);
    });
});
