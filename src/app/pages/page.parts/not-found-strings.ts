import { interpolate } from '../../core/i18n/interpolate';

/**
 * What a content page or a list page says when there is nothing to show. These are
 * pages of the published site, so their text is the site's (`/_site/strings/{lang}.json`,
 * in the page's own language), like the rest of the page around it.
 */
export const NOT_FOUND_STRINGS = {
    content_not_found_title: 'Content Not Found',
    content_not_found_body: "The content you're looking for doesn't exist or has been removed.",
    type_not_found_title: 'Content Type Not Found',
    type_not_found_body: 'The content type "{{ type }}" does not exist.',
    go_home: 'Go Home',
} as const;

export type NotFoundStringKey = keyof typeof NOT_FOUND_STRINGS;

/** The site's wording for a key in the page's language, else the English default. */
export function notFoundText(strings: Record<string, string>, key: NotFoundStringKey, params: Record<string, unknown> = {}): string {
    return interpolate(strings[key]?.trim() || NOT_FOUND_STRINGS[key], params);
}
