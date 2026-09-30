/**
 * What this app makes searchable besides content (docs/app/custom-space.html, search in
 * specs/feature-flags-spec.md section 6). Arc CMS ships this empty and never
 * edits it again.
 *
 * SEARCH_COLLECTIONS names collections. Each gets its own trigger, so adding or
 * removing one needs a functions deploy. Everything else, which fields to search,
 * what a result shows and who may search it, is set up in Admin, Settings, Search.
 *
 *   export const SEARCH_COLLECTIONS: string[] = ['Lessons'];
 *
 * CUSTOM_SEARCH_SOURCES is for what the settings cannot express, written in code
 * (docs/features/search.html). Arc CMS ships one ready-made, for products:
 *
 *   import { productsSource } from '../search/sources/products.js';
 *   export const CUSTOM_SEARCH_SOURCES: SearchSource[] = [productsSource];
 *
 * Logs, events, queues and the index itself can never be searchable; naming one
 * stops the functions from loading, so the deploy fails with the reason.
 */
import type { SearchSource } from '../search/source.js';

export const SEARCH_COLLECTIONS: string[] = [];

export const CUSTOM_SEARCH_SOURCES: SearchSource[] = [];
