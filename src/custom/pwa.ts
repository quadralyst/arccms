/**
 * The app's PWA settings (docs/pwa.md), laid over Arc CMS's defaults
 * (src/app/core/pwa/pwa-config.ts). The PWA itself is turned on in features.ts
 * (`on: ['pwa']`). Arc CMS ships this empty and never edits it again. Put a square
 * icon of at least 512 by 512 pixels at src/custom/pwa-icon.svg or
 * src/custom/pwa-icon.png; every size is made from it.
 *
 *   export const CUSTOM_PWA: Partial<PwaConfig> = {
 *       name: 'Sanskrit for Kids',
 *       shortName: 'Sanskrit',
 *       themeColor: '#e8590c',
 *       startUrl: '/learn',
 *   };
 */
import type { PwaConfig } from '../app/core/pwa/pwa-config';

export const CUSTOM_PWA: Partial<PwaConfig> = {};
