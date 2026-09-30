/**
 * Rules within an event mapping (specs/coexistence-spec.md 5b, CO6.4).
 *
 * A mapping in `Settings/event_mappings` used to hold one set of actions per
 * event. It can now also hold `rules`: several sets of actions for the same
 * event, each with an optional condition on the old and new value, so one
 * field change can mean different things, for example
 *
 *   'app_user.changed.isPro': { enabled: true, rules: [
 *     { name: 'Upgraded',   when: { to: { equals: true } },  sendEmail: { templateType: 'app_user_upgraded', category: 'transactional' } },
 *     { name: 'Downgraded', when: { to: { equals: false } }, sendEmail: { templateType: 'app_user_downgraded', category: 'transactional' } },
 *   ] }
 *
 * The mapping's `enabled` still switches the whole event on or off, and the
 * actions on the mapping itself still run, as a rule with no condition.
 */
import type { EmailCategory } from '../types.js';

/** The actions an event can trigger. */
export interface EventActions {
  createNotification?: { typeKey: string; titleTemplate: string; bodyTemplate: string; link?: string };
  sendEmail?: { templateType: string; category: EmailCategory };
  addToLists?: string[];
  removeFromLists?: string[];
  enrollInDrip?: string;
}

/**
 * A check on one value. Values compare as text, ignoring case, and empty, null
 * and missing are all ''. So `{ equals: true }` matches a stored `true`,
 * `{ equals: 'pro' }` matches 'Pro', and `{ anyOf: ['', 'free'] }` matches a
 * free plan written either way. Case is ignored as in App users (live) list
 * conditions, so the same value matches both (review C7).
 */
export interface ValueCondition {
  equals?: unknown;
  anyOf?: unknown[];
  noneOf?: unknown[];
}

export interface EventRule extends EventActions {
  /** Shown in the event's results, so a log says which rule ran. */
  name?: string;
  enabled?: boolean;
  /** Checked against the event's `from` and `to` values (app_user.changed.<field>). */
  when?: { from?: ValueCondition; to?: ValueCondition };
}

export interface EventMapping extends EventActions {
  enabled: boolean;
  rules?: EventRule[];
}

const ACTION_KEYS: Array<keyof EventActions> = ['createNotification', 'sendEmail', 'addToLists', 'removeFromLists', 'enrollInDrip'];

/** A value as a condition sees it. */
export function conditionText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

/** A value as a condition compares it: its text, lower-cased. */
function conditionKey(value: unknown): string {
  return conditionText(value).toLowerCase();
}

export function matchesCondition(condition: ValueCondition | undefined, value: unknown): boolean {
  if (!condition) return true;
  const text = conditionKey(value);
  if ('equals' in condition && conditionKey(condition.equals) !== text) return false;
  if (Array.isArray(condition.anyOf) && !condition.anyOf.map(conditionKey).includes(text)) return false;
  if (Array.isArray(condition.noneOf) && condition.noneOf.map(conditionKey).includes(text)) return false;
  return true;
}

/**
 * The rules of a mapping that apply to an event with these data. The mapping's
 * own actions come first, as a rule named 'default', when it has any.
 */
export function applicableRules(mapping: EventMapping, data: Record<string, unknown>): EventRule[] {
  const rules: EventRule[] = [];
  if (ACTION_KEYS.some((k) => mapping[k] !== undefined)) {
    const own: EventRule = { name: 'default' };
    for (const k of ACTION_KEYS) if (mapping[k] !== undefined) (own as Record<string, unknown>)[k] = mapping[k];
    rules.push(own);
  }
  for (const rule of mapping.rules ?? []) {
    if (!rule || rule.enabled === false) continue;
    if (!matchesCondition(rule.when?.from, data['from']) || !matchesCondition(rule.when?.to, data['to'])) continue;
    rules.push(rule);
  }
  return rules;
}
