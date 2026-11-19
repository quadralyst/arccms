import type * as cheerio from 'cheerio';
import { loadHtml } from './lazy-cheerio.js';

/**
 * Custom fields placed in the text (specs/visual-editing-spec.md, VE-D28).
 *
 * The body holds a marker, `<div data-arc-place="{field key}"></div>`, where an
 * editor typed `/` and chose the field. The field shows there instead of where
 * the template puts it, in the template's own markup:
 *
 *  1. prepareFieldPlaces, before the template is filled, tags the template's
 *     block for each placed field (`data-arc-block-of`). The block is the
 *     outermost element that shows only with the field (`data-arc-if`), else
 *     its loop, else the element it fills; the field's stored key and its bare
 *     name both count, as everywhere in templates. A template with no block for
 *     the field gets a plain one at the end (FIELD_BLOCKS).
 *  2. The template is filled as usual.
 *  3. moveFieldBlocks, after, moves each tagged block into its marker. A marker
 *     whose block was dropped (the field is empty) goes too.
 *
 * Source of truth: src/app/core/utils/field-places.ts (the app places the same
 * fields). Keep in sync manually; src/app/core/utils/field-places.spec.ts
 * checks it.
 */

export const PLACE_ATTR = 'data-arc-place';
export const BLOCK_OF_ATTR = 'data-arc-block-of';

/** A field the body places: its stored key and type. */
export interface PlacedField {
    key: string;
    type: string;
}

/** The plain block for each field type that can be placed, for a template that has none; `K` is the field's key. */
const FIELD_BLOCKS: Record<string, (k: string) => string> = {
    faq: (k) => `<section class="arc-faq" data-arc-if="${k}"><h3 class="arc-faq-heading" data-arc-if="${k}_heading" data-arc-bind="${k}_heading"></h3>`
        + `<div class="arc-faq-list" data-arc-loop="${k}"><details class="arc-faq-item"><summary data-arc-bind="question"></summary>`
        + `<div class="arc-faq-answer" data-arc-bind="answer_html"></div></details></div></section>`,
    infocard: (k) => `<div class="arc-info-cards" data-arc-if="${k}" data-arc-loop="${k}"><div class="arc-info-card"><span class="arc-info-card-visual">`
        + `<img data-arc-if="image" data-arc-bind="image" alt=""><i data-arc-if="icon" class="{{ icon }}" aria-hidden="true"></i></span>`
        + `<h3 class="arc-info-card-headline" data-arc-bind="headline"></h3><p class="arc-info-card-info" data-arc-bind="info"></p></div></div>`,
    gallery: (k) => `<div class="arc-gallery" data-arc-if="${k}" data-arc-loop="${k}"><figure class="arc-gallery-item">`
        + `<img data-arc-if="image" data-arc-bind="image" alt=""><button data-arc-if="video_thumb" type="button" class="arc-gallery-video" data-embed="{{ video_embed }}">`
        + `<img data-arc-bind="video_thumb" alt=""><span class="arc-gallery-play" aria-hidden="true">&#9654;</span></button>`
        + `<figcaption data-arc-if="caption" data-arc-bind="caption"></figcaption></figure></div>`,
    labelvalue: (k) => `<section class="arc-glance" data-arc-if="${k}"><h3 class="arc-glance-heading" data-arc-if="${k}_heading" data-arc-bind="${k}_heading"></h3>`
        + `<dl class="arc-glance-list" data-arc-loop="${k}"><div class="arc-glance-row"><dt data-arc-bind="label"></dt><dd data-arc-bind="value"></dd></div></dl></section>`,
    maplocation: (k) => `<section class="arc-locations" data-arc-if="${k}"><h3 class="arc-locations-heading" data-arc-if="${k}_heading" data-arc-bind="${k}_heading"></h3>`
        + `<div class="arc-locations-grid" data-arc-loop="${k}"><article class="arc-location">`
        + `<iframe data-arc-if="map_embed" data-arc-bind="map_embed" loading="lazy" title="Map"></iframe><h4 data-arc-bind="label"></h4>`
        + `<p data-arc-bind="address"></p><a data-arc-if="map_directions" data-arc-bind="map_directions" target="_blank" rel="noopener">Get directions</a>`
        + `</article></div></section>`,
    image: (k) => `<figure class="arc-field-image" data-arc-if="${k}"><img data-arc-bind="${k}" alt=""></figure>`,
    file: (k) => `<ul class="arc-field-files" data-arc-if="${k}" data-arc-loop="${k}"><li><a href="{{ url }}" target="_blank" rel="noopener">{{ title }}</a> `
        + `<span class="arc-field-file-meta">{{ type }} {{ size }}</span></li></ul>`,
    richtext: (k) => `<div class="arc-field-text" data-arc-if="${k}" data-arc-bind="${k}"></div>`,
};

/** The field keys the body places, in order, each once. */
export function placedFieldKeys(bodyHtml: unknown): string[] {
    if (typeof bodyHtml !== 'string' || !bodyHtml.includes(PLACE_ATTR)) return [];
    const keys: string[] = [];
    for (const match of bodyHtml.matchAll(/data-arc-place="([^"]+)"/g)) {
        if (!keys.includes(match[1])) keys.push(match[1]);
    }
    return keys;
}

/** The placed fields the type has, with their types; a marker for a field the type lacks is left out. */
export function placedFields(bodyHtml: unknown, fields: { key?: string; type?: string }[] | null | undefined): PlacedField[] {
    const keys = placedFieldKeys(bodyHtml);
    if (!keys.length || !fields) return [];
    return keys
        .map((key) => ({ key, type: fields.find((f) => f.key === key)?.type ?? '' }))
        .filter((f) => !!FIELD_BLOCKS[f.type]);
}

/** The names a template may use for a field: its stored key and its bare name. */
function namesOf(key: string, slug: string): string[] {
    const names = [key];
    for (const prefix of slug ? [`${slug}-`, `${slug}_`] : []) {
        if (key.startsWith(prefix) && key.length > prefix.length) names.push(key.slice(prefix.length));
    }
    return names;
}

/** True when the element shows the field through `[attr]="name"`, or `{{ name }}` in an attribute or its own text. */
function boundTo(el: { attribs?: Record<string, string>; children?: { type: string; data?: string }[] }, names: string[]): boolean {
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mustache = (s: string) => escaped.some((n) => new RegExp(`\\{\\{\\s*${n}\\s*(\\|[^}]*)?\\}\\}`).test(s));
    for (const [attr, value] of Object.entries(el.attribs ?? {})) {
        if (attr.startsWith('[') && names.includes(value.trim())) return true;
        if (mustache(value)) return true;
    }
    return (el.children ?? []).some((c) => c.type === 'text' && mustache(c.data ?? ''));
}

function loadLike(html: string): cheerio.CheerioAPI {
    return loadHtml(html, { xmlMode: false }, /<html[\s>]/i.test(html));
}

/**
 * Before the template is filled: tags the template's block for each placed field,
 * adding a plain one at the end for a field the template does not lay out.
 */
export function prepareFieldPlaces(templateHtml: string, fields: PlacedField[], slug = ''): string {
    if (!fields.length) return templateHtml;
    const $ = loadLike(templateHtml);
    // Names inside a loop's row are the row's own fields, not the page's: never the field's block.
    const candidates = $('body *').length ? $('body *') : $('*');
    const pageLevel = candidates.filter((_, el) => $(el).closest('head').length === 0
        && $(el).parents('[data-arc-loop], [data-arc-items-src]').length === 0);
    for (const field of fields) {
        const names = namesOf(field.key, slug);
        // Read off each element's attributes: `[innerHTML]` cannot be written as a selector,
        // and the parser lowercases attribute names.
        const named = (attr: string) => pageLevel.filter((_, el) => names.includes(((el as any).attribs?.[attr] ?? '').trim()));
        const bound = pageLevel.filter((_, el) => boundTo(el as any, names));
        let block = named('data-arc-if').first();
        if (!block.length) block = named('data-arc-loop').first();
        if (!block.length) block = named('data-arc-bind').first();
        if (!block.length) block = bound.first();
        if (block.length) {
            block.attr(BLOCK_OF_ATTR, field.key);
            continue;
        }
        const plain = $(FIELD_BLOCKS[field.type](field.key)).attr(BLOCK_OF_ATTR, field.key);
        const body = $('body');
        if (body.length) body.append(plain);
        else $.root().append(plain);
    }
    return $.html();
}

/** After the template is filled: each tagged block goes into its marker; a marker with no block goes. */
export function moveFieldBlocks(html: string): string {
    if (!html.includes(PLACE_ATTR) && !html.includes(BLOCK_OF_ATTR)) return html;
    const $ = loadLike(html);
    $(`[${PLACE_ATTR}]`).each((_, el) => {
        const marker = $(el);
        const key = marker.attr(PLACE_ATTR) ?? '';
        const block = $(`[${BLOCK_OF_ATTR}]`).filter((__, b) => $(b).attr(BLOCK_OF_ATTR) === key).first();
        // A block that holds the text itself (the template wraps the body in the field's
        // data-arc-if) cannot go inside it: the field stays where the template puts it.
        if (block.length && (block[0] === el || block.find(marker).length)) {
            block.removeAttr(BLOCK_OF_ATTR);
            marker.remove();
            return;
        }
        // Moved once: a second marker for the same field finds nothing and goes.
        if (block.length) marker.empty().append(block.removeAttr(BLOCK_OF_ATTR));
        else marker.remove();
    });
    $(`[${BLOCK_OF_ATTR}]`).removeAttr(BLOCK_OF_ATTR);
    return $.html();
}
