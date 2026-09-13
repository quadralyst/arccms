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
  mediaMaxWidth?: number;      // Maximum image width in pixels
  mediaMaxHeight?: number;     // Maximum image height in pixels
  mediaConvertToWebp?: boolean; // Convert all uploaded images to WebP format
}

/**
 * Media defaults: 1200px on the long side, stored as WebP. Uploads are kept
 * in four sizes up to this width (see shared/utils/image-sizes.ts), so this
 * is also the width of the XL size. Mirrored by DEFAULT_UPLOAD_SETTINGS.
 */
export const DEFAULT_MISC_SETTINGS: IMiscSettings = {
  showPoweredBy: true,
  mediaMaxFileSize: 5,
  mediaMaxWidth: 1200,
  mediaMaxHeight: 1200,
  mediaConvertToWebp: true,
};
