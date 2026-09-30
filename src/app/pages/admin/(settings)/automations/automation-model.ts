/**
 * The Automations editor's model (specs/coexistence-spec.md 5b, CO6.5d): how an
 * event mapping in `Settings/event_mappings` becomes an editable form and back.
 *
 * Mirrors functions/src/email-core/eventRules.ts. A mapping's own actions (the
 * older shape, one set of actions per event) are shown as a first rule without
 * conditions and saved back as rules, which the bus treats the same way.
 */
import type { FeatureId } from '../../../../core/features/feature-registry';

export type EmailCategory = 'transactional' | 'marketing';

/** One side of a rule's condition, as edited. `any` means no condition. */
export type ConditionKind = 'any' | 'equals' | 'any_of' | 'none_of';

export interface RuleDraft {
    name: string;
    enabled: boolean;
    fromKind: ConditionKind;
    fromText: string;
    toKind: ConditionKind;
    toText: string;
    sendEmail: boolean;
    templateType: string;
    category: EmailCategory;
    notify: boolean;
    notificationType: string;
    notificationTitle: string;
    notificationBody: string;
    notificationLink: string;
    addToLists: string[];
    removeFromLists: string[];
}

export interface EventDraft {
    type: string;
    enabled: boolean;
    rules: RuleDraft[];
}

/** What an event is, for labels and for which actions make sense. */
export interface EventInfo {
    type: string;
    /** App-user events: no list actions (they would copy people into Contacts), no notifications (no ArcCMS user). */
    appUser: boolean;
    /** Field-change events carry `from` and `to`, so their rules can have conditions. */
    field?: string;
}

export const BUILT_IN_EVENTS = ['user.signed_up', 'payment.succeeded', 'payment.failed', 'waitlist.joined'];
export const APP_USER_CREATED = 'app_user.created';
export const APP_USER_DELETED = 'app_user.deleted';
export const APP_USER_CHANGED_PREFIX = 'app_user.changed.';

/** The feature an event belongs to; it is not offered when that feature is off (specs/feature-flags-spec.md). */
export function eventFeature(type: string): FeatureId | undefined {
    if (type.startsWith('payment.')) return 'payments';
    if (type.startsWith('waitlist.')) return 'forms';
    if (type.startsWith('app_user.')) return 'audience';
    return undefined;
}

export function eventInfo(type: string): EventInfo {
    if (type.startsWith(APP_USER_CHANGED_PREFIX)) return { type, appUser: true, field: type.slice(APP_USER_CHANGED_PREFIX.length) };
    return { type, appUser: type.startsWith('app_user.') };
}

/**
 * Every event worth offering: the built-in ones, the app-user ones when an app
 * is connected (one change event per watched field), and any event that already
 * has a mapping, so nothing saved is ever hidden. Events of a feature that is off
 * are left out: they never fire, and their mappings stay saved for when it is on.
 */
export function availableEvents(opts: {
    appConnected: boolean;
    watchedFields: string[];
    mapped: string[];
    on?: (id: FeatureId) => boolean;
}): EventInfo[] {
    const types = [...BUILT_IN_EVENTS];
    if (opts.appConnected) {
        types.push(APP_USER_CREATED, ...opts.watchedFields.map((f) => APP_USER_CHANGED_PREFIX + f), APP_USER_DELETED);
    }
    for (const t of opts.mapped) if (!types.includes(t)) types.push(t);
    const on = opts.on ?? (() => true);
    return types.filter((t) => { const f = eventFeature(t); return !f || on(f); }).map(eventInfo);
}

type Raw = Record<string, unknown>;
const ACTION_KEYS = ['createNotification', 'sendEmail', 'addToLists', 'removeFromLists'];

function conditionToDraft(raw: unknown): { kind: ConditionKind; text: string } {
    const c = (raw ?? {}) as Raw;
    const join = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : '');
    if ('equals' in c) return { kind: 'equals', text: c['equals'] == null ? '' : String(c['equals']) };
    if (Array.isArray(c['anyOf'])) return { kind: 'any_of', text: join(c['anyOf']) };
    if (Array.isArray(c['noneOf'])) return { kind: 'none_of', text: join(c['noneOf']) };
    return { kind: 'any', text: '' };
}

function conditionFromDraft(kind: ConditionKind, text: string): Raw | undefined {
    const list = () => text.split(',').map((v) => v.trim());
    if (kind === 'equals') return { equals: text.trim() };
    if (kind === 'any_of') return { anyOf: list() };
    if (kind === 'none_of') return { noneOf: list() };
    return undefined;
}

export function emptyRule(name = ''): RuleDraft {
    return {
        name, enabled: true,
        fromKind: 'any', fromText: '', toKind: 'any', toText: '',
        sendEmail: false, templateType: '', category: 'transactional',
        notify: false, notificationType: '', notificationTitle: '', notificationBody: '', notificationLink: '',
        addToLists: [], removeFromLists: [],
    };
}

function ruleToDraft(raw: Raw, fallbackName: string): RuleDraft {
    const when = (raw['when'] ?? {}) as Raw;
    const from = conditionToDraft(when['from']);
    const to = conditionToDraft(when['to']);
    const email = raw['sendEmail'] as Raw | undefined;
    const note = raw['createNotification'] as Raw | undefined;
    return {
        name: typeof raw['name'] === 'string' && raw['name'] ? raw['name'] : fallbackName,
        enabled: raw['enabled'] !== false,
        fromKind: from.kind, fromText: from.text, toKind: to.kind, toText: to.text,
        sendEmail: !!email,
        templateType: String(email?.['templateType'] ?? ''),
        category: email?.['category'] === 'marketing' ? 'marketing' : 'transactional',
        notify: !!note,
        notificationType: String(note?.['typeKey'] ?? ''),
        notificationTitle: String(note?.['titleTemplate'] ?? ''),
        notificationBody: String(note?.['bodyTemplate'] ?? ''),
        notificationLink: String(note?.['link'] ?? ''),
        addToLists: Array.isArray(raw['addToLists']) ? raw['addToLists'].map(String) : [],
        removeFromLists: Array.isArray(raw['removeFromLists']) ? raw['removeFromLists'].map(String) : [],
    };
}

/** A saved mapping as an editable event. */
export function mappingToDraft(type: string, mapping: unknown): EventDraft {
    const m = (mapping ?? {}) as Raw;
    const rules: RuleDraft[] = [];
    // The mapping's own actions: its `enabled` is the event's switch, not this rule's.
    if (ACTION_KEYS.some((k) => m[k] !== undefined)) rules.push(ruleToDraft({ ...m, enabled: true, name: 'Default' }, 'Default'));
    if (Array.isArray(m['rules'])) m['rules'].forEach((r, i) => rules.push(ruleToDraft((r ?? {}) as Raw, `Rule ${i + 1}`)));
    return { type, enabled: m['enabled'] === true, rules };
}

/** Problems that stop an event from being saved, as translation keys. */
export function draftProblems(draft: EventDraft): string[] {
    const problems: string[] = [];
    for (const r of draft.rules) {
        if (!r.name.trim()) problems.push('rule_needs_name');
        if (r.sendEmail && !r.templateType) problems.push('email_needs_template');
        if (r.notify && (!r.notificationType || !r.notificationTitle.trim())) problems.push('notification_incomplete');
        if (!r.sendEmail && !r.notify && !r.addToLists.length && !r.removeFromLists.length) problems.push('rule_needs_action');
    }
    return [...new Set(problems)];
}

/**
 * An edited event as a mapping. Everything becomes `rules`; the mapping's own
 * action keys are removed, and any other key already on it (for example
 * `enrollInDrip`) is kept untouched. Actions an event cannot use are dropped.
 */
export function draftToMapping(draft: EventDraft, original: unknown): Raw {
    const info = eventInfo(draft.type);
    const kept: Raw = { ...((original ?? {}) as Raw) };
    for (const k of ACTION_KEYS) delete kept[k];
    const rules = draft.rules.map((r) => {
        const rule: Raw = { name: r.name.trim() };
        if (!r.enabled) rule['enabled'] = false;
        if (info.field) {
            const from = conditionFromDraft(r.fromKind, r.fromText);
            const to = conditionFromDraft(r.toKind, r.toText);
            if (from || to) rule['when'] = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
        }
        if (r.sendEmail) rule['sendEmail'] = { templateType: r.templateType, category: r.category };
        if (r.notify && !info.appUser) {
            rule['createNotification'] = {
                typeKey: r.notificationType,
                titleTemplate: r.notificationTitle.trim(),
                bodyTemplate: r.notificationBody.trim(),
                ...(r.notificationLink.trim() ? { link: r.notificationLink.trim() } : {}),
            };
        }
        if (!info.appUser && r.addToLists.length) rule['addToLists'] = [...r.addToLists];
        if (!info.appUser && r.removeFromLists.length) rule['removeFromLists'] = [...r.removeFromLists];
        return rule;
    });
    return { ...kept, enabled: draft.enabled, rules };
}
