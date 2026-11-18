/**
 * Where a content type's cards show (specs/visual-editing-spec.md, VE-D10).
 *
 * `cardBlockTypes` is the app copy of the publish pipeline's
 * functions/src/pages/card-blocks.ts cardBlockTypes; card-blocks.spec.ts runs
 * both on the same cases.
 */

/**
 * The content types a piece of the site's HTML shows cards of, from its
 * <arc-content-partials content-type="…">. A block in an HTML comment shows
 * nothing, so it does not count.
 */
export function cardBlockTypes(html: string): string[] {
    const types = new Set<string>();
    for (const match of (html || '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/<arc-content-partials\b[^>]*\bcontent-type\s*=\s*["']([^"']+)["']/gi)) {
        types.add(match[1].trim());
    }
    return [...types];
}

/** The pages that show a type's cards: the home page, and every page (a block in the header or footer). */
export interface CardPlaces {
    home: boolean;
    everyPage: boolean;
}

export function cardPlaces(slug: string, homeHtml: string, headerHtml: string, footerHtml: string): CardPlaces {
    return {
        home: cardBlockTypes(homeHtml).includes(slug),
        everyPage: cardBlockTypes(`${headerHtml}\n${footerHtml}`).includes(slug),
    };
}

/**
 * Where an entry of a type without pages is previewed: on the home page when it
 * has a card block for the type, else on a page whose header or footer has one,
 * else as its card row alone.
 */
export type PreviewPlace = 'home' | 'every-page' | 'cards';

export function wherePreviewed(places: CardPlaces): PreviewPlace {
    if (places.home) return 'home';
    if (places.everyPage) return 'every-page';
    return 'cards';
}
