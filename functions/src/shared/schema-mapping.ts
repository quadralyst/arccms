/**
 * Turns a content type's schema mapping plus one item into the page's main
 * schema.org node (docs/discoverability-spec.md, D-D12).
 *
 * The Article family is built by `buildArticle` with the chosen subtype.
 * Every other type reads its properties from the custom fields the admin
 * mapped; a property with no mapping, or whose field is empty, is left out.
 * Nothing here invents a value: no placeholder prices, no assumed
 * availability. Pure; mirrored client-side in src/shared/utils/schema-mapping.ts.
 */
import { ArticleInput, PersonInput, SCHEMA_CONTEXT, buildArticle, buildPerson, toIsoDate } from './structured-data.js';
import { ARTICLE_FAMILY, ContentTypeSchema, schemaTypeMeta } from './schema-types.js';
import type { HowToBlock } from './content-blocks.js';

type JsonLd = Record<string, unknown>;

export interface MappedNodeInput {
    /** `ContentType.schema`, possibly undefined for types never configured. */
    schema: ContentTypeSchema | null | undefined;
    /** The item's custom field values, keyed by field key. */
    customFields: Record<string, unknown>;
    /** Everything the Article builder would also get. */
    article: ArticleInput;
    /** Site owner name, used as Product.brand and Service.provider when unmapped. */
    ownerName?: string;
    publisherId?: string;
    /** The first how-to block in the body, for the HowTo page type. */
    howTo?: HowToBlock | null;
}

/** Normalises whatever is stored under `ContentType.schema`; unknown types become Article. */
export function normalizeContentTypeSchema(raw: unknown): ContentTypeSchema {
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const meta = schemaTypeMeta(typeof data['type'] === 'string' ? (data['type'] as string) : '');
    const fields: Record<string, string> = {};
    const stored = data['fields'] && typeof data['fields'] === 'object' ? (data['fields'] as Record<string, unknown>) : {};
    for (const prop of meta?.properties ?? []) {
        const key = stored[prop.key];
        if (typeof key === 'string' && key.trim()) fields[prop.key] = key.trim();
    }
    return { type: meta?.id ?? 'Article', fields };
}

/**
 * The main node for a page. Returns the Article for the Article family (or
 * when the mapped type has nothing to say), otherwise the mapped type.
 */
export function buildMappedNode(input: MappedNodeInput): JsonLd | null {
    const schema = normalizeContentTypeSchema(input.schema);
    if (ARTICLE_FAMILY.includes(schema.type)) {
        return buildArticle({ ...input.article, type: schema.type as ArticleInput['type'] });
    }

    const get = (prop: string): unknown => {
        const fieldKey = schema.fields[prop];
        return fieldKey ? input.customFields?.[fieldKey] : undefined;
    };
    const text = (prop: string) => cleanText(get(prop));
    const num = (prop: string) => toNumber(get(prop));
    const date = (prop: string) => toIsoDate(get(prop) as never);

    const base: JsonLd = {
        '@context': SCHEMA_CONTEXT,
        '@type': schema.type,
        '@id': input.article.url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': input.article.url },
        name: input.article.headline,
    };
    setIf(base, 'description', cleanText(input.article.description));
    setIf(base, 'image', cleanText(input.article.imageUrl));
    setIf(base, 'inLanguage', cleanText(input.article.inLanguage));

    switch (schema.type) {
        case 'Product': {
            setIf(base, 'sku', text('sku'));
            setIf(base, 'category', text('category'));
            const brand = text('brand') || cleanText(input.ownerName);
            if (brand) base['brand'] = { '@type': 'Brand', name: brand };
            const offer = buildOffer(num('price'), text('priceCurrency'), text('url') || input.article.url, {
                availability: availabilityUrl(text('availability')),
            });
            if (offer) base['offers'] = offer;
            return base;
        }
        case 'Service': {
            setIf(base, 'serviceType', text('serviceType'));
            setIf(base, 'areaServed', text('areaServed'));
            if (input.publisherId) base['provider'] = { '@id': input.publisherId };
            const offer = buildOffer(num('price'), text('priceCurrency'), input.article.url);
            if (offer) base['offers'] = offer;
            return base;
        }
        case 'Event': {
            setIf(base, 'startDate', date('startDate'));
            setIf(base, 'endDate', date('endDate'));
            const locationName = text('locationName');
            const locationAddress = text('locationAddress');
            if (locationName || locationAddress) {
                const place: JsonLd = { '@type': 'Place' };
                setIf(place, 'name', locationName);
                setIf(place, 'address', locationAddress);
                base['location'] = place;
            }
            setIf(base, 'eventStatus', eventStatusUrl(text('eventStatus')));
            if (input.publisherId) base['organizer'] = { '@id': input.publisherId };
            const offer = buildOffer(num('price'), text('priceCurrency'), text('ticketUrl') || input.article.url);
            if (offer) base['offers'] = offer;
            return base;
        }
        case 'Person': {
            const person = buildPerson({
                name: input.article.headline,
                url: text('url') || undefined,
                imageUrl: cleanText(input.article.imageUrl) || undefined,
                description: cleanText(input.article.description) || undefined,
                jobTitle: text('jobTitle') || undefined,
            } as PersonInput);
            if (!person) return null;
            person['@context'] = SCHEMA_CONTEXT;
            person['@id'] = input.article.url;
            person['mainEntityOfPage'] = { '@type': 'WebPage', '@id': input.article.url };
            const affiliation = text('affiliation');
            if (affiliation) person['worksFor'] = { '@type': 'Organization', name: affiliation };
            setIf(person, 'email', text('email'));
            return person;
        }
        case 'Recipe': {
            setIf(base, 'prepTime', minutesToDuration(num('prepTime')));
            setIf(base, 'cookTime', minutesToDuration(num('cookTime')));
            const total = (num('prepTime') ?? 0) + (num('cookTime') ?? 0);
            if (total > 0) base['totalTime'] = minutesToDuration(total);
            setIf(base, 'recipeYield', text('recipeYield'));
            setIf(base, 'recipeCategory', text('recipeCategory'));
            setIf(base, 'recipeCuisine', text('recipeCuisine'));
            const ingredients = lines(get('recipeIngredient'));
            if (ingredients.length) base['recipeIngredient'] = ingredients;
            if (input.howTo?.steps.length) {
                base['recipeInstructions'] = input.howTo.steps.map(s => ({ '@type': 'HowToStep', text: s.text }));
            }
            if (input.article.author) {
                const author = buildPerson(input.article.author);
                if (author) base['author'] = author;
            }
            setIf(base, 'datePublished', input.article.datePublished);
            return base;
        }
        case 'HowTo': {
            // The page is the procedure; without a how-to block there is no
            // procedure to describe, so the page stays an Article.
            if (!input.howTo?.steps.length) return buildArticle(input.article);
            base['name'] = input.howTo.name || input.article.headline;
            base['step'] = input.howTo.steps.map((s, i) => {
                const step: JsonLd = { '@type': 'HowToStep', position: i + 1, text: s.text, url: `${input.article.url}#step-${i + 1}` };
                if (s.name) step['name'] = s.name;
                return step;
            });
            setIf(base, 'totalTime', minutesToDuration(num('totalTime')));
            const cost = num('estimatedCost');
            const currency = text('priceCurrency');
            if (cost !== undefined && currency) base['estimatedCost'] = { '@type': 'MonetaryAmount', currency, value: cost };
            return base;
        }
        default:
            return buildArticle(input.article);
    }
}

/** Offer needs both a price and a currency to mean anything. */
function buildOffer(price: number | undefined, currency: string, url: string, extra: JsonLd = {}): JsonLd | null {
    if (price === undefined || !currency) return null;
    const offer: JsonLd = { '@type': 'Offer', price, priceCurrency: currency.toUpperCase(), url };
    for (const [k, v] of Object.entries(extra)) if (v) offer[k] = v;
    return offer;
}

const AVAILABILITY: Record<string, string> = {
    instock: 'https://schema.org/InStock',
    outofstock: 'https://schema.org/OutOfStock',
    preorder: 'https://schema.org/PreOrder',
    discontinued: 'https://schema.org/Discontinued',
};
function availabilityUrl(value: string): string | undefined {
    const key = value.toLowerCase().replace(/[^a-z]/g, '');
    return AVAILABILITY[key];
}

const EVENT_STATUS: Record<string, string> = {
    scheduled: 'https://schema.org/EventScheduled',
    cancelled: 'https://schema.org/EventCancelled',
    canceled: 'https://schema.org/EventCancelled',
    postponed: 'https://schema.org/EventPostponed',
    rescheduled: 'https://schema.org/EventRescheduled',
};
function eventStatusUrl(value: string): string | undefined {
    return EVENT_STATUS[value.toLowerCase().replace(/[^a-z]/g, '')];
}

/** ISO 8601 duration from minutes: 90 → PT1H30M. */
export function minutesToDuration(minutes: number | undefined): string | undefined {
    if (minutes === undefined || !(minutes > 0)) return undefined;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `PT${h ? `${h}H` : ''}${m || !h ? `${m}M` : ''}`;
}

function cleanText(value: unknown): string {
    if (typeof value === 'number') return String(value);
    return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string') return undefined;
    const n = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && value.trim() !== '' ? n : undefined;
}

/** Lines of a text or rich-text field, HTML list items included. */
function lines(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return value
        .replace(/<\/(li|p|div|br)\s*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .split(/\r?\n/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

function setIf(node: JsonLd, key: string, value: string | number | undefined): void {
    if (value !== undefined && value !== '') node[key] = value;
}
