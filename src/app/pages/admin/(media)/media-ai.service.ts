/**
 * The Media Manager's "Create with AI" tab talks to the server here (specs/ai-media-spec.md,
 * AM-D21 to AM-D26; docs/features/media.html): whether the tab is offered, the estimate
 * before Generate, the pictures, and each picture's bytes through the admin-only readAiFile
 * (so the bucket's CORS setup does not matter).
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { doc, Firestore, getDoc } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../../core/config/arc-functions';
import { isOn } from '../../../core/features/features';
import { base64Blob, type AiImageAbilities } from '../(settings)/ai/ai-settings.service';

/** Arc's own purpose for the tab (AM-D20). */
export const MEDIA_IMAGE_PURPOSE = 'arc-media-image';

export type MediaAiAspect = '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16' | '21:9';
export const MEDIA_AI_ASPECTS: MediaAiAspect[] = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'];

/** What a caller may preset in the tab (MediaDialogData.ai, AM-D24); the admin can change every one. */
export interface MediaAiPreset {
    /** An app purpose with `makes: 'image'` and `mediaManager: true`, for its house style. */
    purpose?: string;
    prompt?: string;
    negativePrompt?: string;
    /** `connection/model`, such as `openai/gpt-image-2`. */
    model?: string;
    quality?: 'low' | 'medium' | 'high';
    count?: number;
    aspect?: MediaAiAspect;
    resolution?: 'standard' | 'high';
    seed?: number;
}

export interface MediaAiImage {
    aspect?: MediaAiAspect;
    resolution?: 'standard' | 'high';
    quality?: 'low' | 'medium' | 'high';
    count?: number;
    seed?: number;
    negativePrompt?: string;
}

export interface MediaAiModel {
    connection: string;
    model: string;
    label: string;
    unit: string;
    image: AiImageAbilities | null;
    testedLive: boolean;
}

export interface MediaAiInfo {
    purpose: { id: string; label: string; enabled: boolean; house: boolean };
    test: boolean;
    models: MediaAiModel[];
    estimate: { usd: number; about: boolean; priced: boolean; amount: number; unit: string } | null;
    allowance: { perDay: number; used: number; left: number } | null;
    budget: { monthlyUsd: number; spent: number; left: number };
}

export interface MediaAiRequest {
    purpose?: string;
    prompt: string;
    model?: { connection: string; model: string };
    image: MediaAiImage;
    /** A library picture's id, for Edit with AI (AM-D26). */
    editOf?: string;
}

export interface MediaAiFile {
    path: string;
    mimeType: string;
    bytes: number;
    width: number | null;
    height: number | null;
}

export type MediaAiResult =
    | { ok: true; files: MediaAiFile[]; recordId: string | null; purpose: string; model: { connection: string; model: string }; settings: MediaAiImage; costUsd: number; test: boolean }
    | { ok: false; reason: string; scope?: 'key' | 'budget'; wait?: number; detail: string; recordId?: string | null };

/** What a library picture made in the tab says of itself (AM-D25), on its `media` document. */
export interface MediaAiNote {
    prompt: string;
    negativePrompt?: string;
    model: string;
    connection: string;
    settings: MediaAiImage;
    costUsd: number;
    createdAt: Date;
    createdBy: string;
    recordId: string | null;
    purpose: string;
    /** The library picture it was made from, for Edit with AI. */
    editOf?: string;
}

/** The title a picture made in the tab starts with: the prompt's first words (AM-D25). */
export function titleFromPrompt(prompt: string, words = 8): string {
    const all = prompt.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    const title = all.slice(0, words).join(' ');
    return (all.length > words ? `${title}...` : title).slice(0, 120);
}

/** A file name from the prompt: plain letters and digits, so the upload's own name is clean. */
export function fileNameFromPrompt(prompt: string, mimeType: string): string {
    const base = prompt.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'ai-picture';
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    return `${base}.${ext}`;
}

@Injectable({ providedIn: 'root' })
export class MediaAiService {
    private readonly firestore = inject(Firestore);
    private readonly injector = inject(Injector);

    /** Looked up when a call is made, so a page that only checks whether the tab is offered needs no Functions. */
    private get functions(): Functions {
        return this.injector.get(Functions);
    }

    private inCtx<T>(fn: () => Promise<T>): Promise<T> {
        return runInInjectionContext(this.injector, fn);
    }

    /**
     * Whether the tab is offered: the ai feature on, and a picture list in Settings, AI (the
     * default one, or the purpose's own) with a model in it (AM-D21). A read that fails hides it.
     */
    async available(purpose: string = MEDIA_IMAGE_PURPOSE): Promise<boolean> {
        if (!isOn('ai')) return false;
        try {
            const snap = await this.inCtx(() => getDoc(doc(this.firestore, 'Settings', 'ai')));
            const data = (snap.data() ?? {}) as Record<string, any>;
            const has = (list: unknown) => Array.isArray(list) && list.some((r) => r && typeof r.model === 'string' && r.model && data['connections']?.[r.connection]);
            return has(data['lists']?.['image']) || has(data['purposes']?.[purpose]?.['models']);
        } catch {
            return false;
        }
    }

    async info(request: Omit<MediaAiRequest, 'prompt'> & { prompt?: string }): Promise<MediaAiInfo> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'generateMediaImages', { timeout: 60_000 })({ ...request, estimate: true }));
        return result.data as MediaAiInfo;
    }

    async generate(request: MediaAiRequest): Promise<MediaAiResult> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'generateMediaImages', { timeout: 310_000 })(request));
        return result.data as MediaAiResult;
    }

    /** A picture the tab made, as bytes (AM-D22). */
    async read(path: string): Promise<Blob> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'readAiFile', { timeout: 70_000 })({ path }));
        const { data, contentType } = result.data as { data: string; contentType: string };
        return base64Blob(data, contentType);
    }
}
