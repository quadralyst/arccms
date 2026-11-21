import * as cheerio from 'cheerio';
import { interpolate, parseParams } from '../i18n/interpolate';
import { TemplateContext } from '../models/cms.types';
import { youTubeVideo } from '../../../shared/utils/youtube';
import { parseHexColor } from '../../../shared/utils/color';
import { DEFAULT_MAX_IMAGE_SIZE, imageSizeUrls, IMAGE_SIZES } from '../../../shared/utils/image-sizes';
import { fileLoopRow, fileSiblings, isFileList, isFileRow } from '../../../shared/utils/file-rows';
import { renderLocation } from '../../../shared/utils/geo';
import { plainTextHtml } from '../../../shared/utils/plain-text';
import { addressHtml, hasSiteInfo, mailHref, siteInfoValue, SiteInfoSource, siteLoopRows, telHref } from '../../../shared/utils/site-info';

/**
 * Options for the app's renderer. The functions copy has none: a published page
 * is always drawn the one way.
 */
export interface HydrationOptions {
  /**
   * Marks every element a value filled, for the live preview's click to field
   * (specs/visual-editing-spec.md, VE-D7): `data-arc-field="key"` on elements
   * filled by data-arc-bind, [innerHTML] and [attr] (with `data-arc-field-attr`
   * naming the attribute), `{{ key }}` in text wrapped in
   * `<span data-arc-field="key">`, and each loop row marked
   * `data-arc-field="faq" data-arc-row="2"`. Off, the output is exactly as
   * without the option; published pages never carry markers.
   */
  markFields?: boolean;
  /**
   * On the Visual Editor only (specs/visual-editing-spec.md, VE-D18): an element
   * `data-arc-if` would remove because its key is empty is kept, marked
   * `data-arc-empty="key"`, when this says the key is a field the editor fills,
   * so it can show as a placeholder and be filled in. Off everywhere else.
   */
  keepEmpty?: (key: string) => boolean;
  /**
   * On the Visual Editor only (specs/visual-editing-spec.md, VE-D30, VE-D33): for
   * a loop that is a repeating field the editor fills, how its rows are edited on
   * the page, else null. Such a loop's rows carry `data-arc-row-id`, each value
   * inside a row is marked with the loop, the row's id and its own key
   * (`data-arc-sub`), an empty value `data-arc-if` would remove is kept when
   * `keepEmpty` says so, and an empty loop keeps its container as
   * `data-arc-empty-loop="{loop}"`. Needs `markFields`. Off everywhere else.
   */
  editRows?: (loop: string) => RowEditing | null;
}

/** How the rows of one repeating field are edited on the page (HydrationOptions.editRows). */
export interface RowEditing {
  /** A row's empty value under `data-arc-if` that is kept, so it can be filled in. */
  keepEmpty(key: string, row: Record<string, any>): boolean;
}

/** Template hints for the Visual Editor (VE-D19), never on a page anyone else sees. */
export const TEMPLATE_HINT_ATTRS = ['data-arc-label', 'data-arc-placeholder', 'data-arc-locked'] as const;

/** Elements whose text is not markup: a marker span cannot go inside them. */
const UNMARKABLE_TEXT = new Set(['title', 'textarea', 'option', 'script', 'style', 'noscript']);

/** Attributes holding an address: the mark an element gets when it also has another (VE-D7). */
const ADDRESS_ATTRS: ReadonlySet<string> = new Set(['src', 'href', 'poster', 'srcset', 'data-src']);

/**
 * Where `data-arc-bind` puts the value on this element, for its mark: an address,
 * a form value, a date's `datetime`; '' when it fills the element's content.
 */
function boundAttr($el: { is(selector: string): boolean }): string | undefined {
  if ($el.is('img, iframe')) return 'src';
  if ($el.is('a')) return 'href';
  if ($el.is('input, textarea, select')) return 'value';
  if ($el.is('time')) return 'datetime';
  return undefined;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/**
 * Values that are words only, never HTML: a card block's section title is typed
 * by editors on the home page and static pages (VE-D41), so it is set as text even
 * where a binding would take HTML.
 */
const PLAIN_TEXT_KEYS: ReadonlySet<string> = new Set(['sectionTitle']);

/**
 * Template Hydration Service
 *
 * Provides server-side HTML template hydration using cheerio.
 * Processes data-arc-bind, data-arc-loop, and data-arc-if attributes to inject dynamic content.
 */
export class TemplateHydrationService {
  /**
   * The longest side of the largest image size (Settings, Misc), which the
   * Unsplash size bindings are fitted to. The default until setMaxImageSize.
   */
  private static maxImageSize = DEFAULT_MAX_IMAGE_SIZE;

  /** Sets the image maximum the size bindings use; an unusable value means the default. */
  static setMaxImageSize(maxSize: unknown): void {
    const max = Number(maxSize);
    this.maxImageSize = Number.isFinite(max) && max >= 1 ? max : DEFAULT_MAX_IMAGE_SIZE;
  }

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
   * heading on `events` is `events-details_heading` (`events_details_heading`
   * on a type created before keys switched to the hyphen). A template shared by
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

    // New keys are `<slug>-<name>`; types created earlier carry `<slug>_<name>`
    // and are never rewritten, so both prefixes are recognised.
    const prefixes = [`${slug}-`, `${slug}_`];
    let result = data;

    for (const key of Object.keys(data)) {
      const prefix = prefixes.find((p) => key.startsWith(p) && key.length > p.length);
      if (!prefix) continue;

      const bare = key.slice(prefix.length);
      if (bare in data) continue;

      if (result === data) result = { ...data };
      result[bare] = data[key];
    }

    return result;
  }

  /**
   * Derives a map embed and a directions link from stored coordinates.
   *
   * A location row stores only `lat`, `lng` and an address; the URLs are worked
   * out here so a fix repairs existing content rather than needing a migration.
   * For a location keyed `address` beside `lat`/`lng`:
   *
   *   {{ map_embed }}       an OpenStreetMap iframe src — no key, no script
   *   {{ map_directions }}  a link that opens the visitor's own maps app
   *   {{ map_view }}        the point on openstreetmap.org
   *
   * Named from the *coordinate* keys rather than the address key, so a row
   * with `lat`/`lng` gets `map_*` regardless of what the address is called.
   */
  private static flattenLocations(data: TemplateContext): TemplateContext {
    if (!data) return data;

    const rendered = renderLocation(data['lat'], data['lng'], data['zoom']);
    if (!rendered) return data;

    return {
      ...data,
      map_embed: rendered.embed,
      map_directions: rendered.directions,
      map_view: rendered.view,
    };
  }

  /**
   * An FAQ row's answer as HTML (specs/site-sections-spec.md, SS4): `answer_html`
   * beside the plain `answer`, with paragraphs and links. Rows are recognised by
   * having both a question and an answer, the FAQ field's two sub-fields.
   */
  private static flattenAnswers(data: TemplateContext): TemplateContext {
    if (!data || typeof data['question'] !== 'string' || typeof data['answer'] !== 'string') return data;
    return { ...data, answer_html: plainTextHtml(data['answer']) };
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
   * Adds every size of an image beside the one that is stored.
   *
   * Media uploads exist at four widths (see image-sizes.ts). The content
   * document stores whichever the editor picked; a template that wants
   * another — a thumbnail in a list, the full width in a hero — binds the
   * size it needs:
   *
   *   {{ coverImage_s }}  {{ coverImage_m }}  {{ coverImage_l }}  {{ coverImage_xl }}
   *
   * Only strings this CMS can resize gain siblings (its own uploads, Unsplash
   * photos); a pasted external URL is left alone. Older single-file uploads
   * answer to every size with that one file, so a template can bind a size
   * without knowing how old the image is.
   */
  private static flattenImageSizes(data: TemplateContext): TemplateContext {
    if (!data) return data;

    let result = data;

    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string' || !value) continue;
      const sizes = imageSizeUrls(value, this.maxImageSize);
      if (!sizes) continue;

      if (result === data) result = { ...data };
      for (const size of IMAGE_SIZES) {
        result[`${key}_${size}`] = sizes[size];
      }
    }

    return result;
  }

  /**
   * Adds the first file of a `file` field beside the field, so a template
   * can link one file without a loop (docs/features/templates.html, File
   * fields):
   *
   *   <a href="{{ brochure_url }}">{{ brochure_title }}</a> ({{ brochure_type }}, {{ brochure_size }})
   *
   * Keyed on the value's shape (a list whose every row has a `url` and a
   * number `bytes`, file-rows.ts), like flattenImageSizes. Every file is in
   * the loop of the same name (arrayLoopData). The stored value is left as is.
   */
  private static flattenFiles(data: TemplateContext): TemplateContext {
    if (!data) return data;

    let result = data;
    for (const [key, value] of Object.entries(data)) {
      if (!isFileList(value)) continue;
      if (result === data) result = { ...data };
      Object.assign(result, fileSiblings(key, value));
    }
    return result;
  }

  /**
   * Expands a stored colour into the forms a stylesheet wants.
   *
   * A `color` field stores a hex string, so `{{ brand }}` already works as a
   * CSS value. Beside it:
   *
   *   {{ brand_rgb }}         rgb(26, 115, 232)
   *   {{ brand_rgb_values }}  26, 115, 232  — for rgba({{ brand_rgb_values }}, .5)
   *
   * Keyed on the value's shape, like flattenVideos: a string that starts with
   * `#` and parses as a hex colour gains the siblings. The hash is required
   * here even though the editor accepts its absence — a text field holding
   * "bad" or "cafe" is a word, not a colour. The stored value is left as is.
   */
  private static flattenColors(data: TemplateContext): TemplateContext {
    if (!data) return data;

    let result = data;

    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string' || !value.startsWith('#')) continue;
      const color = parseHexColor(value);
      if (!color) continue;

      if (result === data) result = { ...data };
      result[`${key}_rgb`] = color.rgb;
      result[`${key}_rgb_values`] = color.rgbValues;
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
   * `^[a-z0-9_-]+$`, so `card_iconSvg` would be the odd one out.
   *
   * Documented in docs/features/templates.html. Runs on a copy; the caller's data is not
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

  /** The most copies one data-arc-repeat makes, and the largest data-max it takes. */
  private static readonly MAX_REPEAT = 100;

  /**
   * The most elements data-arc-repeat may add to one template: a repeat inside
   * a repeat multiplies, and a page must not grow without bound.
   */
  private static readonly MAX_REPEAT_ELEMENTS = 10000;

  /** A number from a key in the data, else from the attribute itself ("5"); NaN when neither is one. */
  private static repeatNumber(data: TemplateContext, raw: string): number {
    if (!raw) return NaN;
    const value = this.getNestedValue(data, raw);
    return parseFloat(String(value ?? raw));
  }

  /**
   * Repeats an element's children from a number, for star ratings, progress
   * dots and meters (docs/features/templates.html, Repeat from a number):
   *
   *   <div data-arc-repeat="rating" data-max="5">
   *     <i class="fa-solid fa-star"></i>        a full slot
   *     <i class="fa-solid fa-star-half"></i>   a half slot (optional)
   *     <i class="fa-regular fa-star"></i>      an empty slot (optional)
   *   </div>
   *
   * The number is a key in the data, or written in the attribute
   * (`data-arc-repeat="3"`). A fraction from .25 to under .75 adds one half
   * slot; from .75 it rounds up to a full one. With one child, that child is
   * every slot, told apart by {{ @state }} (full, half or empty). With two,
   * there are full and half slots only. With three, empty slots fill up to
   * data-max, or to five without one. `data-max` (a number or a key) caps the
   * number and sets how many slots there are. An element with no child element
   * repeats its own text, the number rounded.
   *
   * Each copy can use {{ @index }} (from 0), {{ @number }} (from 1),
   * {{ @state }}, {{ @percent }} (the number as a share of the slots, 0 to 100),
   * {{ @itemPercent }} (this slot's), {{ @value }}, {{ @max }} or {{ @total }}
   * (the slots) and {{ @fraction }} (1, the half slot's fraction, or 0).
   *
   * A missing, non-numeric or negative number counts as 0 (only empty slots,
   * if any); nothing makes more than MAX_REPEAT copies, and a template no more
   * than MAX_REPEAT_ELEMENTS elements, past which a repeat is left empty. Only numbers and the state words are written into the copies, so
   * the data cannot add markup. Runs before {{ }}, so each copy is then filled
   * like the rest of the template, and innermost first, so a repeat inside a
   * repeat reads its own @ values.
   *
   * The same in src/app/core/services/template-hydration.service.ts and
   * functions/src/shared/template-hydration.ts; both spec files run the same
   * cases, and the app's checks the two agree.
   */
  private static applyRepeats($: cheerio.CheerioAPI, data: TemplateContext): void {
    let budget = this.MAX_REPEAT_ELEMENTS;

    $('[data-arc-repeat]').toArray().reverse().forEach((element) => {
      const $el = $(element);
      const given = this.repeatNumber(data, ($el.attr('data-arc-repeat') || '').trim());
      const maxGiven = Math.floor(this.repeatNumber(data, ($el.attr('data-max') || '').trim()));
      const max = Number.isFinite(maxGiven) && maxGiven >= 1 ? Math.min(maxGiven, this.MAX_REPEAT) : 0;
      const value = Math.min(Number.isFinite(given) && given > 0 ? given : 0, max || this.MAX_REPEAT);
      $el.removeAttr('data-arc-repeat');
      $el.removeAttr('data-max');

      const children = $el.children().toArray();
      if (!children.length) {
        $el.text($el.text().repeat(Math.round(value)));
        return;
      }

      const whole = Math.floor(value);
      const fraction = value - whole;
      const full = whole + (fraction >= 0.75 ? 1 : 0);
      const half = fraction >= 0.25 && fraction < 0.75 ? 1 : 0;
      const count = children.length;
      const total = max || (count >= 3 ? Math.max(5, full + half) : full + half);
      const empty = count === 2 ? 0 : Math.max(0, total - full - half);

      // Which child each state copies: one child is every state; two have no empty.
      const source = { full: 0, half: count >= 2 ? 1 : 0, empty: count >= 3 ? 2 : 0 };
      const states = [
        ...Array<'full'>(full).fill('full'),
        ...Array<'half'>(half).fill('half'),
        ...Array<'empty'>(empty).fill('empty'),
      ];

      const cost = states.reduce((sum, state) => sum + 1 + $(children[source[state]]).find('*').length, 0);
      if (cost > budget) {
        $el.empty();
        return;
      }
      budget -= cost;

      const html = children.map((child) => $.html(child));
      const percent = (part: number) => String(total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0);
      $el.html(states.map((state, index) => {
        const tokens: Record<string, string> = {
          index: String(index),
          number: String(index + 1),
          value: String(value),
          total: String(total),
          max: String(total),
          state,
          percent: percent(value),
          itemPercent: percent(index + 1),
          fraction: (state === 'full' ? 1 : state === 'half' ? fraction : 0).toFixed(2),
        };
        return html[source[state]].replace(
          /\{\{\s*@(index|number|value|total|max|state|percent|itemPercent|fraction)\s*\}\}/g,
          (_token, name: string) => tokens[name],
        );
      }).join(''));
    });
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
  static hydrateTemplate(htmlContent: string, data: TemplateContext, options: HydrationOptions = {}): string {
    const mark = options.markFields === true;
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
    // Hex colours gain their rgb forms. See flattenColors.
    data = this.flattenColors(data);
    // Image URLs gain their other sizes. See flattenImageSizes.
    data = this.flattenImageSizes(data);
    // A file field's first file gains its own bindings. See flattenFiles.
    data = this.flattenFiles(data);
    // Coordinates gain their map embed and directions link. See flattenLocations.
    data = this.flattenLocations(data);
    // An FAQ answer gains its HTML. See flattenAnswers.
    data = this.flattenAnswers(data);
    // Children repeated from a number, such as star ratings. See applyRepeats.
    this.applyRepeats($, data);


    // 1. Process Angular-style Interpolation {{ variable }}
    
    // Helper to replace {{ key }} with value
    const replaceInterpolation = (text: string): string => {
      // Dot notation (user.name) and hyphens, which custom-field keys carry:
      // the app prefixes every custom field with its content type slug, so a
      // field on `awards-recognition` is stored as
      // `awards-recognition_card_icon`. Without the hyphen the binding
      // rendered as literal text on exactly the types most likely to use one.
      return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
        // Use getNestedValue to handle dotted paths
        const value = TemplateHydrationService.getNestedValue(data, key);
        return value !== undefined && value !== null ? String(value) : '';
      });
    };

    /**
     * Marks an element with the key that filled it, unless something already did (VE-D7).
     * An address (`src`, `href`) wins over another attribute marked first (`alt`, `class`):
     * a click on a picture or a link changes what it shows or where it goes.
     */
    const markElement = (element: any, key: string, attr?: string): void => {
      if (!mark || !key) return;
      if (element.attribs['data-arc-field'] !== undefined) {
        const had = element.attribs['data-arc-field-attr'];
        if (!(attr && ADDRESS_ATTRS.has(attr) && had && !ADDRESS_ATTRS.has(had))) return;
      }
      $(element).attr('data-arc-field', key);
      if (attr) $(element).attr('data-arc-field-attr', attr);
    };
    /** The first {{ key }} in a string, for marking the attribute it fills. */
    const firstKey = (text: string): string => /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/.exec(text)?.[1] ?? '';

    // Traverse all elements to find text nodes and attributes with interpolation
    $('*').each((_, element) => {
      // Process Attributes
      const attribs = (element as any).attribs;

      // Check for data-arc-if first to conditionally remove element
      if (attribs['data-arc-if']) {
        const key = attribs['data-arc-if'];
        const value = this.getNestedValue(data, key);

        if (!value && !options.keepEmpty?.(key)) {
            $(element).remove();
            return; // Skip further processing for this element
        }
        $(element).removeAttr('data-arc-if');
        if (!value) {
          $(element).attr('data-arc-empty', key);
          // Kept to be filled in: the template's sample words are not the field's value, and
          // the binding goes too (a site sheet may draw an unfilled binding as a loading shimmer).
          if (attribs['data-arc-bind'] === key && !$(element).is('img, iframe, video, audio, source, input, a, select, textarea')) {
            $(element).empty();
            $(element).removeAttr('data-arc-bind');
          }
        }
      }
      // The Visual Editor reads the template hints; every other page drops them, as publishing does.
      if (!mark) for (const name of TEMPLATE_HINT_ATTRS) if (attribs[name] !== undefined) $(element).removeAttr(name);

      // An element bound by data-arc-bind or [innerHTML] is marked with that key, not an attribute's.
      const boundWhole = mark && ['data-arc-bind', '[innerHTML]', '[innerhtml]'].some((name) => attribs[name] !== undefined);
      for (const attrName in attribs) {
        const attrValue = attribs[attrName];
        if (attrName === '[innerHTML]' || attrName === '[innerhtml]') {
            const key = attrValue;
            if (data[key] !== undefined && data[key] !== null) {
                if (PLAIN_TEXT_KEYS.has(key)) $(element).text(String(data[key]));
                else $(element).html(String(data[key]));
                markElement(element, key);
                $(element).removeClass('arc-skeleton');
                if (!$(element).attr('class')) {
                    $(element).removeAttr('class');
                }
            }
            $(element).removeAttr(attrName);
            continue;
        }

        if (attrValue.includes('{{')) {
          if (mark && !boundWhole && !attrName.startsWith('data-arc-')) markElement(element, firstKey(attrValue), attrName);
          $(element).attr(attrName, replaceInterpolation(attrValue));
        }

        // Process [attribute] bindings (e.g. [src], [href])
        if (attrName.startsWith('[') && attrName.endsWith(']')) {
            const rawAttrName = attrName.substring(1, attrName.length - 1);
            const key = attrValue;
            
            const value = this.getNestedValue(data, key);
            
            if (value !== undefined && value !== null) {
                $(element).attr(rawAttrName, String(value));
                markElement(element, key, rawAttrName);
            }
            $(element).removeAttr(attrName);
        }
      }

      // Process Text Nodes (direct children only to avoid double processing)
      const tag = ((element as { tagName?: string }).tagName || '').toLowerCase();
      $(element).contents().each((_, child) => {
        if (mark && child.type === 'text' && child.data && child.data.includes('{{') && !UNMARKABLE_TEXT.has(tag)) {
          // Each {{ key }} becomes a span naming its key; the text around stays text.
          const parts: string[] = [];
          let last = 0;
          let replaced = false;
          child.data.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match: string, key: string, offset: number) => {
            parts.push(escapeText(child.data.slice(last, offset)));
            const value = TemplateHydrationService.getNestedValue(data, key);
            const text = value !== undefined && value !== null ? String(value) : '';
            parts.push(`<span data-arc-field="${escapeAttr(key)}">${escapeText(text)}</span>`);
            last = offset + match.length;
            replaced = true;
            return match;
          });
          if (replaced) {
            parts.push(escapeText(child.data.slice(last)));
            $(child).replaceWith(parts.join(''));
            $(element).removeClass('arc-skeleton');
            if (!$(element).attr('class')) {
              $(element).removeAttr('class');
            }
          }
          return;
        }
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
        if ($el.is('iframe')) {
          // An iframe's payload is its src, never its content. Without this
          // branch a bound embed URL became the frame's inner text and the
          // frame rendered blank — which is how a gallery video or a map ships
          // as an empty box.
          $el.attr('src', value);
        } else if ($el.is('img')) {
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
          $el.text(TemplateHydrationService.formatDate(value, data['lang']));
        } else {
          // For other elements, replace inner HTML/text
          // Check if value contains HTML tags
          if (!PLAIN_TEXT_KEYS.has(bindKey) && /<[a-z][\s\S]*>/i.test(value)) {
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
        // Marked with the attribute the value went into, so the Visual Editor never types a
        // link's label or a formatted date over the stored address or date (review H1).
        markElement(element, bindKey, boundAttr($el));
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
   * Prints the site's own details from Settings, About (specs/site-sections-spec.md, SS3):
   *
   *   <a data-arc-site="phone">…</a>            → the phone, with href="tel:…" on a link
   *   <p data-arc-site-if="address">…</p>       → kept only when the site has an address
   *   <ul data-arc-site-loop="social"><li>…</li></ul> → the first child once per social link,
   *                                               with {{ url }}, {{ platform }}, {{ label }}, {{ icon }}
   *   <ul data-arc-site-loop="pages"><li>…</li></ul>  → once per published standard page (SS6),
   *                                               with {{ url }} and {{ title }}
   *
   * An element bound to a value the site does not have is removed. Runs before
   * hydrateTemplate, so a page's own {{ url }} cannot reach the social rows.
   * Mirrored in functions/src/shared/template-hydration.ts and, for live DOM,
   * src/app/core/site/apply-site-info-dom.ts; site-info.spec.ts checks they agree.
   */
  static applySiteInfo(htmlContent: string, source: SiteInfoSource | null | undefined): string {
    // Untouched unless the page asks: no reparse for the pages that do not.
    if (!htmlContent || !htmlContent.includes('data-arc-site')) return htmlContent;
    const $ = cheerio.load(htmlContent, { xmlMode: false });

    $('[data-arc-site-if]').each((_, element) => {
      const $el = $(element);
      if (hasSiteInfo(source, $el.attr('data-arc-site-if') || '')) $el.removeAttr('data-arc-site-if');
      else $el.remove();
    });

    $('[data-arc-site-loop]').each((_, element) => {
      const $el = $(element);
      const name = $el.attr('data-arc-site-loop');
      const row = $el.children().first();
      const rowHtml = row.length ? $.html(row) : '';
      $el.empty().removeAttr('data-arc-site-loop');
      if (rowHtml) $el.append(siteLoopRows(rowHtml, name, source));
    });

    $('[data-arc-site]').each((_, element) => {
      const $el = $(element);
      const key = $el.attr('data-arc-site') || '';
      const value = siteInfoValue(source, key);
      if (!value) {
        $el.remove();
        return;
      }
      $el.removeAttr('data-arc-site');
      const tag = ((element as { tagName?: string }).tagName || '').toLowerCase();
      if (key === 'logo') {
        if (tag === 'img') {
          $el.attr('src', value);
          if (!$el.attr('alt')) $el.attr('alt', siteInfoValue(source, 'name'));
        }
        return;
      }
      if (key === 'address') $el.html(addressHtml(value));
      else $el.text(value);
      if (tag === 'a' && key === 'email') $el.attr('href', mailHref(value));
      if (tag === 'a' && key === 'phone') {
        const href = telHref(value);
        if (href) $el.attr('href', href);
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
   * Mirrored in functions/src/shared/template-hydration.ts — the static
   * publish and the SPA must render the same chrome.
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
    const prefixes = slug ? [`${slug}-`, `${slug}_`] : [];
    const aliases: Record<string, any[]> = {};

    for (const [key, value] of Object.entries(customFields)) {
      if (taken.has(key) || !Array.isArray(value)) continue;

      const rows = value.filter((row) => !!row && typeof row === 'object');
      if (rows.length !== value.length) continue;

      const sorted = rows.every((row) => typeof row['position'] === 'number')
        ? [...rows].sort((a, b) => a['position'] - b['position'])
        : rows;
      // A file field's rows read as {{ title }}, {{ type }} ("PDF"), {{ size }} ("2.3 MB").
      const ordered = sorted.every(isFileRow) ? sorted.map(fileLoopRow) : sorted;

      loops[key] = ordered;

      const prefix = prefixes.find((p) => key.startsWith(p) && key.length > p.length);
      if (prefix) {
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
  static processLoops(htmlContent: any, listData: any[] | Record<string, any[]>, options: HydrationOptions = {}): any {
    const $ = cheerio.load(htmlContent, {
      xmlMode: false,
    });

    // Handle multiple named loops (Record<string, any[]>)
    if (!Array.isArray(listData)) {
      Object.keys(listData).forEach((loopName) => {
        const data = listData[loopName];
        if (Array.isArray(data)) {
          this.processSingleLoop($, loopName, data, options);
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
          this.processSingleLoop($, loopName, listData, options);
        }
      }
    }

    // Any container the caller had no data for still holds its placeholder
    // rows. Left alone they publish verbatim — a shared template carrying a
    // gallery block would put a literal "Caption" on every page of a content
    // type that has no gallery. An absent loop means no rows, so clear it.
    $('[data-arc-loop]').each((_, element) => {
      const $container = $(element);
      const loopName = $container.attr('data-arc-loop') || '';
      $container.empty();
      $container.removeAttr('data-arc-loop');
      $container.removeAttr('data-limit');
      if (this.editsRows(loopName, options)) $container.attr('data-arc-empty-loop', loopName);
    });

    return $.html();
  }

  /**
   * Helper to process a single loop by name
   */
  private static processSingleLoop($: cheerio.CheerioAPI, loopName: string, data: any[], options: HydrationOptions = {}) {
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

          // A repeating field edited on the page (VE-D30): its rows' values are marked too.
          const editing = this.editsRows(loopName, options);
          // Generate HTML for each item
          const generatedHtml = dataToProcess
            .map((item, index) => {
              if (editing) {
                const row = this.hydrateTemplate(templateHtml, item, { markFields: true, keepEmpty: (key) => editing.keepEmpty(key, item ?? {}) });
                return this.markEditedRow(row, loopName, index, typeof item?.id === 'string' ? item.id : '');
              }
              // Recursively hydrate each template with item data
              const row = this.hydrateTemplate(templateHtml, item);
              return options.markFields ? this.markRow(row, loopName, index) : row;
            })
            .join('');

          // Replace container content with generated items
          $container.html(generatedHtml);
        }
      } else {
        // If data is empty, clear the container to remove placeholder content
        $container.empty();
        // On the Visual Editor the empty list keeps its place, to add the first row (VE-D33).
        if (this.editsRows(loopName, options)) $container.attr('data-arc-empty-loop', loopName);
      }

      // Remove loop attributes
      $container.removeAttr('data-arc-loop');
      $container.removeAttr('data-limit');
    }
  }

  /** How a loop's rows are edited on the Visual Editor, or null (HydrationOptions.editRows). */
  private static editsRows(loopName: string, options: HydrationOptions): RowEditing | null {
    if (!options.markFields || !options.editRows || !loopName) return null;
    return options.editRows(loopName);
  }

  /**
   * A row of a repeating field edited on the page (VE-D30): the row is marked as
   * markRow marks it, with its id, and each value inside it names the loop, the
   * row's id and its own key (`data-arc-sub`), so a click finds the value and the
   * row by id, never by place.
   */
  private static markEditedRow(rowHtml: string, loopName: string, index: number, id: string): string {
    const $ = cheerio.load(rowHtml, { xmlMode: false }, false);
    const top = $.root().children().first();
    if (!top.length) return rowHtml;
    const values = top.find('[data-arc-field]').add(top.filter('[data-arc-field]'));
    values.each((_, element) => {
      const $el = $(element);
      const key = $el.attr('data-arc-field') || '';
      $el.attr('data-arc-field', loopName);
      $el.attr('data-arc-sub', key);
      if (id) $el.attr('data-arc-row-id', id);
    });
    // A kept empty value with nothing marking it (its binding had no value): it is that value's place.
    top.find('[data-arc-empty]').add(top.filter('[data-arc-empty]')).each((_, element) => {
      const $el = $(element);
      if ($el.attr('data-arc-field') !== undefined) return;
      $el.attr('data-arc-field', loopName);
      $el.attr('data-arc-sub', $el.attr('data-arc-empty') || '');
      if (id) $el.attr('data-arc-row-id', id);
    });
    if (top.attr('data-arc-sub') === undefined) top.attr('data-arc-field', loopName);
    top.attr('data-arc-row', String(index));
    if (id) top.attr('data-arc-row-id', id);
    return $.html();
  }

  /**
   * Marks a loop row's top element with its loop and place (VE-D7). The row's
   * own values are not marked: a click anywhere in the row finds the row.
   */
  private static markRow(rowHtml: string, loopName: string, index: number): string {
    const $ = cheerio.load(rowHtml, { xmlMode: false }, false);
    const top = $.root().children().first();
    if (!top.length) return rowHtml;
    top.attr('data-arc-field', loopName);
    top.attr('data-arc-row', String(index));
    return $.html();
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
  /** "January 5, 2026" in the page's language (`lang` in the data); English without one. */
  private static formatDate(dateValue: any, lang?: unknown): string {
    try {
      const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;

      if (!(date instanceof Date) || isNaN(date.getTime())) {
        return String(dateValue);
      }

      const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
      try {
        return date.toLocaleDateString(typeof lang === 'string' && lang ? lang : 'en-US', options);
      } catch {
        // An unknown language code must not break the page.
        return date.toLocaleDateString('en-US', options);
      }
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
