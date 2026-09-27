/**
 * Misc Settings Model
 *
 * Configuration for miscellaneous features like geolocation API.
 */

export interface IMiscSettings {
  // Branding
  showPoweredBy?: boolean;

  // Media upload constraints
  mediaMaxFileSize?: number;   // Maximum file size in MB
  /** Longest side of an uploaded image in px — the XL size; S/M/L are quarters of it. */
  mediaMaxSize?: number;
  /** @deprecated Replaced by mediaMaxSize; still present on older Settings docs, ignored. */
  mediaMaxWidth?: number;
  /** @deprecated Replaced by mediaMaxSize; still present on older Settings docs, ignored. */
  mediaMaxHeight?: number;
  mediaConvertToWebp?: boolean; // Convert all uploaded images to WebP format
}

/**
 * Media defaults: 1200px on the longest side, stored as WebP. Uploads are
 * kept in four sizes bounded at quarters of this (see
 * shared/utils/image-sizes.ts). Mirrored by DEFAULT_UPLOAD_SETTINGS.
 */
export const DEFAULT_MISC_SETTINGS: IMiscSettings = {
  showPoweredBy: true,
  mediaMaxFileSize: 5,
  mediaMaxSize: 1200,
  mediaConvertToWebp: true,
};
