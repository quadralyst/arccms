/**
 * IndexNow (docs/discoverability-spec.md, D-D9): after a publish, tell Bing
 * (which feeds ChatGPT search and Copilot) and the other IndexNow engines
 * which URLs changed. One POST per publish batch; fire-and-forget, logged,
 * never thrown into the publish path.
 *
 * The site proves ownership with a key file at `/{key}.txt` whose body is
 * the key. The key is generated once and stored in Settings/discoverability.
 */
import * as crypto from 'node:crypto';
import { db } from '../init.js';
import { getDiscoverabilitySettings, clearDiscoverabilityCache } from '../shared/discoverability-settings.js';
import { getSiteConfig } from '../shared/site-settings.js';
import type { HostingBatch } from './deployToHosting.js';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** 32 hex characters: within IndexNow's 8 to 128 range, unguessable. */
export function generateIndexNowKey(): string {
    return crypto.randomBytes(16).toString('hex');
}

export function keyFilePath(key: string): string {
    return `/${key}.txt`;
}

/**
 * Hosting file paths from a batch → public URLs worth submitting. Only HTML
 * pages count (the Markdown twins are discovered through the pages); a list
 * index maps to its directory URL because Hosting has cleanUrls on.
 */
export function urlsForIndexNow(baseUrl: string, addedPaths: string[], removedPaths: string[]): string[] {
    const base = baseUrl.replace(/\/+$/, '');
    const seen = new Set<string>();
    for (const path of [...addedPaths, ...removedPaths]) {
        if (!path.endsWith('.html')) continue;
        if (path === '/__shell.html' || path.startsWith('/pages/')) continue;
        const clean = path.endsWith('/index.html')
            ? path.slice(0, -'/index.html'.length) || '/'
            : path.slice(0, -'.html'.length);
        seen.add(`${base}${clean}`);
    }
    return [...seen];
}

/**
 * Makes sure a key exists, returning it, and (when a batch is given) queues
 * the key file so it is served from the same release as the pages.
 */
export async function ensureIndexNowKey(batch?: HostingBatch): Promise<string> {
    const settings = await getDiscoverabilitySettings();
    let key = settings.indexNow.key;
    if (!key) {
        key = generateIndexNowKey();
        await db.doc('Settings/discoverability').set({ indexNow: { enabled: settings.indexNow.enabled, key } }, { merge: true });
        clearDiscoverabilityCache();
    }
    if (batch) batch.add(keyFilePath(key), key);
    return key;
}

export interface IndexNowResult {
    submitted: number;
    status?: number;
    skipped?: 'disabled' | 'no-urls' | 'no-base-url';
}

/**
 * Submits the URLs. Any failure is logged and reported in the result; the
 * caller's publish has already succeeded and must stay that way.
 */
export async function submitToIndexNow(urls: string[]): Promise<IndexNowResult> {
    if (!urls.length) return { submitted: 0, skipped: 'no-urls' };
    const settings = await getDiscoverabilitySettings();
    if (!settings.indexNow.enabled) return { submitted: 0, skipped: 'disabled' };

    const siteConfig = await getSiteConfig();
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(baseUrl)) return { submitted: 0, skipped: 'no-base-url' };
    const host = new URL(baseUrl).host;
    const key = await ensureIndexNowKey();

    // IndexNow accepts at most 10,000 URLs per call; a publish is far below that.
    const body = {
        host,
        key,
        keyLocation: `${baseUrl}${keyFilePath(key)}`,
        urlList: urls.slice(0, 10000),
    };

    try {
        const res = await fetch(INDEXNOW_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(body),
        });
        // 200 and 202 both mean accepted; 4xx means the key or host is wrong.
        if (res.status === 200 || res.status === 202) {
            console.log(`IndexNow: ${res.status}, submitted ${body.urlList.length} URL(s) for ${host}`);
        } else {
            console.error(`IndexNow: ${res.status} for ${host}: ${(await res.text()).slice(0, 200)}`);
        }
        return { submitted: body.urlList.length, status: res.status };
    } catch (error) {
        console.error('IndexNow submission failed:', error);
        return { submitted: 0 };
    }
}

/**
 * The publish-path entry point: maps a released batch to URLs and submits
 * them. Everything, including the settings and site reads, is inside its
 * own guard: the release has already succeeded and nothing here may undo
 * that impression in the logs or the queue.
 */
export async function submitBatchToIndexNow(addedPaths: string[], removedPaths: string[]): Promise<IndexNowResult> {
    try {
        const siteConfig = await getSiteConfig();
        const urls = urlsForIndexNow(siteConfig.baseUrl, addedPaths, removedPaths);
        return await submitToIndexNow(urls);
    } catch (error) {
        console.error('IndexNow submission skipped:', error);
        return { submitted: 0 };
    }
}
