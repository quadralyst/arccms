import * as cheerio from 'cheerio';

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

    // 0.5. Process data-arc-repeat / numeric precision repetition
    // Universally handles integers, decimals (e.g. 3.5), progress steppers, ratings, meters, and multi-state templates
    $('[data-arc-repeat], [data-arc-loop-count], [data-arc-loop-single]').each((_, element) => {
      const $el = $(element);
      const attrName = $el.attr('data-arc-repeat') !== undefined
        ? 'data-arc-repeat'
        : $el.attr('data-arc-loop-count') !== undefined
          ? 'data-arc-loop-count'
          : 'data-arc-loop-single';

      const attrValue = ($el.attr(attrName) || '').trim();

      // 1. Resolve raw value from data or fallback to literal attribute value
      let rawValue = TemplateHydrationService.getNestedValue(data, attrValue);
      if (rawValue === undefined || rawValue === null) {
        rawValue = attrValue;
      }

      // Parse as float for high precision (e.g. 3.5, 75.0)
      let numValue = Math.max(0, parseFloat(String(rawValue)) || 0);

      // Check optional data-max / data-total (e.g. data-max="5" or data-max="totalSteps")
      const maxAttr = ($el.attr('data-max') || $el.attr('data-total') || '').trim();
      let maxResolved = maxAttr ? TemplateHydrationService.getNestedValue(data, maxAttr) : undefined;
      if (maxResolved === undefined || maxResolved === null) {
        maxResolved = maxAttr;
      }
      const maxLimit = maxResolved ? Math.max(1, parseFloat(String(maxResolved)) || 0) : 0;

      if (maxLimit > 0) {
        numValue = Math.min(numValue, maxLimit);
      }
      // Calculate precision and fractional states
      const fullCount = Math.floor(numValue);
      const remainder = numValue - fullCount;
      // Precision thresholds: >= 0.75 rounds up to full, 0.25 <= remainder < 0.75 is partial/half
      const isRoundUp = remainder >= 0.75;
      const isPartial = remainder >= 0.25 && remainder < 0.75;
      const adjustedFullCount = fullCount + (isRoundUp ? 1 : 0);
      const partialCount = isPartial ? 1 : 0;

      const $children = $el.children();
      const childCount = $children.length;

      const hydrateItem = (
        template: string,
        idx: number,
        total: number,
        state: 'full' | 'half' | 'empty',
        fraction: number
      ): string => {
        const percent = total > 0 ? Math.round((numValue / total) * 100) : 0;
        const itemPercent = total > 0 ? Math.round(((idx + 1) / total) * 100) : 0;
        return template
          .replace(/\{\{\s*@index\s*\}\}/g, String(idx))
          .replace(/\{\{\s*@number\s*\}\}/g, String(idx + 1))
          .replace(/\{\{\s*@value\s*\}\}/g, String(numValue))
          .replace(/\{\{\s*@total\s*\}\}/g, String(total))
          .replace(/\{\{\s*@max\s*\}\}/g, String(total))
          .replace(/\{\{\s*@state\s*\}\}/g, state)
          .replace(/\{\{\s*@percent\s*\}\}/g, String(percent))
          .replace(/\{\{\s*@itemPercent\s*\}\}/g, String(itemPercent))
          .replace(/\{\{\s*@fraction\s*\}\}/g, fraction.toFixed(2));
      };

      if (childCount > 0) {
        let generatedHtml = '';

        if (childCount >= 3) {
          // 3 templates: [0] Full / Active, [1] Partial / Half / In-Progress, [2] Empty / Inactive
          const totalSlots = maxLimit > 0 ? maxLimit : Math.max(5, adjustedFullCount + partialCount);
          const emptyCount = Math.max(0, totalSlots - adjustedFullCount - partialCount);

          const fullTpl = $.html($children.eq(0));
          const partialTpl = $.html($children.eq(1));
          const emptyTpl = $.html($children.eq(2));

          let curIdx = 0;
          for (let i = 0; i < adjustedFullCount; i++) {
            generatedHtml += hydrateItem(fullTpl, curIdx, totalSlots, 'full', 1);
            curIdx++;
          }
          for (let i = 0; i < partialCount; i++) {
            generatedHtml += hydrateItem(partialTpl, curIdx, totalSlots, 'half', remainder);
            curIdx++;
          }
          for (let i = 0; i < emptyCount; i++) {
            generatedHtml += hydrateItem(emptyTpl, curIdx, totalSlots, 'empty', 0);
            curIdx++;
          }
        } else if (childCount === 2) {
          // 2 templates: [0] Full / Active, [1] Partial / Half
          const totalSlots = maxLimit > 0 ? maxLimit : (adjustedFullCount + partialCount);
          const fullTpl = $.html($children.eq(0));
          const partialTpl = $.html($children.eq(1));

          let curIdx = 0;
          for (let i = 0; i < adjustedFullCount; i++) {
            generatedHtml += hydrateItem(fullTpl, curIdx, totalSlots, 'full', 1);
            curIdx++;
          }
          for (let i = 0; i < partialCount; i++) {
            generatedHtml += hydrateItem(partialTpl, curIdx, totalSlots, 'half', remainder);
            curIdx++;
          }
        } else {
          // 1 template: Single element (e.g. generic step, counter, card, meter segment)
          const singleTpl = $.html($children.eq(0));

          if (maxLimit > 0) {
            for (let i = 0; i < maxLimit; i++) {
              const state = (i + 1 <= adjustedFullCount)
                ? 'full'
                : (i === adjustedFullCount && isPartial)
                  ? 'half'
                  : 'empty';
              const fraction = state === 'full' ? 1 : state === 'half' ? remainder : 0;
              generatedHtml += hydrateItem(singleTpl, i, maxLimit, state, fraction);
            }
          } else {
            const repeatTimes = adjustedFullCount + partialCount;
            for (let i = 0; i < repeatTimes; i++) {
              const state = (i < adjustedFullCount) ? 'full' : 'half';
              const fraction = state === 'full' ? 1 : remainder;
              generatedHtml += hydrateItem(singleTpl, i, repeatTimes, state, fraction);
            }
          }
        }

        $el.html(generatedHtml);
      } else {
        // Direct text / character node
        const textContent = $el.text();
        if (textContent.length > 0) {
          const repeatTimes = Math.round(numValue);
          $el.text(textContent.repeat(repeatTimes));
        } else if (numValue === 0) {
          $el.empty();
        }
      }

      $el.removeAttr(attrName);
      $el.removeAttr('data-max');
      $el.removeAttr('data-total');
    });

    // 1. Process Angular-style Interpolation {{ variable }}

    // Helper to replace {{ key }} with value
    const replaceInterpolation = (text: string): string => {
      // Updated regex to support dot notation (e.g. user.name)
      return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key) => {
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
