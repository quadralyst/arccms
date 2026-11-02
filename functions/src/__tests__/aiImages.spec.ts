/**
 * Pictures fitted to each model (specs/ai-media-spec.md, AM-D19, AM-D4, AM-D5) and the
 * estimate before a call (AM-D6, AM-D21): the nearest shape, high falling back to standard,
 * a quality only where the model takes one, a seed, a negative prompt or an edit skipping a
 * model that cannot take it, and the price per picture by quality or resolution.
 */
import { describe, expect, it } from 'vitest';
import { estimateFor } from '../ai/estimate.js';
import { fittedImage, imageSkip, nearestAspect, picturePrice, tokensPerPicture } from '../ai/images.js';
import type { AiImageAbilities } from '../ai/presets.js';
import { modelInfo, resolveAiSettings, type AiModelInfo } from '../ai/settings.js';

const OPENAI_LIKE: AiImageAbilities = {
    aspects: ['1:1', '3:2', '2:3'], resolutions: ['standard', 'high'], qualities: ['low', 'medium', 'high'], maxCount: 4,
    edit: true, formats: ['png', 'jpeg', 'webp'], priceByQuality: { low: 0.006, medium: 0.053, high: 0.211 },
};
const GEMINI_LIKE: AiImageAbilities = {
    aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'], resolutions: ['standard', 'high'], maxCount: 4, edit: true, formats: ['png'],
    priceByResolution: { standard: 0.034, high: 0.05 },
};
const SEEDED: AiImageAbilities = { aspects: ['1:1'], resolutions: ['standard'], maxCount: 2, seed: true, negativePrompt: true, formats: ['jpeg'] };

function info(over: Partial<AiModelInfo>): AiModelInfo {
    return { makes: 'image', unit: 'pictures', reads: [], schema: 'json', currency: 'USD', usdRate: 1, testedLive: false, ...over };
}

describe('nearestAspect', () => {
    it('keeps a shape the model makes, else takes the nearest by ratio', () => {
        expect(nearestAspect('16:9', ['1:1', '16:9'])).toBe('16:9');
        expect(nearestAspect('16:9', ['1:1', '3:2', '2:3'])).toBe('3:2');
        expect(nearestAspect('9:16', ['1:1', '3:2', '2:3'])).toBe('2:3');
        expect(nearestAspect('4:3', ['1:1', '16:9'])).toBe('1:1');
        expect(nearestAspect('21:9', ['1:1', '16:9'])).toBe('16:9');
        // A model with no list takes what is asked.
        expect(nearestAspect('3:4', [])).toBe('3:4');
    });
});

describe('fittedImage', () => {
    it('sends only what the model takes', () => {
        expect(fittedImage({ aspect: '16:9', resolution: 'high', quality: 'high', count: 3, seed: 7, negativePrompt: 'text', format: 'webp' }, OPENAI_LIKE))
            .toEqual({ aspect: '3:2', resolution: 'high', quality: 'high', count: 3, format: 'webp' });
        expect(fittedImage({ aspect: '16:9', resolution: 'high', quality: 'low', format: 'webp' }, GEMINI_LIKE))
            .toEqual({ aspect: '16:9', resolution: 'high', count: 1, format: 'png' });
        expect(fittedImage({ resolution: 'high', count: 4, seed: 7, negativePrompt: 'people' }, SEEDED))
            .toEqual({ aspect: '1:1', resolution: 'standard', count: 2, format: 'jpeg', seed: 7, negativePrompt: 'people' });
    });

    it('starts a model that takes a quality at medium, and caps the count at 4', () => {
        expect(fittedImage({}, OPENAI_LIKE).quality).toBe('medium');
        expect(fittedImage({ count: 9 }, undefined)).toEqual({ count: 4 });
    });
});

describe('imageSkip', () => {
    it('skips a model that lacks a seed, a negative prompt or edits, and lets the rest try', () => {
        expect(imageSkip({ seed: 1 }, OPENAI_LIKE, false)).toBe('takes no seed');
        expect(imageSkip({ negativePrompt: 'text' }, GEMINI_LIKE, false)).toBe('takes no negative prompt');
        expect(imageSkip({ negativePrompt: '   ' }, GEMINI_LIKE, false)).toBeNull();
        expect(imageSkip({}, SEEDED, true)).toBe('edits no pictures');
        expect(imageSkip({ seed: 1, negativePrompt: 'x' }, SEEDED, false)).toBeNull();
        expect(imageSkip({ seed: 1 }, undefined, true)).toBeNull();
    });
});

describe('picturePrice', () => {
    it('prices by quality, else by resolution, else the one price', () => {
        expect(picturePrice(OPENAI_LIKE, undefined, { quality: 'high' })).toBe(0.211);
        expect(picturePrice(GEMINI_LIKE, undefined, { resolution: 'high' })).toBe(0.05);
        expect(picturePrice(GEMINI_LIKE, undefined, {})).toBe(0.034);
        expect(picturePrice(SEEDED, 0.0035, { quality: 'high' })).toBe(0.0035);
        expect(picturePrice(undefined, undefined, {})).toBeUndefined();
        // Priced at its standard size only: a high picture counts its pixels.
        expect(picturePrice({ ...OPENAI_LIKE, highFactor: 4 }, undefined, { quality: 'medium', resolution: 'high' })).toBeCloseTo(0.212, 9);
        expect(picturePrice({ ...GEMINI_LIKE, highFactor: 4 }, undefined, { resolution: 'high' })).toBe(0.05);
    });

    it('gives a typical token figure for a model billed by tokens', () => {
        const tokens: AiImageAbilities = { ...OPENAI_LIKE, tokensPerPicture: { low: 300, medium: 1100, high: 4200 } };
        expect(tokensPerPicture(tokens, { quality: 'high' })).toBe(4200);
        expect(tokensPerPicture(tokens, {})).toBe(1100);
        expect(tokensPerPicture(OPENAI_LIKE, {})).toBeUndefined();
    });
});

describe('the admin\'s price for a picture model', () => {
    it('replaces Arc\'s prices by quality or resolution', () => {
        const settings = resolveAiSettings({ connections: { oa: { preset: 'openai' } }, models: { 'oa/gpt-image-2': { price: 0.02 } } });
        const info = modelInfo(settings, { connection: 'oa', model: 'gpt-image-2' });
        expect(picturePrice(info.image, info.price, { quality: 'high' })).toBe(0.02);
        const plain = modelInfo(resolveAiSettings({ connections: { oa: { preset: 'openai' } } }), { connection: 'oa', model: 'gpt-image-2' });
        expect(picturePrice(plain.image, plain.price, { quality: 'high' })).toBe(0.211);
        expect(picturePrice(info.image, info.price, { quality: 'high', resolution: 'high' })).toBe(0.02);
    });
});

describe('estimateFor', () => {
    it('counts pictures at their price, for the fitted count and quality', () => {
        const e = estimateFor(info({ image: OPENAI_LIKE }), 'image', { image: { quality: 'medium', count: 4 } }, 20);
        expect(e).toMatchObject({ priced: true, about: false, amount: 4, unit: 'pictures' });
        expect(e.usd).toBeCloseTo(0.212, 6);
    });

    it('says about for a model billed by tokens, and not priced without a figure', () => {
        const tokens = info({ unit: 'tokens', priceIn: 30, priceOut: 30, image: { ...OPENAI_LIKE, tokensPerPicture: { medium: 1000 } } });
        const e = estimateFor(tokens, 'image', { image: { count: 2 } }, 40);
        expect(e.about).toBe(true);
        expect(e.usd).toBeCloseTo((2000 * 30 + 10 * 30) / 1e6, 9);
        expect(estimateFor(info({ unit: 'tokens', priceOut: 30, image: OPENAI_LIKE }), 'image', {}, 0)).toMatchObject({ priced: false, usd: 0 });
    });

    it('needs the admin\'s rate for a price in another currency', () => {
        expect(estimateFor(info({ image: GEMINI_LIKE, currency: 'INR', usdRate: null }), 'image', {}, 0)).toMatchObject({ priced: false, usd: 0 });
        expect(estimateFor(info({ image: GEMINI_LIKE, currency: 'INR', usdRate: 0.012 }), 'image', {}, 0).usd).toBeCloseTo(0.034 * 0.012, 9);
    });

    it('prices speech by characters and audio and video by seconds', () => {
        expect(estimateFor(info({ makes: 'speech', unit: 'characters', price: 0.08 }), 'speech', {}, 2500).usd).toBeCloseTo(0.2, 9);
        expect(estimateFor(info({ makes: 'audio', unit: 'seconds', price: 0.002 }), 'audio', { audio: { seconds: 30 } }, 0)).toMatchObject({ amount: 30, unit: 'seconds' });
        expect(estimateFor(info({ makes: 'video', unit: 'seconds', price: 0.1 }), 'video', {}, 0).usd).toBeCloseTo(0.8, 9);
        expect(estimateFor(info({ makes: 'text', unit: 'tokens', priceIn: 1, priceOut: 2 }), 'text', {}, 4000, 500)).toMatchObject({ about: true, amount: 1500 });
    });
});
