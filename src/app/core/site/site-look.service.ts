/**
 * The site look for an editor (specs/editor-site-look-spec.md, ES2): the live
 * page's CSS for one field of an entry, ready for the rich text editor.
 *
 * For an entry's type, layout and field it finds the detail template the page
 * renders with (detailTemplateCandidates), where the template puts the field
 * (bodyChain), and builds one stylesheet from `main.css`, the app's `site.css`
 * and the template's `<style>` blocks, all scoped to the look's root
 * (site-look.ts). The stylesheet is one `<style>` element per template, there
 * while an editor uses it (`use`). Files are fetched once per visit.
 */
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { isTemplateFragment } from '../../../shared/utils/template-fragment';
import { detailTemplateCandidates, siteManifest } from './site';
import { ADMIN_BOOTSTRAP_VARIABLES, assembleSiteLook, bodyChain, BodyChain, scopeCss, ScopedCss, templateStyles, underImportCondition } from './site-look';

/** What an editor needs to show a field in the page's look. */
export interface SiteLook {
    /** The template elements around the field, and the field's own element. */
    chain: BodyChain;
    /** The class on the look's root that its stylesheet is scoped to, such as `arc-site-look-1`. */
    scopeClass: string;
    /** The language being edited, for the root's `lang`. */
    lang: string;
}

export interface SiteLookRequest {
    /** The content type's template folder. */
    folder: string | null | undefined;
    /** The entry's layout, if it chose one. */
    layout: string | null | undefined;
    /** The content type's slug: the entry's page is at `/{typeSlug}/{slug}`. */
    typeSlug: string;
    /** The field: `content` for the body, a rich text field's key otherwise. */
    key: string;
    lang: string;
}

/** Elements inside the look's root that the site CSS must not reach: the editor's own controls. */
export const SITE_LOOK_LIMIT = '.arc-editor-ui';

const SITE_SHEETS = ['assets/css/main.css', 'assets/css/site.css'];

/**
 * The names a template can place a field by, in the order to look for them: its
 * key, then for a custom field stored as `{typeSlug}-{name}` (or `{typeSlug}_{name}`
 * on older types) the bare name, as the page's data offers it
 * (TemplateHydrationService.aliasCustomFields). Never `content` for a custom
 * field: the page keeps that name for the body.
 */
export function fieldNames(key: string, typeSlug: string): string[] {
    const prefix = [`${typeSlug}-`, `${typeSlug}_`].find((p) => typeSlug && key.startsWith(p) && key.length > p.length);
    const bare = prefix ? key.slice(prefix.length) : '';
    return bare && bare !== 'content' ? [key, bare] : [key];
}
/** How deep `@import`s are followed. */
const IMPORT_DEPTH = 3;

interface LoadedTemplate {
    url: string;
    html: string;
}

@Injectable({ providedIn: 'root' })
export class SiteLookService {
    private http = inject(HttpClient);
    private document = inject(DOCUMENT);
    private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

    private texts = new Map<string, Promise<string | null>>();
    private templates = new Map<string, Promise<LoadedTemplate | null>>();
    /** The stylesheet for each template and page folder, and its number. */
    private sheets = new Map<string, Promise<{ scopeClass: string; css: string }>>();
    private css = new Map<string, string>();
    private users = new Map<string, number>();
    private nextNumber = 1;

    /** The look for one field of an entry, or null when the template does not place it or cannot be loaded (ES-D12). */
    async forField(request: SiteLookRequest): Promise<SiteLook | null> {
        if (!this.isBrowser) return null;
        try {
            const template = await this.template(request.folder, request.layout);
            if (!template) return null;
            let chain: BodyChain | null = null;
            for (const name of fieldNames(request.key, request.typeSlug)) {
                chain ??= bodyChain(template.html, name);
            }
            if (!chain) return null;
            const { scopeClass } = await this.sheet(template, request.typeSlug);
            return { chain, scopeClass, lang: request.lang };
        } catch (error) {
            console.warn('[SiteLookService] The editor keeps its own look:', error);
            return null;
        }
    }

    /** Puts the look's stylesheet on the page; the returned function takes it off again once no editor uses it. */
    use(look: SiteLook): () => void {
        const id = look.scopeClass;
        this.users.set(id, (this.users.get(id) ?? 0) + 1);
        if (!this.document.getElementById(id)) {
            const style = this.document.createElement('style');
            style.id = id;
            style.setAttribute('data-arc-site-look', '');
            style.textContent = this.css.get(id) ?? '';
            // Last in <head>, after the admin's styles, as the site's sheets come after Bootstrap on the page.
            this.document.head.appendChild(style);
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const left = Math.max(0, (this.users.get(id) ?? 1) - 1);
            this.users.set(id, left);
            if (left === 0) this.document.getElementById(id)?.remove();
        };
    }

    /** The entry's detail template: the first candidate that is a template, as on the page (ES-D1). */
    private template(folder: string | null | undefined, layout: string | null | undefined): Promise<LoadedTemplate | null> {
        const candidates = detailTemplateCandidates(folder, layout);
        const key = candidates.join('|');
        let loaded = this.templates.get(key);
        if (!loaded) {
            loaded = (async () => {
                for (const url of candidates) {
                    const html = await this.text(url);
                    if (isTemplateFragment(html)) return { url, html: html as string };
                }
                return null;
            })();
            this.templates.set(key, loaded);
        }
        return loaded;
    }

    private sheet(template: LoadedTemplate, typeSlug: string): Promise<{ scopeClass: string; css: string }> {
        // A template's inline url()s resolve against the page's address, which only the type changes.
        const pageAddress = `/${typeSlug}/`;
        const key = `${template.url}|${pageAddress}`;
        let sheet = this.sheets.get(key);
        if (!sheet) {
            const scopeClass = `arc-site-look-${this.nextNumber++}`;
            sheet = this.buildSheet(template, pageAddress, scopeClass).then((css) => {
                this.css.set(scopeClass, css);
                return { scopeClass, css };
            });
            this.sheets.set(key, sheet);
        }
        return sheet;
    }

    private async buildSheet(template: LoadedTemplate, pageAddress: string, scopeClass: string): Promise<string> {
        const options = { scope: `.arc-site-look.${scopeClass}`, limit: SITE_LOOK_LIMIT };
        const sheets: ScopedCss[] = [];
        for (const file of SITE_SHEETS) {
            const version = siteManifest().files[file];
            const url = `/${file}${version ? `?v=${version}` : ''}`;
            sheets.push(...await this.scopedWithImports(await this.text(url) ?? '', url, options, 0));
        }
        sheets.push(...await this.scopedWithImports(templateStyles(template.html), pageAddress, options, 0));
        const html = getComputedStyle(this.document.documentElement);
        const rootVariables = Object.fromEntries(ADMIN_BOOTSTRAP_VARIABLES.map((name) => [name, html.getPropertyValue(name)]));
        return assembleSiteLook({ ...options, keyframesPrefix: `${scopeClass}-`, rootVariables }, sheets);
    }

    /** A sheet scoped, with each sheet it imports before it (ES1, `@import`). One that cannot be fetched is left out. */
    private async scopedWithImports(css: string, baseUrl: string, options: { scope: string; limit: string }, depth: number): Promise<ScopedCss[]> {
        const scoped = scopeCss(css, { ...options, baseUrl });
        const sheets: ScopedCss[] = [];
        if (depth < IMPORT_DEPTH) {
            for (const imported of scoped.imports) {
                const text = await this.text(imported.url);
                if (text === null) continue;
                const parts = await this.scopedWithImports(text, imported.url, options, depth + 1);
                sheets.push(...parts.map((part) => underImportCondition(part, imported.condition)));
            }
        }
        sheets.push(scoped);
        return sheets;
    }

    /** A file's text, fetched once per visit; null when it cannot be fetched. */
    private text(url: string): Promise<string | null> {
        let text = this.texts.get(url);
        if (!text) {
            text = firstValueFrom(this.http.get(url, { responseType: 'text' })).catch(() => null);
            this.texts.set(url, text);
        }
        return text;
    }
}
