import { db } from '../init.js';
import { GoogleAuth } from 'google-auth-library';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';

const API_BASE = 'https://firebasehosting.googleapis.com/v1beta1';

// ─── Exported Interfaces ────────────────────────────────────────────────────

export interface DeployStep {
    step: number;
    label: string;
    status: 'success' | 'failed' | 'skipped';
    detail?: string;
    error?: string;
    timestamp: string;
}

export interface DeploymentLog {
    action: string;
    filePath: string;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    status: 'success' | 'failed';
    steps: DeployStep[];
    error: string | null;
}

// ─── Private Helpers ────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
    try {
        const auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        const client = await auth.getClient();
        const tokenResult = await client.getAccessToken();
        if (!tokenResult.token) {
            const err = new Error('Could not authenticate with Firebase Hosting API');
            (err as any).code = 'HOSTING_AUTH_FAILED';
            throw err;
        }
        return tokenResult.token;
    } catch (err: any) {
        if (err.code === 'HOSTING_AUTH_FAILED') throw err;
        const wrapped = new Error(`Could not authenticate with Firebase Hosting API: ${err.message}`);
        (wrapped as any).code = 'HOSTING_AUTH_FAILED';
        throw wrapped;
    }
}

async function apiFetch(url: string, token: string, options: RequestInit): Promise<any> {
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Hosting API error ${res.status}: ${text}`);
        (err as any).code = `HOSTING_API_${res.status}`;
        throw err;
    }
    return res.json();
}

function gzipAndHash(content: string): { gzipped: Buffer; hash: string } {
    try {
        const gzipped = zlib.gzipSync(Buffer.from(content, 'utf-8'), { level: 9 });
        const hash = crypto.createHash('sha256').update(gzipped).digest('hex');
        return { gzipped, hash };
    } catch (err: any) {
        const wrapped = new Error(`Failed to prepare file for upload: ${err.message}`);
        (wrapped as any).code = 'GZIP_HASH_FAILED';
        throw wrapped;
    }
}

function addStep(
    steps: DeployStep[],
    step: number,
    label: string,
    status: DeployStep['status'],
    detail?: string,
    error?: string,
): void {
    steps.push({ step, label, status, detail, error, timestamp: new Date().toISOString() });
}

async function writeDeploymentLog(
    collectionName: string,
    docId: string,
    log: DeploymentLog,
): Promise<void> {
    try {
        await db
            .collection(collectionName)
            .doc(docId)
            .collection('DeploymentLogs')
            .add(log);
    } catch {
        // Swallow — logging failure should not mask the deploy result
    }
}

async function updateDeployStatus(
    collectionName: string,
    docId: string,
    fields: Record<string, any>,
): Promise<void> {
    await db.collection(collectionName).doc(docId).update(fields);
}

// ─── Deploy Batch ───────────────────────────────────────────────────────────

/**
 * Files to publish in one Hosting release.
 *
 * Every deploy builds its new version from the *latest release's* file
 * manifest. Two deploys seconds apart can therefore race: the second reads a
 * release list that has not yet caught up, inherits a manifest without the
 * first file, and silently drops it — while both calls report success. That
 * cost a translated page on the dev project (docs/_todo.md item 3c), and M3
 * made it far likelier by turning 2 files per publish into 2 x languages.
 *
 * Collecting a whole publish into one batch removes the race by construction —
 * one version built from one snapshot — and cuts releases per publish from N
 * to 1.
 */
export class HostingBatch {
    private readonly additions = new Map<string, string>();
    private readonly removals = new Set<string>();

    /** Queues a file. A later add of the same path replaces the earlier one. */
    add(filePath: string, content: string): this {
        this.additions.set(filePath, content);
        this.removals.delete(filePath);
        return this;
    }

    /** Queues a removal. */
    remove(filePath: string): this {
        this.removals.delete(filePath);
        this.additions.delete(filePath);
        this.removals.add(filePath);
        return this;
    }

    get files(): Array<{ path: string; content: string }> {
        return [...this.additions].map(([path, content]) => ({ path, content }));
    }

    get removedPaths(): string[] {
        return [...this.removals];
    }

    get isEmpty(): boolean {
        return this.additions.size === 0 && this.removals.size === 0;
    }

    get size(): number {
        return this.additions.size + this.removals.size;
    }
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Deploys a batch of files to Firebase Hosting in a SINGLE version/release.
 *
 * Follows a 10-step pipeline:
 *  1. Authenticate   2. Get release   3. Get files   4. Get config
 *  5. Gzip+hash      6. Create version 7. Populate    8. Upload
 *  9. Finalize+release 10. Update Firestore
 *
 * One version per call is the point: see HostingBatch for the race that
 * per-file deploys are subject to.
 *
 * Writes step-by-step DeploymentLog to {collectionName}/{docId}/DeploymentLogs.
 * Updates deploy status fields on the content document.
 */
export async function deployBatchToHosting(
    siteId: string,
    batch: HostingBatch,
    collectionName: string,
    docId: string,
): Promise<void> {
    if (batch.isEmpty) return;
    const batchFiles = batch.files;
    const batchRemovals = batch.removedPaths;
    // Reported in status/logs; a batch is described by its first file.
    const filePath = batchFiles[0]?.path || batchRemovals[0] || '';
    siteId = siteId || process.env.GCLOUD_PROJECT || '';
    const steps: DeployStep[] = [];
    const startedAt = new Date();
    let errorMessage: string | null = null;
    let errorCode = '';

    try {
        // Step 1: Authenticate
        const token = await getAuthToken();
        addStep(steps, 1, 'Authenticate with Hosting API', 'success');

        // Step 2: Get latest release
        const releasesData = await apiFetch(
            `${API_BASE}/sites/${siteId}/releases?pageSize=1`,
            token,
            { method: 'GET' },
        );
        const currentVersionName = releasesData.releases?.[0]?.version?.name;
        addStep(steps, 2, 'Fetch current release', 'success',
            currentVersionName ? `version: ${currentVersionName}` : 'No existing releases');

        // Step 3: Get current version files
        let fileHashes: Record<string, string> = {};
        if (currentVersionName) {
            const filesData = await apiFetch(
                `${API_BASE}/${currentVersionName}/files`,
                token,
                { method: 'GET' },
            );
            for (const f of filesData.files || []) {
                fileHashes[f.path] = f.hash;
            }
        }
        addStep(steps, 3, 'Retrieve existing files', 'success',
            `${Object.keys(fileHashes).length} files`);

        // Step 4: Get current version config
        let currentConfig: any = {};
        if (currentVersionName) {
            const versionData = await apiFetch(
                `${API_BASE}/${currentVersionName}`,
                token,
                { method: 'GET' },
            );
            currentConfig = versionData.config || {};
        }
        addStep(steps, 4, 'Retrieve version config', 'success');

        // Step 5: Gzip + hash every file in the batch, then drop removals
        const prepared = batchFiles.map(file => {
            const { gzipped, hash } = gzipAndHash(file.content);
            fileHashes[file.path] = hash;
            return { ...file, gzipped, hash };
        });
        for (const path of batchRemovals) {
            delete fileHashes[path];
        }
        addStep(steps, 5, 'Gzip and hash content', 'success',
            `${prepared.length} file(s), ${batchRemovals.length} removal(s)`);

        // Step 6: Create new version
        const newVersion = await apiFetch(
            `${API_BASE}/sites/${siteId}/versions`,
            token,
            { method: 'POST', body: JSON.stringify({ config: currentConfig }) },
        );
        const newVersionName = newVersion.name;
        addStep(steps, 6, 'Create new version', 'success', newVersionName);

        // Step 7: Populate files
        const populateResult = await apiFetch(
            `${API_BASE}/${newVersionName}:populateFiles`,
            token,
            { method: 'POST', body: JSON.stringify({ files: fileHashes }) },
        );
        const uploadRequiredHashes: string[] = populateResult.uploadRequiredHashes || [];
        const uploadUrl: string = populateResult.uploadUrl || '';
        addStep(steps, 7, 'Populate files', 'success',
            `${uploadRequiredHashes.length} uploads required`);

        // Step 8: Upload (conditional, per file — unchanged content is skipped)
        let uploaded = 0;
        for (const file of prepared) {
            if (!uploadRequiredHashes.includes(file.hash)) continue;
            const uploadRes = await fetch(`${uploadUrl}/${file.hash}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/octet-stream',
                },
                body: new Uint8Array(file.gzipped),
            });
            if (!uploadRes.ok) {
                const text = await uploadRes.text();
                const err = new Error(`Upload failed ${uploadRes.status}: ${text} (${file.path})`);
                (err as any).code = `HOSTING_API_${uploadRes.status}`;
                throw err;
            }
            uploaded++;
        }
        addStep(steps, 8, 'Upload file content',
            uploaded ? 'success' : 'skipped',
            uploaded ? `${uploaded} uploaded` : 'Content already exists');

        // Step 9: Finalize + Release
        await apiFetch(
            `${API_BASE}/${newVersionName}?updateMask=status`,
            token,
            { method: 'PATCH', body: JSON.stringify({ status: 'FINALIZED' }) },
        );
        await apiFetch(
            `${API_BASE}/sites/${siteId}/releases?versionName=${newVersionName}`,
            token,
            { method: 'POST', body: JSON.stringify({}) },
        );
        addStep(steps, 9, 'Finalize and release', 'success');

        // Step 10: Update Firestore status
        const deployDurationMs = Date.now() - startedAt.getTime();
        await updateDeployStatus(collectionName, docId, {
            deployStatus: 'deployed',
            deployedAt: new Date(),
            deployedUrl: filePath.replace(/\.html$/, ''),
            deployError: '',
            deployErrorCode: '',
            deployDurationMs,
        });
        addStep(steps, 10, 'Update Firestore status', 'success');

    } catch (err: any) {
        errorMessage = err.message || 'Unknown error';
        errorCode = err.code || 'DEPLOY_UNKNOWN';
        const failedStepNum = steps.length + 1;
        addStep(steps, failedStepNum, `Step ${failedStepNum} failed`, 'failed', undefined, errorMessage ?? undefined);

        // Best-effort: mark content doc as failed
        try {
            const deployDurationMs = Date.now() - startedAt.getTime();
            await updateDeployStatus(collectionName, docId, {
                deployStatus: 'failed',
                deployedAt: new Date(),
                deployError: `Hosting deployment failed at Step ${failedStepNum}/10.\n${errorMessage}\nFile: ${filePath} | DocId: ${docId}\nTimestamp: ${new Date().toISOString()}`,
                deployErrorCode: errorCode,
                deployDurationMs,
            });
        } catch {
            // Swallow — can't update status
        }
    }

    // Always write deployment log
    const completedAt = new Date();
    await writeDeploymentLog(collectionName, docId, {
        action: 'publish',
        filePath,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        status: errorMessage ? 'failed' : 'success',
        steps,
        error: errorMessage,
    });
}

/**
 * Deploys a single file. Thin wrapper over `deployBatchToHosting`.
 *
 * Prefer batching when a caller writes several files in one operation — each
 * call here is its own Hosting release, and sequential releases can race (see
 * HostingBatch).
 */
export async function deployFileToHosting(
    siteId: string,
    filePath: string,
    htmlContent: string,
    collectionName: string,
    docId: string,
): Promise<void> {
    await deployBatchToHosting(
        siteId,
        new HostingBatch().add(filePath, htmlContent),
        collectionName,
        docId,
    );
}

/**
 * Removes a single file from Firebase Hosting by creating a new version
 * without that file in the hash map.
 *
 * Does NOT write deployment logs — the caller handles logging if needed.
 */
export async function removeFileFromHosting(
    siteId: string,
    filePath: string,
): Promise<void> {
    siteId = siteId || process.env.GCLOUD_PROJECT || '';

    // Step 1: Auth
    const token = await getAuthToken();

    // Step 2: Get latest release
    const releasesData = await apiFetch(
        `${API_BASE}/sites/${siteId}/releases?pageSize=1`,
        token,
        { method: 'GET' },
    );
    const currentVersionName = releasesData.releases?.[0]?.version?.name;
    if (!currentVersionName) return; // nothing to remove from

    // Step 3: Get current version files
    const filesData = await apiFetch(
        `${API_BASE}/${currentVersionName}/files`,
        token,
        { method: 'GET' },
    );
    const fileHashes: Record<string, string> = {};
    for (const f of filesData.files || []) {
        fileHashes[f.path] = f.hash;
    }

    // Check if file exists
    if (!fileHashes[filePath]) {
        return; // file not in current version, nothing to remove
    }

    // Step 4: Remove file from hash map
    delete fileHashes[filePath];

    // Step 5: Get current version config
    const versionData = await apiFetch(
        `${API_BASE}/${currentVersionName}`,
        token,
        { method: 'GET' },
    );
    const currentConfig = versionData.config || {};

    // Step 6: Create new version
    const newVersion = await apiFetch(
        `${API_BASE}/sites/${siteId}/versions`,
        token,
        { method: 'POST', body: JSON.stringify({ config: currentConfig }) },
    );
    const newVersionName = newVersion.name;

    // Step 7: Populate files (without removed file)
    await apiFetch(
        `${API_BASE}/${newVersionName}:populateFiles`,
        token,
        { method: 'POST', body: JSON.stringify({ files: fileHashes }) },
    );

    // Step 8: Finalize
    await apiFetch(
        `${API_BASE}/${newVersionName}?updateMask=status`,
        token,
        { method: 'PATCH', body: JSON.stringify({ status: 'FINALIZED' }) },
    );

    // Step 9: Release
    await apiFetch(
        `${API_BASE}/sites/${siteId}/releases?versionName=${newVersionName}`,
        token,
        { method: 'POST', body: JSON.stringify({}) },
    );
}

