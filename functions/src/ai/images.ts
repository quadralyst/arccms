/**
 * Pictures (specs/ai-media-spec.md, AM-D19, AM-D4, AM-D5): one set of words for every
 * provider, fitted to what each model makes before a request. The nearest shape a model
 * makes is used, `high` falls back to `standard` where it makes no more, a quality goes only
 * to a model that takes one, and a seed, a negative prompt or a picture to edit skips a
 * model that cannot take it. Pure, so the page's estimate and the call agree.
 */
import type { AiImageAbilities, AiQuality, AiResolution } from './presets.js';
import { AI_ASPECTS, type AiAspect, type AiImageSettings } from './types.js';

const RATIO: Record<AiAspect, number> = {
    '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '21:9': 21 / 9,
};

/** The shape of `aspects` nearest to `wanted`, by the ratio's logarithm, so 4:3 and 3:4 are as far from 1:1. */
export function nearestAspect(wanted: AiAspect, aspects: readonly AiAspect[]): AiAspect {
    if (!aspects.length || aspects.includes(wanted)) return wanted;
    const target = Math.log(RATIO[wanted]);
    return [...aspects].sort((a, b) => Math.abs(Math.log(RATIO[a]) - target) - Math.abs(Math.log(RATIO[b]) - target))[0];
}

export function isAspect(value: unknown): value is AiAspect {
    return typeof value === 'string' && (AI_ASPECTS as readonly string[]).includes(value);
}

/**
 * The settings a model is asked with: the call's, fitted to the model. A model Arc knows
 * nothing of (the admin's own) is sent the call's settings as they are.
 */
export function fittedImage(image: AiImageSettings = {}, abilities: AiImageAbilities | undefined): AiImageSettings {
    const count = Math.min(4, Math.max(1, image.count ?? 1));
    if (!abilities) return { ...image, count };
    const out: AiImageSettings = { count: Math.min(count, abilities.maxCount) };
    out.aspect = nearestAspect(image.aspect ?? '1:1', abilities.aspects);
    out.resolution = image.resolution === 'high' && abilities.resolutions.includes('high') ? 'high' : 'standard';
    if (abilities.qualities?.length) out.quality = image.quality && abilities.qualities.includes(image.quality) ? image.quality : abilities.qualities.includes('medium') ? 'medium' : abilities.qualities[0];
    out.format = image.format && abilities.formats.includes(image.format) ? image.format : abilities.formats[0];
    if (image.seed !== undefined && abilities.seed) out.seed = image.seed;
    if (image.negativePrompt && abilities.negativePrompt) out.negativePrompt = image.negativePrompt;
    return out;
}

/** Why a picture model cannot take this call, or null (AM-D4): a seed, a negative prompt or an edit it lacks. */
export function imageSkip(image: AiImageSettings = {}, abilities: AiImageAbilities | undefined, editing: boolean): string | null {
    if (!abilities) return null;
    if (editing && !abilities.edit) return 'edits no pictures';
    if (image.seed !== undefined && !abilities.seed) return 'takes no seed';
    if (image.negativePrompt?.trim() && !abilities.negativePrompt) return 'takes no negative prompt';
    return null;
}

/**
 * The price of one picture in the model's currency: by quality, else by resolution, else
 * the one price; undefined when the model has none.
 */
export function picturePrice(abilities: AiImageAbilities | undefined, price: number | undefined, image: AiImageSettings = {}): number | undefined {
    const q = image.quality as AiQuality | undefined;
    const r = (image.resolution ?? 'standard') as AiResolution;
    const byResolution = abilities?.priceByResolution?.[r];
    if (byResolution !== undefined) return byResolution;
    const base = (q && abilities?.priceByQuality?.[q]) ?? price;
    // A model priced at its standard size only: a high picture costs as many times more as its pixels.
    return base !== undefined && r === 'high' && abilities?.highFactor ? base * abilities.highFactor : base;
}

/** About how many output tokens a picture takes, for a model billed by tokens; undefined when Arc has no figure. */
export function tokensPerPicture(abilities: AiImageAbilities | undefined, image: AiImageSettings = {}): number | undefined {
    const table = abilities?.tokensPerPicture;
    if (!table) return undefined;
    return table[(image.quality ?? 'medium') as AiQuality] ?? table.medium ?? Object.values(table)[0];
}

/** A PNG, JPEG or WebP picture's size from its bytes, or null when it cannot be read. */
export function pictureDimensions(bytes: Buffer): { width: number; height: number } | null {
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('latin1', 12, 16) === 'IHDR') {
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        // The first start-of-frame marker holds the size.
        for (let i = 2; i + 9 < bytes.length;) {
            if (bytes[i] !== 0xff) return null;
            const marker = bytes[i + 1];
            const length = bytes.readUInt16BE(i + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
            }
            i += 2 + length;
        }
        return null;
    }
    if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
        const chunk = bytes.toString('latin1', 12, 16);
        if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
        if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
        if (chunk === 'VP8L') {
            const b = bytes.readUInt32LE(21);
            return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
        }
    }
    return null;
}

/** The type of picture bytes, from their first bytes; the provider's word when they say nothing. */
export function pictureMime(bytes: Buffer, said = 'image/png'): string {
    if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return said;
}

/** A picture made from bytes, with its type and size read from them. */
export function madePicture(bytes: Buffer, said?: string): { bytes: Buffer; mimeType: string; width?: number; height?: number } {
    const size = pictureDimensions(bytes);
    return { bytes, mimeType: pictureMime(bytes, said), ...(size ? size : {}) };
}
