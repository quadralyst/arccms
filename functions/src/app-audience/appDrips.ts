/**
 * Sequences on App users (live) lists (docs/coexistence-spec.md 5b, CO6.5c).
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

/** Applies one host write to the live sequences. Returns how many enrollments were made. */
export async function syncAppDrips(docId: string, before: Doc, after: Doc, settings: AppAudienceSettings): Promise<number> {
    const live = await activeLiveCampaigns();
    if (!live.length) return 0;
    const { enroll, exit } = planAppDrips(before, after, live);
    if (!enroll.length && !exit.length) return 0;

    // Enroll under the current key; exit under the key they had when they matched.
    const keyOf = (data: Doc) => (data ? resolveAppUser(docId, data, settings).key : '');
    for (const campaign of exit) {
        const key = keyOf(before);
        if (!key) continue;
        const ref = db.collection('DripEnrollments').doc(`${campaign.id}_${appContactId(appUserStateId(key))}`);
        const snap = await ref.get();
        if (snap.exists && snap.data()?.['status'] === 'active') {
            await exitEnrollment(ref, campaign.id, after ? 'left_list' : 'app_user_deleted');
        }
    }

    let enrolled = 0;
    const key = keyOf(after);
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

/** On activation: enroll everyone the live list matches now (idempotent). */
export async function backfillAppCampaign(campaign: DripCampaignDoc, conditions: AppListCondition[]): Promise<number> {
    const { members } = await resolveAppList(conditions);
    let enrolled = 0;
    for (const m of members) {
        if (await enrollInCampaign(campaign, appContactId(m.appUserId), { appUserId: m.appUserId, appDocId: m.docId })) enrolled++;
    }
    return enrolled;
}
