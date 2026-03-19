/**
 * CMS Types for template hydration
 */

/**
 * Context object for template hydration
 * Key-value pairs where values can be any type
 */
export type TemplateContext = Record<string, any>;

/**
 * Interface for template data bindings
 */
export interface TemplateBindings {
    [key: string]: string | number | boolean | null | undefined;
}

/**
 * Interface for loop data in templates
 */
export interface TemplateLoopData {
    [loopName: string]: any[];
}
