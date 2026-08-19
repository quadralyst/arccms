import * as cheerio from 'cheerio';
import { interpolate, parseParams } from './interpolate.js';
import { youTubeVideo } from './youtube.js';

/**
 * Template Hydration Service
 *
 * Provides server-side HTML template hydration using cheerio.
 * Processes data-arc-bind, data-arc-loop, and data-arc-if attributes to inject dynamic content.
 *
 * Source of truth: src/app/core/services/template-hydration.service.ts
 * Keep in sync manually.
 */

type TemplateContext = Record<string, any>;

export class TemplateHydrationService {
  /**
   * Resolve a nested key path (e.g. 'share.twitter') from an object
   */
  private static getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
  }
  /**
   * Publishes each custom field under its unprefixed name as well.
   *
   * Custom field keys are stored prefixed with the content type slug, so a
   * heading on `events` is `events_details_heading`. A template shared by
   * every content type — `templates/default/detail.html` — cannot name that,
   * the same problem `arrayLoopData` solves for loops.
   *
   * The guard is that an alias never *replaces* anything: if the bare name is
   * already in the data it is left alone. That is what stops a field keyed
   * `articles_title` from shadowing the page's real `title`, and it needs no
   * list of reserved words to maintain — the built-ins are already present by
   * the time this runs.
   *
   * The slug comes from `contentTypeSlug`, which every template context
   * carries.
   */
  private static aliasCustomFields(data: TemplateContext): TemplateContext {
    if (!data) return data;

    const slug = typeof data['contentTypeSlug'] === 'string' ? data['contentTypeSlug'] : '';
    if (!slug) return data;

    const prefix = `${slug}_`;
    let result = data;

    for (const key of Object.keys(data)) {
      if (!key.startsWith(prefix) || key.length === prefix.length) continue;

      const bare = key.slice(prefix.length);
      if (bare in data) continue;

      if (result === data) result = { ...data };
      result[bare] = data[key];
    }

    return result;
  }

  /**
   * Expands a stored YouTube URL into the strings a template binds to.
   *
   * A gallery row stores only the URL an editor pasted; the id, embed and
   * poster are derived here so a parser fix repairs existing content instead
   * of needing a migration. For a row key `video`:
   *
   *   {{ video }}         the original URL, unchanged
   *   {{ video_id }}      dQw4w9WgXcQ
   *   {{ video_embed }}   https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ
   *   {{ video_thumb }}   https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg
   *
   * `video_thumb` is what lets a gallery render posters and swap in the
   * iframe on click — ten iframes is roughly ten megabytes of player JS.
   *
   * Only string values that actually parse as YouTube are touched, so an
   * unrelated field that happens to hold a URL is left alone.
   */
  private static flattenVideos(data: TemplateContext): TemplateContext {
    if (!data) return data;

    let result = data;

    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string' || !value) continue;
      const video = youTubeVideo(value);
      if (!video) continue;

      if (result === data) result = { ...data };
      result[`${key}_id`] = video.id;
      result[`${key}_embed`] = video.embed;
      result[`${key}_thumb`] = video.thumb;
    }

    return result;
  }

  /**
   * Expands stored icon tokens into the plain strings a template binds to.
   *
   * An `icon` field stores an object (`{ classes, markup, label, name }`), and
   * `{{ card_icon }}` on an object renders "[object Object]". Rather than make
   * every template author write `{{ card_icon.classes }}`, the token is spread
   * into four flat keys:
   *
   *   {{ card_icon }}        fa-solid fa-star  — the class list, the usual case
   *   {{ card_icon_svg }}    <svg …>           — inline fallback, for a site
   *                                              that does not load the icon
   *                                              stylesheet
   *   {{ card_icon_label }}  Star              — for aria-label
   *   {{ card_icon_name }}   star              — the bare name
   *
   * The suffixes are underscored because field keys are themselves forced to
   * `^[a-z0-9_]+$`, so `card_iconSvg` would be the odd one out.
   *
   * Documented in TEMPLATES.md. Runs on a copy; the caller's data is not
   * touched.
   */
  private static flattenIcons(data: TemplateContext): TemplateContext {
    if (!data) return data;

    let result = data;

    for (const [key, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const icon = value as Record<string, unknown>;
      if (typeof icon['classes'] !== 'string' || typeof icon['name'] !== 'string') continue;

      // Copy on first hit only, so untouched data keeps its identity.
      if (result === data) result = { ...data };

      result[key] = icon['classes'];
      result[`${key}_svg`] = icon['markup'] ?? '';
      result[`${key}_label`] = icon['label'] ?? icon['name'];
      result[`${key}_name`] = icon['name'];
    }

    return result;
  }

  /**
   * Hydrates a single HTML template with data
   *
   * @param htmlContent - The HTML template string
   * @param data - Data object with key-value pairs to inject
   * @returns Hydrated HTML string with data-cms-* attributes removed
   *
   * @example
   * ```typescript
   * const html = '<h1 data-arc-bind="title">Placeholder</h1>';
   * const result = hydrateTemplate(html, { title: 'Hello World' });
   * // Returns: '<h1>Hello World</h1>'
   * ```
   */
  static hydrateTemplate(htmlContent: string, data: TemplateContext): string {
    const $ = cheerio.load(htmlContent, {
      xmlMode: false,
    });

    // 0. Pre-process Data: Flatten Collection References into a copy
    // Extracts _ref_author -> ref_author for easier template access
    // We work on a shallow copy to avoid mutating the caller's data object
    if (data && data['customFields']) {
      const customFields = data['customFields'] as Record<string, any>;
      Object.keys(customFields).forEach(key => {
        if (key.startsWith('_ref_')) {
          const cleanKey = key.substring(1); // remove leading underscore
          if (data[cleanKey] === undefined) {
             data = { ...data, [cleanKey]: customFields[key] };
          }
        }
      });
    }

    // Custom fields also answer to their unprefixed name, so a shared
    // template can name them. See aliasCustomFields.
    data = this.aliasCustomFields(data);
    // Icon tokens are objects; templates bind to strings. See flattenIcons.
    data = this.flattenIcons(data);
    // YouTube URLs gain their id, embed and poster. See flattenVideos.
    data = this.flattenVideos(data);


    // 1. Process Angular-style Interpolation {{ variable }}

    // Helper to replace {{ key }} with value
    const replaceInterpolation = (text: string): string => {
      // Dot notation (user.name) and hyphens, which custom-field keys carry:
      // the app prefixes every custom field with its content type slug, so a
      // field on `awards-recognition` is stored as
      // `awards-recognition_card_icon`. Without the hyphen the binding
      // rendered as literal text on exactly the types most likely to use one.
      return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
        // Use getNestedValue to handle dotted paths
        const value = TemplateHydrationService.getNestedValue(data, key);
        return value !== undefined && value !== null ? String(value) : '';
      });
    };

    // Traverse all elements to find text nodes and attributes with interpolation
    $('*').each((_, element) => {
      // Process Attributes
      const attribs = (element as any).attribs;

      // Check for data-arc-if first to conditionally remove element
      if (attribs['data-arc-if']) {
        const key = attribs['data-arc-if'];
        const value = this.getNestedValue(data, key);

        if (!value) {
            $(element).remove();
            return; // Skip further processing for this element
        } else {
            $(element).removeAttr('data-arc-if');
        }
      }

      for (const attrName in attribs) {
        const attrValue = attribs[attrName];
        if (attrName === '[innerHTML]' || attrName === '[innerhtml]') {
            const key = attrValue;
            if (data[key] !== undefined && data[key] !== null) {
                $(element).html(String(data[key]));
                $(element).removeClass('arc-skeleton');
                if (!$(element).attr('class')) {
                    $(element).removeAttr('class');
                }
            }
            $(element).removeAttr(attrName);
            continue;
        }

        if (attrValue.includes('{{')) {
          $(element).attr(attrName, replaceInterpolation(attrValue));
        }

        // Process [attribute] bindings (e.g. [src], [href])
        if (attrName.startsWith('[') && attrName.endsWith(']')) {
            const rawAttrName = attrName.substring(1, attrName.length - 1);
            const key = attrValue;

            const value = this.getNestedValue(data, key);

            if (value !== undefined && value !== null) {
                $(element).attr(rawAttrName, String(value));
            }
            $(element).removeAttr(attrName);
        }
      }

      // Process Text Nodes (direct children only to avoid double processing)
      $(element).contents().each((_, child) => {
        if (child.type === 'text' && child.data && child.data.includes('{{')) {
          const newData = replaceInterpolation(child.data);
          if (child.data !== newData) {
             child.data = newData;
             $(element).removeClass('arc-skeleton');
             if (!$(element).attr('class')) {
                 $(element).removeAttr('class');
             }
          }
        }
      });
    });

    // 2. Process data-arc-bind (Legacy Support & Override)
    $('[data-arc-bind]').each((_, element) => {
      const $el = $(element);
      const bindKey = $el.attr('data-arc-bind') || '';

      // Check if data exists for this key
      const bindValue = TemplateHydrationService.getNestedValue(data, bindKey);
      if (bindValue !== undefined && bindValue !== null) {
        const value = String(bindValue);

        // Smart injection based on element type
        if ($el.is('img')) {
          // For images, set src and alt attributes
          $el.attr('src', value);
          if (data['title']) {
            $el.attr('alt', String(data['title']));
          }
        } else if ($el.is('a')) {
          // For links, set href attribute
          $el.attr('href', value);
        } else if ($el.is('input, textarea, select')) {
          // For form elements, set value
          $el.val(value);
        } else if ($el.is('time')) {
          // For time elements, set datetime attribute and text
          $el.attr('datetime', value);
          $el.text(TemplateHydrationService.formatDate(value));
        } else {
          // For other elements, replace inner HTML/text
          // Check if value contains HTML tags
          if (/<[a-z][\s\S]*>/i.test(value)) {
            $el.html(value);
          } else {
            $el.text(value);
          }
          $el.removeClass('arc-skeleton');
          if (!$el.attr('class')) {
              $el.removeAttr('class');
          }
        }

        // Remove the data-arc-bind attribute for clean output
        $el.removeAttr('data-arc-bind');
      }
    });

    // Handle style bindings (data-arc-style-background for background-color)
    $('[data-arc-style-background]').each((_, element) => {
      const $el = $(element);
      const bindKey = $el.attr('data-arc-style-background') || '';

      const bindValue = TemplateHydrationService.getNestedValue(data, bindKey);
      if (bindValue !== undefined && bindValue !== null) {
        const colorValue = String(bindValue);
        const existingStyle = $el.attr('style') || '';
        $el.attr('style', `${existingStyle} background-color: ${colorValue}; color: #333;`.trim());
        $el.removeAttr('data-arc-style-background');
      }
    });

    return $.html();
  }

  /**
   * Replaces static template text with the active language's strings.
   *
   *   <span data-arc-t="read_more">Read Article</span>
   *
   * The element's existing content is the English default, so an untranslated
   * key simply stays as authored and the template remains a valid, previewable
   * English document. Attributes are annotated as
   * `data-arc-t-attr="placeholder:key"`, and `{{ }}` tokens inside a translated
   * string are filled from `data-arc-t-params` (JSON) — the same three
   * annotations the Angular directive understands.
   *
   * Mirrored in src/app/core/services/template-hydration.service.ts — the
   * static publish and the SPA must render the same chrome.
   *
   * @param htmlContent - Hydrated template HTML
   * @param strings - Flat key → text map for the target language ({} for the default)
   */
  static applyStrings(htmlContent: string, strings: Record<string, string> | null | undefined): string {
    if (!htmlContent) return htmlContent;
    const $ = cheerio.load(htmlContent, { xmlMode: false });
    const table = strings || {};

    $('[data-arc-t]').each((_, element) => {
      const $el = $(element);
      const key = $el.attr('data-arc-t') || '';
      const translated = table[key];
      // Only replace when a translation exists; otherwise the authored English
      // stands. Empty strings are treated as "not translated" so a blank entry
      // cannot silently erase a label.
      if (typeof translated === 'string' && translated.trim()) {
        $el.text(interpolate(translated, parseParams($el.attr('data-arc-t-params'))));
      }
      $el.removeAttr('data-arc-t');
    });

    $('[data-arc-t-attr]').each((_, element) => {
      const $el = $(element);
      const spec = $el.attr('data-arc-t-attr') || '';
      const params = parseParams($el.attr('data-arc-t-params'));
      // "placeholder:key" or several, comma separated.
      spec.split(',').forEach(pair => {
        const [attr, key] = pair.split(':').map(part => part.trim());
        if (!attr || !key) return;
        const translated = table[key];
        if (typeof translated === 'string' && translated.trim()) {
          $el.attr(attr, interpolate(translated, params));
        }
      });
      $el.removeAttr('data-arc-t-attr');
    });

    // Always stripped, even where it carried no usable JSON — the annotation is
    // ours and must never reach a published page.
    $('[data-arc-t-params]').removeAttr('data-arc-t-params');

    return $.html();
  }

  /**
   * Named loop data for the repeating custom fields on a content item.
   *
   * `processLoops` is keyed by name, so `data-arc-loop="info_cards"` needs an
   * `info_cards` entry — this derives one for every array-valued custom field
   * rather than each call site listing them by hand.
   *
   * Rows are sorted by `position` when they carry one. The editor already
   * stores them in order, so this is for rows that arrived some other way (an
   * import, a hand-edited document) — sorting twice costs nothing, publishing
   * cards in the wrong order is very visible.
   *
   * Reserved names win: a custom field keyed `tags` or `items` must not
   * displace the built-in loop a template already relies on.
   *
   * Given `slug`, each loop is also published under its **unprefixed** name.
   * Custom field keys are stored prefixed with their content type slug, so a
   * gallery on `events` is keyed `events_media` — and a shared template like
   * `templates/default/detail.html`, used by every type without a folder of
   * its own, could never name it. The alias lets that template write
   * `data-arc-loop="media"` and work for any type with a field keyed `media`.
   * A page only ever renders one content type, so there is nothing to collide
   * with; where an alias would shadow a real key or a reserved name, the
   * explicit one wins.
   */
  static arrayLoopData(
    customFields: Record<string, any> | undefined | null,
    reserved: string[] = [],
    slug?: string,
  ): Record<string, any[]> {
    const loops: Record<string, any[]> = {};
    if (!customFields) return loops;

    const taken = new Set(reserved);
    const prefix = slug ? `${slug}_` : '';
    const aliases: Record<string, any[]> = {};

    for (const [key, value] of Object.entries(customFields)) {
      if (taken.has(key) || !Array.isArray(value)) continue;

      const rows = value.filter((row) => !!row && typeof row === 'object');
      if (rows.length !== value.length) continue;

      const ordered = rows.every((row) => typeof row['position'] === 'number')
        ? [...rows].sort((a, b) => a['position'] - b['position'])
        : rows;

      loops[key] = ordered;

      if (prefix && key.startsWith(prefix) && key.length > prefix.length) {
        const bare = key.slice(prefix.length);
        if (!taken.has(bare)) aliases[bare] = ordered;
      }
    }

    // Aliases are merged under the real keys, so an explicit key always wins.
    return { ...aliases, ...loops };
  }

  /**
   * Processes loop templates (data-arc-loop)
   *
   * @param htmlContent - The HTML template containing loop containers
   * @param listData - Array of data objects (single loop) OR Object with keys matching data-arc-loop values (multiple loops)
   * @returns HTML with the loops expanded
   */
  static processLoops(htmlContent: any, listData: any[] | Record<string, any[]>): any {
    const $ = cheerio.load(htmlContent, {
      xmlMode: false,
    });

    // Handle multiple named loops (Record<string, any[]>)
    if (!Array.isArray(listData)) {
      Object.keys(listData).forEach((loopName) => {
        const data = listData[loopName];
        if (Array.isArray(data)) {
          this.processSingleLoop($, loopName, data);
        }
      });
    }
    // Handle single unnamed/default loop (backward compatibility)
    else if (listData.length > 0) {
      // Find the first container with data-arc-loop
      const $container = $('[data-arc-loop]').first();
      if ($container.length) {
        const loopName = $container.attr('data-arc-loop');
        if (loopName) {
          this.processSingleLoop($, loopName, listData);
        }
      }
    }

    // Any container the caller had no data for still holds its placeholder
    // rows. Left alone they publish verbatim — a shared template carrying a
    // gallery block would put a literal "Caption" on every page of a content
    // type that has no gallery. An absent loop means no rows, so clear it.
    $('[data-arc-loop]').each((_, element) => {
      const $container = $(element);
      $container.empty();
      $container.removeAttr('data-arc-loop');
      $container.removeAttr('data-limit');
    });

    return $.html();
  }

  /**
   * Helper to process a single loop by name
   */
  private static processSingleLoop($: cheerio.CheerioAPI, loopName: string, data: any[]) {
    const $container = $(`[data-arc-loop="${loopName}"]`);

    if ($container.length) {
      if (data.length > 0) {
        const limit = parseInt($container.attr('data-limit') || '0', 10);

        // Apply limit if specified
        const dataToProcess = limit > 0 ? data.slice(0, limit) : data;

        // Extract the first child as the template
        const $templateChild = $container.children().first();

        if ($templateChild.length) {
          const templateHtml = $.html($templateChild);

          // Generate HTML for each item
          const generatedHtml = dataToProcess
            .map((item) => {
              // Recursively hydrate each template with item data
              return this.hydrateTemplate(templateHtml, item);
            })
            .join('');

          // Replace container content with generated items
          $container.html(generatedHtml);
        }
      } else {
        // If data is empty, clear the container to remove placeholder content
        $container.empty();
      }

      // Remove loop attributes
      $container.removeAttr('data-arc-loop');
      $container.removeAttr('data-limit');
    }
  }

  /**
   * Processes a complete template with both single bindings and loops
   *
   * @param htmlContent - The HTML template
   * @param data - Single object data for bindings
   * @param listData - Optional array data for loops
   * @returns Fully hydrated HTML
   */
  static processTemplate(
    htmlContent: string,
    data?: TemplateContext,
    listData?: any[] | Record<string, any[]>,
  ): string {
    let result = htmlContent;

    // Process loops first if list data is provided
    if (listData && (Array.isArray(listData) ? listData.length > 0 : Object.keys(listData).length > 0)) {
      result = this.processLoops(result, listData);
    }

    // Then process single data bindings if data is provided
    if (data) {
      result = this.hydrateTemplate(result, data);
    }

    return result;
  }

  /**
   * Format date for display
   * Handles both Date objects and ISO strings
   */
  private static formatDate(dateValue: any): string {
    try {
      const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;

      if (!(date instanceof Date) || isNaN(date.getTime())) {
        return String(dateValue);
      }

      // Format as "Month Day, Year"
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return String(dateValue);
    }
  }

  /**
   * Sanitize HTML to prevent XSS attacks
   * Basic sanitization - for production, consider using a library like DOMPurify
   */
  static sanitizeHtml(html: string): string {
    // This is a basic implementation
    // For production, integrate with DOMPurify or similar
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '');
  }
}
