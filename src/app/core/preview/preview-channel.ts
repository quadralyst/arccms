/**
 * The live preview's channel (specs/visual-editing-spec.md, VE-D1, VE-D5, VE-D8).
 *
 * The editor and its preview window are two windows of the same site, so they
 * talk over a BroadcastChannel named for the editor session: no window
 * reference is needed, and either window can reload. The session key travels
 * in the preview's address fragment (`#s=…`), which is never sent to a server.
 *
 *   editor  -> preview   state      the draft as a save would write it, unsaved
 *   preview -> editor    hello      "I am here, send me the state"
 *   preview -> editor    focus      the editor field a click on the page found
 *   editor  -> preview   highlight  the field focused in the editor, outlined on the page
 *   either  -> other     bye        the window is going away
 *
 * Messages are checked on arrival; anything else on the channel is ignored.
 */
import { IContentTranslation } from '../../pages/admin/contents/draft-content-store/content-translation.model';

/** The editor's unsaved state (VE-D2). */
export interface PreviewStateMessage {
    kind: 'state';
    /** buildDraftFormValues() with the entry's id ('' before its first save). */
    draft: Record<string, any>;
    /** The language on the editor's screen, '' for the default language. */
    lang: string;
    /** That language's unsaved values, when it is a translation. */
    translation: IContentTranslation | null;
}

export interface PreviewHelloMessage { kind: 'hello' }
export interface PreviewFocusMessage { kind: 'focus'; key: string; row?: number }
export interface PreviewHighlightMessage { kind: 'highlight'; key: string }
export interface PreviewByeMessage { kind: 'bye'; from: 'editor' | 'preview' }

export type PreviewMessage =
    | PreviewStateMessage
    | PreviewHelloMessage
    | PreviewFocusMessage
    | PreviewHighlightMessage
    | PreviewByeMessage;

/** The tag every message carries, so other traffic is never mistaken for ours. */
const PROTOCOL = 'arc-preview/1';

const isRecord = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/** A field key as the renderer and the editor write it. */
const isKey = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 200;

/** The message in a channel event, or null for anything malformed or unknown. */
export function parsePreviewMessage(data: unknown): PreviewMessage | null {
    if (!isRecord(data) || data['protocol'] !== PROTOCOL || !isRecord(data['message'])) return null;
    const message = data['message'];
    switch (message['kind']) {
        case 'state': {
            if (!isRecord(message['draft']) || typeof message['lang'] !== 'string') return null;
            const translation = message['translation'];
            if (translation !== null && !isRecord(translation)) return null;
            return { kind: 'state', draft: message['draft'], lang: message['lang'], translation: (translation as IContentTranslation | null) ?? null };
        }
        case 'hello':
            return { kind: 'hello' };
        case 'focus': {
            if (!isKey(message['key'])) return null;
            const row = message['row'];
            if (row === undefined) return { kind: 'focus', key: message['key'] };
            if (!Number.isInteger(row) || row < 0) return null;
            return { kind: 'focus', key: message['key'], row };
        }
        case 'highlight':
            return isKey(message['key']) ? { kind: 'highlight', key: message['key'] } : null;
        case 'bye':
            return message['from'] === 'editor' || message['from'] === 'preview'
                ? { kind: 'bye', from: message['from'] }
                : null;
        default:
            return null;
    }
}

/** The message as it goes on the channel. */
export function wrapPreviewMessage(message: PreviewMessage): { protocol: string; message: PreviewMessage } {
    return { protocol: PROTOCOL, message };
}

/** The live preview's address, under /admin but drawn as the public site (VE-D3). */
export function isPreviewUrl(url: string): boolean {
    return /^\/admin\/preview(\/|$|\?|#)/.test(url || '');
}

/** The channel's name for a session key. */
export function previewChannelName(sessionKey: string): string {
    return `arc-preview:${sessionKey}`;
}

/** One window per entry (VE-D5): pressing Preview again brings the same window forward. */
export function previewWindowName(type: string, id: string): string {
    return `arc-preview-${type}-${id || 'new'}`;
}

/** The preview's address: `new` as the id before the first save, the session key in the fragment. */
export function previewUrl(type: string, id: string, sessionKey: string): string {
    return `/admin/preview/${encodeURIComponent(type)}/${encodeURIComponent(id || 'new')}#s=${encodeURIComponent(sessionKey)}`;
}

/**
 * The editor session's key. A saved entry's is its type and id, so an editor
 * opened again on the entry finds a preview window left open; a new entry's is
 * made up, so two editors of new entries never share one.
 */
export function previewSessionKey(type: string, id: string, random: () => string = randomKey): string {
    return id ? `${type}.${id}` : `${type}.new.${random()}`;
}

function randomKey(): string {
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues?.(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') || String(Date.now());
}

/** The session key in a preview address fragment (`s=…`), or ''. */
export function sessionKeyFromFragment(fragment: string | null | undefined): string {
    const text = (fragment || '').replace(/^#/, '');
    for (const part of text.split('&')) {
        const [name, value] = part.split('=');
        if (name === 's' && value) {
            try {
                return decodeURIComponent(value);
            } catch {
                return '';
            }
        }
    }
    return '';
}

/**
 * The BroadcastChannel, wrapped: posts are tagged, arrivals are checked, and a
 * browser without BroadcastChannel (or a server render) gets a channel that
 * does nothing.
 */
export class PreviewChannel {
    private channel: BroadcastChannel | null = null;

    constructor(sessionKey: string, onMessage: (message: PreviewMessage) => void) {
        if (typeof BroadcastChannel === 'undefined' || !sessionKey) return;
        this.channel = new BroadcastChannel(previewChannelName(sessionKey));
        this.channel.onmessage = (event: MessageEvent) => {
            const message = parsePreviewMessage(event.data);
            if (message) onMessage(message);
        };
    }

    post(message: PreviewMessage): void {
        try {
            this.channel?.postMessage(wrapPreviewMessage(message));
        } catch (error) {
            // A value that cannot be cloned must not break the editor.
            console.warn('[preview] could not send', message.kind, error);
        }
    }

    close(): void {
        this.channel?.close();
        this.channel = null;
    }
}

/** What a marked key on the page is in the editor (VE-D8). */
export interface PreviewFieldTarget {
    /** The editor's field: a built-in name (title, content, ...) or a custom field's key. */
    field: string;
    builtin: boolean;
}

/** The entry's own fields a template can place, by the name the editor gives them. */
const BUILTIN_FIELDS = new Set([
    'title', 'content', 'summary', 'coverImage', 'tags', 'tagsWithColors',
    'seoTitle', 'metaDescription', 'canonicalUrl', 'references', 'authorName', 'author', 'layout',
]);

/** Built-ins a template names another way. */
const BUILTIN_ALIASES: Record<string, string> = { tagsWithColors: 'tags', author: 'authorId', authorName: 'authorId' };

/**
 * The editor field behind a key the renderer marked: the key itself, the
 * custom field it is an unprefixed alias of, or the field a derived binding
 * comes from (`coverImage_m`, `video_embed`, `brand_rgb_values`). Null for a
 * value the site works out (dates, share links, related entries).
 */
export function resolvePreviewField(key: string, type: { slug: string; fields?: { key: string }[] } | null): PreviewFieldTarget | null {
    if (!key || key.includes('.') || !type) return null;
    const custom = new Set((type.fields || []).map((f) => f.key));
    const prefixes = [`${type.slug}-`, `${type.slug}_`];
    let candidate = key;
    // A derived binding is the field's key with one or two suffixes.
    for (let strip = 0; strip < 3 && candidate; strip++) {
        if (custom.has(candidate)) return { field: candidate, builtin: false };
        for (const prefix of prefixes) {
            if (custom.has(prefix + candidate)) return { field: prefix + candidate, builtin: false };
        }
        if (BUILTIN_FIELDS.has(candidate)) return { field: BUILTIN_ALIASES[candidate] ?? candidate, builtin: true };
        const cut = candidate.lastIndexOf('_');
        if (cut <= 0) break;
        candidate = candidate.slice(0, cut);
    }
    return null;
}
