/**
 * The one piece of Google Cloud setup phone sign-in needs (docs/features/sign-in.html).
 *
 * Phone sign-in ends with a custom token (`issueSignInToken`), which the Admin SDK signs
 * through the IAM Credentials API as the functions' own service account. That needs the
 * Service Account Token Creator role on the account, and the API turned on. Without either,
 * every phone sign-in fails at the very last step.
 *
 * This file names the problem from the error, builds the fix for this project (a gcloud
 * command and a console link), and tells the admins once a day while it lasts. The person
 * signing in only learns that phone sign-in is not ready: the fix is for the admins.
 */
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { metadataValue, runtimeServiceAccount } from '../utils/runtimeIdentity.js';

export type SigningProblem = 'token-creator-missing' | 'api-disabled';

/** What the person signing in sees when the server cannot sign them in yet. */
export const SIGN_IN_NOT_READY = "Phone sign-in isn't ready on this site yet. Please contact the site's team.";

export const TOKEN_CREATOR_ROLE = 'roles/iam.serviceAccountTokenCreator';
export const IAM_CREDENTIALS_API = 'iamcredentials.googleapis.com';

/** Where the last alert is remembered, so the admins hear about it once a day at most. */
export const ALERT_DOC = { collection: '_system', doc: 'sign_in_setup_alert' } as const;
const ALERT_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * The setup problem behind a failed token signing, or null for any other error.
 *
 * The Admin SDK reports both as `auth/insufficient-permission`; the message tells them
 * apart: "IAM Service Account Credentials API has not been used in project ... or it is
 * disabled", or "Permission 'iam.serviceAccounts.signBlob' denied".
 */
export function signingProblem(error: unknown): SigningProblem | null {
    const e = error as { code?: unknown; message?: unknown; errorInfo?: { code?: unknown } } | null;
    const code = String(e?.code ?? e?.errorInfo?.code ?? '');
    const message = String(e?.message ?? '');
    if (/iamcredentials\.googleapis\.com|Service Account Credentials API/i.test(message)) return 'api-disabled';
    if (/signBlob|serviceAccountTokenCreator|Token Creator/i.test(message)) return 'token-creator-missing';
    if (code === 'auth/insufficient-permission') return 'token-creator-missing';
    return null;
}

export interface SigningFix {
    problem: SigningProblem;
    /** The functions' service account; a placeholder when the metadata server cannot say. */
    serviceAccount: string;
    project: string;
    /** One gcloud command that fixes it. */
    command: string;
    /** The Google Cloud console page where it can be fixed by hand. */
    consoleUrl: string;
}

/** The fix for this project: the command to run, and the console page. */
export function fixFor(problem: SigningProblem, project: string, serviceAccount: string): SigningFix {
    const p = project || 'PROJECT_ID';
    const sa = serviceAccount || 'PROJECT_NUMBER-compute@developer.gserviceaccount.com';
    if (problem === 'api-disabled') {
        return {
            problem, project: p, serviceAccount: sa,
            command: `gcloud services enable ${IAM_CREDENTIALS_API} --project=${p}`,
            consoleUrl: `https://console.cloud.google.com/apis/library/${IAM_CREDENTIALS_API}?project=${p}`,
        };
    }
    return {
        problem, project: p, serviceAccount: sa,
        command: `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=serviceAccount:${sa} --role=${TOKEN_CREATOR_ROLE} --project=${p}`,
        consoleUrl: `https://console.cloud.google.com/iam-admin/iam?project=${p}`,
    };
}

/** The fix, with this project's id and the functions' service account filled in. */
export async function signingFix(problem: SigningProblem): Promise<SigningFix> {
    const project = process.env.GCLOUD_PROJECT || (await metadataValue('project/project-id').catch(() => ''));
    return fixFor(problem, project, await runtimeServiceAccount());
}

/** The admins' notification for a problem. */
export function alertText(fix: SigningFix): { title: string; body: string } {
    const body = fix.problem === 'api-disabled'
        ? `People can't finish phone sign-in: turn on the IAM Service Account Credentials API for ${fix.project}. Settings, User Settings shows how.`
        : `People can't finish phone sign-in: the functions' service account (${fix.serviceAccount}) needs the Service Account Token Creator role. Settings, User Settings shows how.`;
    return { title: 'Phone sign-in needs one more step', body };
}

/** Tell every admin, at most once a day. Never throws: the sign-in error still reaches the person. */
export async function alertSigningProblem(problem: SigningProblem): Promise<void> {
    try {
        const ref = db.collection(ALERT_DOC.collection).doc(ALERT_DOC.doc);
        const last = (await ref.get()).data()?.['alertedAt'] as Timestamp | undefined;
        if (last && Date.now() - last.toMillis() < ALERT_EVERY_MS) return;
        await ref.set({ alertedAt: Timestamp.now(), problem });
        const fix = await signingFix(problem);
        await notifyAdmins('admin_sign_in_setup', { ...alertText(fix), link: '/admin/settings/user' });
    } catch (error) {
        logger.warn('Could not alert the admins about phone sign-in setup:', error);
    }
}
