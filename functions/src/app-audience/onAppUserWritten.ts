/**
 * Reacting to the host app's users (docs/coexistence-spec.md 5b, CO6.4).
 *
 * A trigger on the host collection set at deploy time (`ARC_APP_USERS_DATABASE`,
 * `ARC_APP_USERS_PATH`). It turns writes into events on the ArcCMS event bus:
 *
 * - a new document: `app_user.created`;
 * - a watched field (or the unique key field) changing: one
 *   `app_user.changed.<field>` per field, with its old and new value, so event
 *   mappings can react to one field and one transition ("isPro became true");
 * - a deleted document: `app_user.deleted`.
 *
 * The same write also enrolls the person in, or exits them from, sequences on
 * App users (live) lists they start or stop matching (CO6.5c, `appDrips.ts`).
 *
 * Any other write (a counter ticking, a timestamp) produces no event. Documents
 * that existed before the trigger was deployed produce no `created` event.
 * Each event's id comes from the Firestore event, so a delivery Firestore
 * repeats does not act twice. Unconfigured installs point at a collection
 * nothing writes to, so this never runs there.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { emitAppEvent } from '../email-core/appEvents.js';
import { appUsersDatabaseParam, appUsersLocation, appUsersPathParam, type AppAudienceSettings } from './config.js';
import { readAppAudienceSettings } from './adminCallables.js';
import { comparableValue, isSensitiveField, MASKED_VALUE, maskResolvedAppUser, resolveAppUser, safeDisplayValue, valueAt } from './fields.js';
import { APP_AUDIENCE_STATE, appUserStateId } from './state.js';
import { syncAppDrips } from './appDrips.js';

export const APP_USER_CREATED = 'app_user.created';
export const APP_USER_DELETED = 'app_user.deleted';
/** Followed by the field path: `app_user.changed.isPro`. */
export const APP_USER_CHANGED_PREFIX = 'app_user.changed.';

export interface PlannedAppUserEvent {
    type: string;
    /** Distinguishes the events of one write, for their ids. */
    suffix: string;
    /** The person's `AppAudience` id. */
    appUserId: string;
    /** Where an email for this event goes. */
    email: string;
    /** Template data: docId, name, email, phone, and for a change field, from, to. */
    data: Record<string, string>;
}

export interface AppUserWritePlan {
    events: PlannedAppUserEvent[];
    /** The unique key changed: carry ArcCMS's record (consent) to the new key. */
    moveState?: { from: string; to: string };
    /** The person was deleted in the host app. */
    markDeleted?: string;
    /** The person was created; a record left from an earlier deletion is live again. */
    clearDeleted?: string;
}

type Doc = Record<string, unknown> | undefined;

/** What one write to a host document means. Pure, so every case is testable. */
export function planAppUserWrite(docId: string, before: Doc, after: Doc, settings: AppAudienceSettings): AppUserWritePlan {
    const plan: AppUserWritePlan = { events: [] };
    const person = (data: Record<string, unknown>) => {
        const resolved = resolveAppUser(docId, data, settings);
        const shown = maskResolvedAppUser(resolved, settings);
        return { key: resolved.key, email: resolved.email, data: { docId, name: shown.name, email: shown.email, phone: shown.phone } };
    };

    if (!before && after) {
        const p = person(after);
        if (!p.key) return plan;
        const appUserId = appUserStateId(p.key);
        plan.events.push({ type: APP_USER_CREATED, suffix: 'created', appUserId, email: p.email, data: p.data });
        plan.clearDeleted = appUserId;
        return plan;
    }

    if (before && !after) {
        const p = person(before);
        if (!p.key) return plan;
        const appUserId = appUserStateId(p.key);
        plan.events.push({ type: APP_USER_DELETED, suffix: 'deleted', appUserId, email: p.email, data: p.data });
        plan.markDeleted = appUserId;
        return plan;
    }

    if (!before || !after) return plan;
    const was = person(before);
    const now = person(after);
    if (!now.key) return plan;
    const appUserId = appUserStateId(now.key);

    const fields = new Set(settings.watchedFields);
    if (settings.key.source === 'field') fields.add(settings.key.field);
    for (const field of fields) {
        // Compared whole, so a change deep in a map or past the display length
        // still counts; shown with credential-like keys inside it hidden.
        const oldValue = valueAt(before, field);
        const newValue = valueAt(after, field);
        if (comparableValue(oldValue) === comparableValue(newValue)) continue;
        const from = safeDisplayValue(oldValue);
        const to = safeDisplayValue(newValue);
        const hidden = isSensitiveField(field);
        plan.events.push({
            type: APP_USER_CHANGED_PREFIX + field,
            suffix: `changed.${field}`,
            appUserId,
            email: now.email,
            data: { ...now.data, field, from: hidden ? MASKED_VALUE : from, to: hidden ? MASKED_VALUE : to },
        });
    }

    if (was.key && was.key !== now.key) plan.moveState = { from: appUserStateId(was.key), to: appUserId };
    return plan;
}

/** Applies a plan's changes to ArcCMS's own records. */
async function applyState(plan: AppUserWritePlan): Promise<void> {
    const state = db.collection(APP_AUDIENCE_STATE);
    if (plan.moveState) {
        const [from, to] = await Promise.all([state.doc(plan.moveState.from).get(), state.doc(plan.moveState.to).get()]);
        // A record already at the new key wins: it is that key's own history.
        if (from.exists && !to.exists) {
            await state.doc(plan.moveState.to).set({ ...from.data(), movedFrom: plan.moveState.from, updatedAt: Timestamp.now() });
            await state.doc(plan.moveState.from).delete();
        }
    }
    if (plan.markDeleted) {
        const ref = state.doc(plan.markDeleted);
        // Consent is kept, so a returning address is not mailed against a past unsubscribe.
        if ((await ref.get()).exists) await ref.update({ deleted: true, deletedAt: Timestamp.now() });
    }
    if (plan.clearDeleted) {
        const ref = state.doc(plan.clearDeleted);
        const snap = await ref.get();
        if (snap.exists && snap.data()?.['deleted']) await ref.update({ deleted: FieldValue.delete(), deletedAt: FieldValue.delete() });
    }
}

/**
 * How long a failed host write is retried. Retries stop at an age, not a count:
 * the attempt number cannot be kept on the host app's own document, and a
 * permanent fault (settings the host no longer fits, say) would otherwise run
 * for the platform's whole retry window on every write.
 */
export const APP_USER_RETRY_WINDOW_MS = 60 * 60 * 1000;

/** Whether a failed run of this event should be retried, from its CloudEvent time. */
export function shouldRetryAppUserWrite(eventTime: string | undefined, now = Date.now()): boolean {
    const age = now - Date.parse(eventTime ?? '');
    return Number.isFinite(age) && age <= APP_USER_RETRY_WINDOW_MS;
}

/**
 * `retry: true` (review C6): a failure part way through (reading settings,
 * emitting an event, joining or leaving a sequence) used to end the run, and
 * that person's change was lost with nothing retried. Now the platform runs the
 * event again, which is safe because every step is a no-op the second time: the
 * state moves only if the old record is still there, events are created under
 * ids from this event, enrollment is a create(), and each step's email has a
 * duplicate guard.
 */
export const onAppUserWritten = onDocumentWritten(
    { document: appUsersPathParam, database: appUsersDatabaseParam, retry: true },
    async (event) => {
        if (!appUsersLocation().configured || !event.data) return;
        const { before, after } = event.data;
        const beforeData = before?.exists ? before.data() : undefined;
        const afterData = after?.exists ? after.data() : undefined;
        const docId = after?.id || before?.id;
        if (!docId) return;

        try {
            const settings = await readAppAudienceSettings();
            const plan = planAppUserWrite(docId, beforeData, afterData, settings);
            if (plan.events.length || plan.moveState) await applyState(plan);
            for (const e of plan.events) {
                await emitAppEvent(e.type, { appUserId: e.appUserId, contactEmail: e.email || undefined, data: e.data }, {
                    id: `${event.id}.${e.suffix}`.replace(/\//g, '_'),
                });
            }
            // Sequences on App users (live) lists: joining is starting to match (CO6.5c).
            await syncAppDrips(docId, beforeData, afterData, settings);
        } catch (err) {
            const retry = shouldRetryAppUserWrite(event.time);
            logger.error(
                `onAppUserWritten: failed for host document ${docId} (event ${event.id}); `
                + (retry ? 'will retry.' : `giving up after ${APP_USER_RETRY_WINDOW_MS / 60000} minutes; the events and sequence changes of this write were not applied.`),
                err,
            );
            if (retry) throw err;
        }
    },
);
