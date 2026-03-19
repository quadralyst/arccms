import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

const API_BASE = 'https://firebasehosting.googleapis.com/v1beta1';

// ─── Private Helpers (mirrored from deployToHosting.ts) ─────────────────────

async function getAuthToken(): Promise<string> {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const tokenResult = await client.getAccessToken();
    if (!tokenResult.token) {
        throw new Error('Could not authenticate with Firebase Hosting API');
    }
    return tokenResult.token;
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
        throw new Error(`Hosting API error ${res.status}: ${text}`);
    }
    return res.json();
}

function gzipAndHash(content: string): { gzipped: Buffer; hash: string } {
    const gzipped = zlib.gzipSync(Buffer.from(content, 'utf-8'), { level: 9 });
    const hash = crypto.createHash('sha256').update(gzipped).digest('hex');
    return { gzipped, hash };
}

// ─── Exported Function ──────────────────────────────────────────────────────

/**
 * Deploys a single file to Firebase Hosting without Firestore status tracking.
 *
 * Used for SEO files (robots.txt, sitemap.xml, RSS feeds) that are not tied
 * to a specific Firestore content document and don't need deployment logs.
 *
 * Follows the same hosting API pipeline as deployToHosting.ts but skips
 * the Firestore DeploymentLog and status update steps.
 */
export async function deploySeoFileToHosting(
    filePath: string,
    fileContent: string,
): Promise<void> {
    const siteId = process.env.GCLOUD_PROJECT || '';

    // Step 1: Auth
    const token = await getAuthToken();

    // Step 2: Get latest release
    const releasesData = await apiFetch(
        `${API_BASE}/sites/${siteId}/releases?pageSize=1`,
        token,
        { method: 'GET' },
    );
    const currentVersionName = releasesData.releases?.[0]?.version?.name;

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

    // Step 5: Gzip + hash
    const { gzipped, hash } = gzipAndHash(fileContent);
    fileHashes[filePath] = hash;

    // Step 6: Create new version
    const newVersion = await apiFetch(
        `${API_BASE}/sites/${siteId}/versions`,
        token,
        { method: 'POST', body: JSON.stringify({ config: currentConfig }) },
    );
    const newVersionName = newVersion.name;

    // Step 7: Populate files
    const populateResult = await apiFetch(
        `${API_BASE}/${newVersionName}:populateFiles`,
        token,
        { method: 'POST', body: JSON.stringify({ files: fileHashes }) },
    );
    const uploadRequiredHashes: string[] = populateResult.uploadRequiredHashes || [];
    const uploadUrl: string = populateResult.uploadUrl || '';

    // Step 8: Upload (conditional — API tells us if content already exists)
    if (uploadRequiredHashes.includes(hash)) {
        const uploadRes = await fetch(`${uploadUrl}/${hash}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/octet-stream',
            },
            body: new Uint8Array(gzipped),
        });
        if (!uploadRes.ok) {
            const text = await uploadRes.text();
            throw new Error(`Upload failed ${uploadRes.status}: ${text}`);
        }
    }

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
}
