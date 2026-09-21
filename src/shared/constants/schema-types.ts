/**
 * The schema.org types a content type can publish as, and the properties an
 * admin may map to custom fields (docs/discoverability-spec.md, D-D12).
 *
 * `Article` and its subtypes need no mapping: their properties come from the
 * built-in fields (title, summary, cover, dates, author). The others list
 * the properties worth mapping, each with the custom-field types that can
 * fill it. Unmapped properties are omitted from the JSON-LD, never invented.
 *
 * Mirrored server-side in functions/src/shared/schema-types.ts; a parity
 * test keeps the two identical.
 */

export type SchemaTypeId =
    | 'Article' | 'BlogPosting' | 'NewsArticle'
    | 'Product' | 'Service' | 'Event' | 'Person' | 'Recipe' | 'HowTo';

/** Custom-field types (ContentTypeFieldType) a property accepts. */
export type MappableFieldType = 'text' | 'number' | 'richtext' | 'date' | 'datetime' | 'image' | 'dropdown' | 'radio' | 'maplocation';

export interface SchemaProperty {
    /** schema.org property name. */
    key: string;
    label: string;
    hint: string;
    fieldTypes: MappableFieldType[];
    /** Google requires it for a rich result; shown as a nudge, never enforced. */
    recommended?: boolean;
}

export interface SchemaTypeMeta {
    id: SchemaTypeId;
    label: string;
    description: string;
    /** Empty for the Article family. */
    properties: SchemaProperty[];
}

const TEXT: MappableFieldType[] = ['text', 'dropdown', 'radio'];
const LONG_TEXT: MappableFieldType[] = ['text', 'richtext'];
const NUMBER: MappableFieldType[] = ['number', 'text'];
const DATE: MappableFieldType[] = ['date', 'datetime', 'text'];

export const SCHEMA_TYPES: readonly SchemaTypeMeta[] = [
    { id: 'Article', label: 'Article', description: 'The default: any written page. Uses title, summary, cover image, dates and author.', properties: [] },
    { id: 'BlogPosting', label: 'Blog post', description: 'An Article subtype for blog entries.', properties: [] },
    { id: 'NewsArticle', label: 'News article', description: 'An Article subtype for news; Google may show it in Top Stories.', properties: [] },
    {
        id: 'Product', label: 'Product', description: 'Something for sale or on offer. Google shows price and availability in results.',
        properties: [
            { key: 'price', label: 'Price', hint: 'Number in major units, e.g. 499 or 12.50.', fieldTypes: NUMBER, recommended: true },
            { key: 'priceCurrency', label: 'Currency', hint: 'ISO code, e.g. INR, USD.', fieldTypes: TEXT, recommended: true },
            { key: 'availability', label: 'Availability', hint: 'InStock, OutOfStock, PreOrder or Discontinued.', fieldTypes: TEXT },
            { key: 'sku', label: 'SKU', hint: 'Your product code.', fieldTypes: TEXT },
            { key: 'brand', label: 'Brand', hint: 'Brand name; falls back to the site owner when unmapped.', fieldTypes: TEXT },
            { key: 'category', label: 'Category', hint: 'Product category text.', fieldTypes: TEXT },
            { key: 'url', label: 'Buy link', hint: 'Where to purchase, if not this page.', fieldTypes: TEXT },
        ],
    },
    {
        id: 'Service', label: 'Service', description: 'A service the site owner provides.',
        properties: [
            { key: 'serviceType', label: 'Service type', hint: 'e.g. "Web design".', fieldTypes: TEXT, recommended: true },
            { key: 'areaServed', label: 'Area served', hint: 'City, region or country.', fieldTypes: TEXT },
            { key: 'price', label: 'Price', hint: 'Starting price in major units.', fieldTypes: NUMBER },
            { key: 'priceCurrency', label: 'Currency', hint: 'ISO code.', fieldTypes: TEXT },
        ],
    },
    {
        id: 'Event', label: 'Event', description: 'Something happening at a time and place. Google shows events with dates.',
        properties: [
            { key: 'startDate', label: 'Start', hint: 'Date or date-time.', fieldTypes: DATE, recommended: true },
            { key: 'endDate', label: 'End', hint: 'Date or date-time.', fieldTypes: DATE },
            { key: 'locationName', label: 'Venue name', hint: 'e.g. "Town Hall".', fieldTypes: TEXT, recommended: true },
            { key: 'locationAddress', label: 'Venue address', hint: 'Street, city, country.', fieldTypes: ['text', 'maplocation'] },
            { key: 'eventStatus', label: 'Status', hint: 'Scheduled, Cancelled, Postponed or Rescheduled.', fieldTypes: TEXT },
            { key: 'price', label: 'Ticket price', hint: '0 for free.', fieldTypes: NUMBER },
            { key: 'priceCurrency', label: 'Currency', hint: 'ISO code.', fieldTypes: TEXT },
            { key: 'ticketUrl', label: 'Ticket link', hint: 'Where to book.', fieldTypes: TEXT },
        ],
    },
    {
        id: 'Person', label: 'Person', description: 'A profile page: team member, speaker, alumnus.',
        properties: [
            { key: 'jobTitle', label: 'Job title', hint: 'e.g. "Founder".', fieldTypes: TEXT },
            { key: 'affiliation', label: 'Organisation', hint: 'Where they work.', fieldTypes: TEXT },
            { key: 'url', label: 'Profile URL', hint: 'Their own site or profile page.', fieldTypes: TEXT },
            { key: 'email', label: 'Public email', hint: 'Only if it is meant to be public.', fieldTypes: TEXT },
        ],
    },
    {
        id: 'Recipe', label: 'Recipe', description: 'Ingredients and steps. Google shows recipes with times and yields.',
        properties: [
            { key: 'prepTime', label: 'Prep time (minutes)', hint: 'Number of minutes.', fieldTypes: NUMBER },
            { key: 'cookTime', label: 'Cook time (minutes)', hint: 'Number of minutes.', fieldTypes: NUMBER },
            { key: 'recipeYield', label: 'Yield', hint: 'e.g. "4 servings".', fieldTypes: TEXT },
            { key: 'recipeIngredient', label: 'Ingredients', hint: 'One per line.', fieldTypes: LONG_TEXT, recommended: true },
            { key: 'recipeCategory', label: 'Category', hint: 'e.g. "Dessert".', fieldTypes: TEXT },
            { key: 'recipeCuisine', label: 'Cuisine', hint: 'e.g. "Indian".', fieldTypes: TEXT },
        ],
    },
    {
        id: 'HowTo', label: 'How-to guide', description: 'The whole page is one procedure. Steps come from the first How-to block in the body; add one from the editor.',
        properties: [
            { key: 'totalTime', label: 'Total time (minutes)', hint: 'Number of minutes.', fieldTypes: NUMBER },
            { key: 'estimatedCost', label: 'Estimated cost', hint: 'Number in major units.', fieldTypes: NUMBER },
            { key: 'priceCurrency', label: 'Currency', hint: 'ISO code for the cost.', fieldTypes: TEXT },
        ],
    },
];

export const ARTICLE_FAMILY: readonly SchemaTypeId[] = ['Article', 'BlogPosting', 'NewsArticle'];

export function schemaTypeMeta(id: string | undefined | null): SchemaTypeMeta | undefined {
    return SCHEMA_TYPES.find(t => t.id === id);
}

/** What a content type stores (ContentType.schema). */
export interface ContentTypeSchema {
    type: SchemaTypeId;
    /** schema property key → custom field key. */
    fields: Record<string, string>;
}
