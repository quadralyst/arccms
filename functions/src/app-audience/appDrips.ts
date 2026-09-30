/**
 * Sequences on App users (live) lists (specs/coexistence-spec.md 5b, CO6.5c).
 *
 * A live list has no membership to join, so joining is a change: a person joins
 * when a write to their host document makes them match the list's conditions
 * (a new document that matches, or a change such as `isPro` becoming true), and
 * leaves when a write makes them stop matching or deletes them. Activation can
 * also enroll everyone who matches already. Each step is then checked and sent
 * by `dripSend`, which reads the host document again.
 */
import { db } from '../init.js';
import {
    appContactId,
    enrollInCampaign,
    type DripCampaignDoc,
} from '../email-core/dripEnrollment.js';
import { exitEnrollment } from '../email-core/dripSend.js';
import type { AppAudienceSettings } from './config.js';
import { resolveAppUser } from './fields.js';
import { appListConditionsOf, matchesAppConditions, resolveAppList, type AppListCondition } from './appLists.js';
import { appUserStateId } from './state.js';

export interface LiveCampaign {
    campaign: DripCampaignDoc;
    conditions: AppListCondition[];
}

/**
 * Active sequences whose list is an App users (live) list. Read on every host
 * write, not cached: a cache on one trigger instance would not see a sequence
 * activated on another, and would miss whoever started matching meanwhile. The
 * read is small (active sequences and their lists).
 */
export async function activeLiveCampaigns(): Promise<LiveCampaign[]> {
    const snap = await db.collection('DripCampaigns').where('status', '==', 'active').get();
    const campaigns = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DripCampaignDoc, 'id'>) }));
    const listIds = [...new Set(campaigns.map((c) => c.listId).filter(Boolean))];
    const lists = listIds.length ? await db.getAll(...listIds.map((id) => db.collection('Lists').doc(id))) : [];
    const conditionsByList = new Map(lists.map((l, i) => [listIds[i], appListConditionsOf(l.exists ? l.data() : undefined)]));
    return campaigns
        .map((campaign) => ({ campaign, conditions: conditionsByList.get(campaign.listId) }))
        .filter((c): c is LiveCampaign => !!c.conditions);
}

type Doc = Record<string, unknown> | undefined;

export interface AppDripChanges {
    enroll: DripCampaignDoc[];
    exit: DripCampaignDoc[];
}

/** Which live sequences a write makes the person join or leave. Pure. */
export function planAppDrips(before: Doc, after: Doc, live: LiveCampaign[]): AppDripChanges {
    const changes: AppDripChanges = { enroll: [], exit: [] };
    for (const { campaign, conditions } of live) {
        const was = !!before && matchesAppConditions(before, conditions);
        const is = !!after && matchesAppConditions(after, conditions);
        if (is && !was) changes.enroll.push(campaign);
        else if (was && !is) changes.exit.push(campaign);
    }
    return changes;
}

/**
 * A person's enrollments follow their unique key (review C3). An enrollment is
 * filed under `<campaign>_app_<sha256(key)>`, so after the key changes (email as
 * the key, say) the old one was out of reach: leaving the list did not exit it,
 * and matching again enrolled a second one. Every enrollment for this host
 * document moves to the new key, whatever its status; if the new key already
 * has one for that sequence, the old one is exited as a duplicate.
 */
export async function rekeyAppEnrollments(docId: string, appUserId: string): Promise<number> {
    const snap = await db.collection('DripEnrollments').where('appDocId', '==', docId).get();
    let moved = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        if (data['appUserId'] === appUserId) continue;
        const campaignId = String(data['campaignId']);
        const target = db.collection('DripEnrollments').doc(`${campaignId}_${appContactId(appUserId)}`);
        const outcome = await db.runTransaction(async (tx) => {
            const existing = await tx.get(target);
            if (existing.exists) return 'duplicate' as const;
            tx.set(target, { ...data, appUserId, contactId: appContactId(appUserId), rekeyedFrom: doc.id });
            tx.delete(doc.ref);
            return 'moved' as const;
        });
        if (outcome === 'moved') moved++;
        else if (data['status'] === 'active') await exitEnrollment(doc.ref, campaignId, 'duplicate');
    }
    return moved;
}

/** Applies one host write to the live sequences. Returns how many enrollments were made. */
export async function syncAppDrips(docId: string, before: Doc, after: Doc, settings: AppAudienceSettings): Promise<number> {
    const keyOf = (data: Doc) => (data ? resolveAppUser(docId, data, settings).key : '');
    const oldKey = keyOf(before);
    const newKey = keyOf(after);
    // Before anything else, and whether or not a sequence is active now: a paused
    // sequence's enrollments must follow the key too.
    if (oldKey && newKey && oldKey !== newKey) await rekeyAppEnrollments(docId, appUserStateId(newKey));

    const live = await activeLiveCampaigns();
    if (!live.length) return 0;
    const { enroll, exit } = planAppDrips(before, after, live);
    if (!enroll.length && !exit.length) return 0;

    // Exit by the host document, which never changes, rather than by a key.
    if (exit.length) {
        const leaving = new Set(exit.map((c) => c.id));
        const snap = await db.collection('DripEnrollments').where('appDocId', '==', docId).get();
        for (const doc of snap.docs) {
            const data = doc.data();
            if (data['status'] === 'active' && leaving.has(String(data['campaignId']))) {
                await exitEnrollment(doc.ref, String(data['campaignId']), after ? 'left_list' : 'app_user_deleted');
            }
        }
    }

    let enrolled = 0;
    const key = newKey;
    if (key) {
        const appUserId = appUserStateId(key);
        for (const campaign of enroll) {
            if (await enrollInCampaign(campaign, appContactId(appUserId), { appUserId, appDocId: docId })) enrolled++;
        }
        if (enrolled) {
            // Day 0 goes out now rather than at the next 15-minute tick, as for contacts.
            const { flushDueEnrollments } = await import('../email-core/dripSend.js');
            await flushDueEnrollments(appContactId(appUserId));
        }
    }
    return enrolled;
}

/**
 * On activation: enroll everyone the live list matches now (idempotent).
 * `truncated`: only the first MAX_APP_USERS host documents were read, so people
 * after them were not enrolled now (they still are when their document changes).
 */
export async function backfillAppCampaign(
    campaign: DripCampaignDoc,
    conditions: AppListCondition[],
): Promise<{ enrolled: number; truncated: boolean }> {
    const { members, truncated } = await resolveAppList(conditions);
    let enrolled = 0;
    for (const m of members) {
        if (await enrollInCampaign(campaign, appContactId(m.appUserId), { appUserId: m.appUserId, appDocId: m.docId })) enrolled++;
    }
    return { enrolled, truncated };
}
