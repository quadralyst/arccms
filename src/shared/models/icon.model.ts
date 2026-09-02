/**
 * The icon token an admin picks, and the helpers that turn it into something
 * a template can render.
 *
 * Icons are stored as a *token*, not as a media URL. The published pages
 * already load Font Awesome (see the default `cssUrls` in
 * functions/src/shared/site-settings.ts), so the class name alone renders —
 * no upload, no Storage read, no `<img>`. `markup` rides along as the fallback
 * for a site whose owner has customised `cssUrls` and dropped Font Awesome;
 * without it those pages would render an empty box with no way to recover.
 */

/** Icon sets the picker can offer. One today; the token is set-tagged so a second is additive. */
export type IconSet = 'fa';

/** Font Awesome Free ships three styles of the classic family. */
export type FaIconStyle = 'solid' | 'regular' | 'brands';

/** The class prefix Font Awesome uses for each free style. */
export const FA_STYLE_PREFIX: Record<FaIconStyle, string> = {
    solid: 'fa-solid',
    regular: 'fa-regular',
    brands: 'fa-brands',
};

export const FA_STYLES: FaIconStyle[] = ['solid', 'regular', 'brands'];

/**
 * A picked icon, as stored on a content document.
 *
 * Deliberately small and self-describing: a template author reading the raw
 * Firestore document can tell what it is, and a future set (Lucide, Iconify)
 * fits the same shape.
 */
export interface ArcIcon {
    /** Which library the icon came from. */
    set: IconSet;
    /** Bare icon name within the set, e.g. `magnifying-glass`. */
    name: string;
    /** Style within the set, e.g. `solid`. */
    style: string;
    /** Ready-to-use class list, e.g. `fa-solid fa-magnifying-glass`. */
    classes: string;
    /** Human label for accessibility, e.g. `Magnifying Glass`. */
    label: string;
    /** Sanitised inline `<svg>`, used when the icon stylesheet is absent. */
    markup?: string;
}

/** One entry in the generated search index (`public/assets/icons/fa-index.json`). */
export interface FaIndexEntry {
    /** Icon name. */
    n: string;
    /** Display label. */
    l: string;
    /** Free styles this icon exists in. */
    s: FaIconStyle[];
    /** Space-joined search keywords, lowercase. */
    t: string;
    /**
     * Space-joined aliases, lowercase. Absent for the ~73% of icons with
     * none.
     *
     * Separate from `t` because an alias is a much stronger signal than a
     * keyword: "search" is the alias of `magnifying-glass` but merely a
     * keyword on a dozen other icons, and ranking them together puts the
     * `searchengin` brand logo first.
     */
    a?: string;
}

export interface FaIndex {
    version: string;
    icons: FaIndexEntry[];
}

/** One style's path payload (`public/assets/icons/fa-paths-{style}.json`). */
export interface FaPathFile {
    version: string;
    style: FaIconStyle;
    /** `{ star: ['0 0 576 512', 'M287.9 0c…'] }` */
    paths: Record<string, [string, string]>;
}

/**
 * What the picker shows before anyone types.
 *
 * The index is name-sorted, so an unfiltered grid opens on `0`, `1`, `2`,
 * `42-group`, `500px`, `accusoft`, `adn` — digits and defunct ad networks.
 * Technically complete and useless as a starting screen. These are the icons
 * a CMS actually reaches for, roughly grouped, and a spec checks every name
 * still exists in the generated index.
 *
 * Order is deliberate: it is the order they appear in.
 */
export const POPULAR_ICON_NAMES: string[] = [
    // Core objects
    'star', 'heart', 'house', 'user', 'users', 'magnifying-glass', 'envelope', 'phone',
    'location-dot', 'calendar', 'clock', 'bell', 'flag', 'tag', 'tags', 'bookmark',
    // Content
    'image', 'images', 'video', 'music', 'file', 'file-lines', 'folder', 'book',
    'camera', 'microphone', 'headphones', 'play', 'pause', 'paperclip', 'print',
    // Achievement and measurement
    'trophy', 'award', 'medal', 'chart-line', 'chart-simple', 'chart-pie', 'gauge-high',
    // Ideas and action
    'bolt', 'fire', 'lightbulb', 'rocket', 'wand-magic-sparkles', 'puzzle-piece',
    // Tools and security
    'gear', 'sliders', 'wrench', 'shield-halved', 'lock', 'unlock', 'key',
    // Status
    'check', 'circle-check', 'xmark', 'circle-xmark', 'triangle-exclamation',
    'circle-info', 'circle-question', 'eye', 'eye-slash',
    // Editing
    'plus', 'minus', 'pen', 'pen-to-square', 'trash', 'download', 'upload',
    'share-nodes', 'link', 'filter', 'clipboard-list', 'list', 'list-check', 'table',
    // Movement
    'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'chevron-right', 'angle-right',
    // Commerce
    'cart-shopping', 'credit-card', 'money-bill', 'wallet', 'gift', 'truck', 'box',
    'receipt', 'file-invoice', 'briefcase',
    // Places
    'building', 'globe', 'map', 'map-pin', 'compass', 'plane', 'car', 'bicycle',
    'building-columns', 'hospital', 'school',
    // Nature
    'leaf', 'seedling', 'tree', 'sun', 'moon', 'cloud', 'droplet',
    // People and care
    'handshake', 'thumbs-up', 'comment', 'comments', 'paper-plane', 'graduation-cap',
    'stethoscope', 'heart-pulse', 'id-card', 'address-book', 'scale-balanced', 'gavel',
    // Food
    'utensils', 'mug-hot',
    // Technical
    'code', 'terminal', 'database', 'server', 'mobile-screen', 'laptop', 'desktop',
    'wifi', 'qrcode', 'palette', 'brush', 'gamepad',
];

/** The class list for a Font Awesome icon, e.g. `fa-solid fa-star`. */
export function faClasses(style: FaIconStyle, name: string): string {
    return `${FA_STYLE_PREFIX[style]} fa-${name}`;
}

/**
 * Builds the inline-SVG fallback for a Font Awesome icon.
 *
 * `fill="currentColor"` is the whole reason an icon beats an uploaded PNG —
 * it takes the surrounding text colour, so one icon works on a light card, a
 * dark footer, and a themed accent without re-exporting anything.
 *
 * `aria-hidden` because an icon beside a heading is decorative; a template
 * that needs it announced adds its own label. Marking it hidden is the safe
 * default — the alternative announces "Magnifying Glass" before every card
 * title on the page.
 */
export function buildFaMarkup(viewBox: string, path: string): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
        `fill="currentColor" aria-hidden="true" focusable="false">` +
        `<path d="${path}"/></svg>`
    );
}

/**
 * The renderable class list for a stored field value, or `''`.
 *
 * Accepts anything a content document might hold under an `icon` field: the
 * token, a bare class string written before the token existed, or nothing at
 * all. Returning `''` rather than throwing keeps a table cell empty instead of
 * breaking the row.
 */
export function iconClasses(value: unknown): string {
    if (isArcIcon(value)) return value.classes;
    return typeof value === 'string' ? value : '';
}

/**
 * A short human label for a stored field value — what to show where a glyph
 * cannot be drawn, such as a spreadsheet export.
 */
export function iconLabel(value: unknown): string {
    if (isArcIcon(value)) return value.label || value.name;
    return typeof value === 'string' ? value : '';
}

/** True when `value` looks like a stored icon token rather than a plain string. */
export function isArcIcon(value: unknown): value is ArcIcon {
    if (!value || typeof value !== 'object') return false;
    const icon = value as Partial<ArcIcon>;
    return typeof icon.classes === 'string' && typeof icon.name === 'string';
}
