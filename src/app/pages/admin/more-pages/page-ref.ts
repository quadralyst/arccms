import { pageTextId } from '../../../core/utils/page-text-model';

/**
 * A page the page editors open: the home page, a static page, or a content type's
 * list page (specs/visual-editing-spec.md, VE-D49, VE-D58), and where each of its
 * screens is.
 */
export interface PageRef {
    kind: 'home' | 'static' | 'list';
    /** The static page's name, or the list page's content type; '' for the home page. */
    name: string;
}

/** The page a route of the page editors names: `:name` is a static page, `:type` a list page. */
export function pageRefFrom(params: { get(key: string): string | null }): PageRef {
    const type = params.get('type');
    if (type) return { kind: 'list', name: type };
    const name = params.get('name');
    return name ? { kind: 'static', name } : { kind: 'home', name: '' };
}

/** Where its words are kept (VE-D39, VE-D59). */
export function pageIdOf(page: PageRef): string {
    if (page.kind === 'list') return pageTextId.listPage(page.name);
    return page.kind === 'static' ? pageTextId.staticPage(page.name) : pageTextId.home();
}

const editorLink = (base: string, page: PageRef): string[] => {
    if (page.kind === 'list') return [`${base}/list`, page.name];
    return page.kind === 'static' ? [`${base}/p`, page.name] : [`${base}/home`];
};

/** Its classic editor. */
export const classicEditorLink = (page: PageRef): string[] => editorLink('/admin/more-pages', page);

/** Its Visual Editor. */
export const visualEditorLink = (page: PageRef): string[] => editorLink('/admin/edit-page', page);

/** Its Live Preview, in the language on screen (a static page has the default language only, VE-D43). */
export function pagePreviewPath(page: PageRef, lang: string, defaultLang: string): string {
    if (page.kind === 'static') return `/admin/preview-page/p/${encodeURIComponent(page.name)}`;
    const language = lang && lang !== defaultLang ? `/${encodeURIComponent(lang)}` : '';
    if (page.kind === 'list') return `/admin/preview-page/list/${encodeURIComponent(page.name)}${language}`;
    return `/admin/preview-page/home${language}`;
}
