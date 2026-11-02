/**
 * Admin: pictures for the Media Manager's "Create with AI" tab (specs/ai-media-spec.md,
 * AM-D21, AM-D22, AM-D24, AM-D26; docs/features/media.html). Asks Arc's own purpose
 * `arc-media-image`, or an app purpose with `mediaManager: true`, never any other. The
 * pictures stay in `ai-files/` (never the purpose's `saveTo`) until the admin saves one to
 * the library, which the page does as an ordinary upload; the page reads them through
 * readAiFile.
 *
 * With `estimate: true` it makes nothing: it answers the picture models the tab may use, with
 * what each makes and takes, the price-list estimate for the settings given, the admin's
 * pictures left today and the month's budget, so the tab can say all three before Generate.
 *
 * With `editOf` (a library picture's id), that picture goes with the prompt to a model that
 * edits (Edit with AI, AM-D26), always through `arc-media-image`.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { arcStoragePrefix } from '../../arc-config.js';
import { db } from '../../init.js';
import { requireAdmin } from '../../search/auth.js';
import { USER_RECORD_CLAIM } from '../../users/claims.js';
import { askAiForArc } from '../askAi.js';
import { estimateFor, purposeModels } from '../estimate.js';
import { isAspect } from '../images.js';
import { allowanceUsed, monthSpent } from '../limits.js';
import { findPurpose, MEDIA_IMAGE_PURPOSE, MAX_PICTURES } from '../purposes.js';
import { modelInfo, purposeSettings, readAiSettings, type AiModelRef } from '../settings.js';
import type { AiImageSettings, AiPurpose } from '../types.js';

export const MAX_PROMPT_CHARS = 2000;

/** The purpose a tab may ask: Arc's own, or an app's that offers itself to the Media Manager. */
export function mediaPurpose(id: unknown): { id: string; purpose: AiPurpose } {
    const purposeId = typeof id === 'string' && id ? id : MEDIA_IMAGE_PURPOSE;
    const purpose = findPurpose(purposeId, { arc: true });
    if (!purpose || purpose.makes !== 'image' || (purposeId !== MEDIA_IMAGE_PURPOSE && purpose.mediaManager !== true)) {
        throw new HttpsError('invalid-argument', `"${purposeId}" is not a purpose the Media Manager can use: it needs makes: 'image' and mediaManager: true.`);
    }
    return { id: purposeId, purpose };
}

/** The tab's settings, checked: anything else is dropped rather than trusted. */
export function tabImage(raw: unknown): AiImageSettings {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const image: AiImageSettings = {};
    if (isAspect(r['aspect'])) image.aspect = r['aspect'];
    if (r['resolution'] === 'standard' || r['resolution'] === 'high') image.resolution = r['resolution'];
    if (r['quality'] === 'low' || r['quality'] === 'medium' || r['quality'] === 'high') image.quality = r['quality'];
    if (Number.isInteger(r['count']) && (r['count'] as number) >= 1 && (r['count'] as number) <= MAX_PICTURES) image.count = r['count'] as number;
    if (Number.isInteger(r['seed']) && Math.abs(r['seed'] as number) <= 2_147_483_647) image.seed = r['seed'] as number;
    if (typeof r['negativePrompt'] === 'string' && r['negativePrompt'].trim()) image.negativePrompt = r['negativePrompt'].trim().slice(0, 1000);
    return image;
}

function modelRef(raw: unknown): AiModelRef | null {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return typeof r['connection'] === 'string' && typeof r['model'] === 'string' && r['connection'] && r['model'] ? { connection: r['connection'], model: r['model'] } : null;
}

/** The largest stored size of a library picture, to send for an edit. */
async function libraryPicture(mediaId: unknown): Promise<string> {
    if (typeof mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) throw new HttpsError('invalid-argument', 'Choose a picture in the library to edit.');
    const snap = await db.collection('media').doc(mediaId).get();
    const variants = (snap.data()?.['variants'] ?? {}) as Record<string, { path?: unknown }>;
    const path = ['xl', 'l', 'm', 's'].map((s) => variants[s]?.path).find((p): p is string => typeof p === 'string' && !!p);
    if (!snap.exists || !path) throw new HttpsError('failed-precondition', 'This picture cannot be edited: it has no stored sizes (a GIF, or an upload from before sizes existed).');
    // Editors write media documents, so the path is checked: only the library's own images
    // are read with the functions' rights, never another file in the bucket.
    const folder = `${arcStoragePrefix()}mediaImages/`;
    if (!path.startsWith(folder) || path.split('/').some((s) => s === '..' || s === '.' || s === '')) throw new HttpsError('failed-precondition', 'This picture cannot be edited: it is not in the media library\'s folder.');
    return path;
}

export const generateMediaImages = onCall({ timeoutSeconds: 300, memory: '1GiB' }, async (request) => {
    await requireAdmin(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const editing = data['editOf'] !== undefined && data['editOf'] !== null;
    // An edit always goes through Arc's own purpose, which takes a picture (AM-D26).
    const { id: purposeId, purpose } = mediaPurpose(editing ? MEDIA_IMAGE_PURPOSE : data['purpose']);
    const token = (request.auth?.token ?? {}) as Record<string, unknown>;
    const limitKey = typeof token[USER_RECORD_CLAIM] === 'string' && token[USER_RECORD_CLAIM] ? String(token[USER_RECORD_CLAIM]) : request.auth!.uid;
    const settings = await readAiSettings();
    const ps = purposeSettings(settings, purposeId);
    const image = { ...purpose.image, ...tabImage(data['image']) };
    const models = purposeModels(settings, purposeId, purpose)
        // Edit with AI offers only models that edit.
        .filter((ref) => !editing || modelInfo(settings, ref).image?.edit === true);
    const asked = modelRef(data['model']);
    const ref = asked && models.some((m) => m.connection === asked.connection && m.model === asked.model) ? asked : models[0] ?? null;
    if (asked && ref !== asked) throw new HttpsError('invalid-argument', 'That model is not in this purpose\'s picture list.');

    if (data['estimate'] === true) {
        const perDay = purpose.perKeyPerDay === undefined ? null : ps.perKeyPerDay ?? purpose.perKeyPerDay;
        const [used, spent] = await Promise.all([perDay === null ? 0 : allowanceUsed(purposeId, limitKey), monthSpent()]);
        const prompt = typeof data['prompt'] === 'string' ? data['prompt'] : '';
        return {
            purpose: { id: purposeId, label: purpose.label, enabled: ps.enabled, house: !!purpose.instruction?.trim() },
            test: settings.mode === 'test',
            models: models.map((m) => {
                const info = modelInfo(settings, m);
                return { ...m, label: settings.connections[m.connection]?.label ?? m.connection, unit: info.unit, image: info.image ?? null, testedLive: info.testedLive };
            }),
            estimate: ref ? estimateFor(modelInfo(settings, ref), 'image', { image }, prompt.length) : null,
            allowance: perDay === null ? null : { perDay, used, left: Math.max(0, perDay - used) },
            budget: { monthlyUsd: settings.budget.monthlyUsd, spent, left: Math.max(0, settings.budget.monthlyUsd - spent) },
        };
    }

    const prompt = typeof data['prompt'] === 'string' ? data['prompt'].trim() : '';
    if (!prompt) throw new HttpsError('invalid-argument', 'Say what the picture should show.');
    if (prompt.length > MAX_PROMPT_CHARS) throw new HttpsError('invalid-argument', `The prompt is longer than ${MAX_PROMPT_CHARS} characters.`);
    if (!ref) return { ok: false, reason: 'off', detail: editing ? 'no model in the picture list edits pictures' : 'no picture model is set in Settings, AI' };
    const input = editing ? [prompt, { storagePath: await libraryPicture(data['editOf']) }] : prompt;
    const r = await askAiForArc(
        { purpose: purposeId, input, limitKey, image, ref: editing ? `media/${String(data['editOf'])}` : undefined },
        { only: ref, ignoreSaveTo: true },
    );
    if (r.ok !== true) {
        return { ok: false, reason: r.reason, ...(r.scope ? { scope: r.scope } : {}), ...(r.wait ? { wait: r.wait } : {}), detail: (r.detail ?? '').slice(0, 300), recordId: r.recordId };
    }
    return {
        ok: true,
        files: (r.files ?? []).map((f) => ({ path: f.path, mimeType: f.mimeType, bytes: f.bytes, width: f.width ?? null, height: f.height ?? null })),
        recordId: r.recordId,
        purpose: purposeId,
        model: ref,
        // What the model was asked with, such as the nearest shape it makes, for the "Made with AI" note.
        settings: r.image ? { ...r.image, format: undefined } : image,
        costUsd: r.usage.costUsd,
        test: r.usage.test,
    };
});
