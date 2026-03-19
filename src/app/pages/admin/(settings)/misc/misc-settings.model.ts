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

export const DEFAULT_MISC_SETTINGS: IMiscSettings = {
  showPoweredBy: true,
  mediaMaxFileSize: 5,
  mediaMaxWidth: 1920,
  mediaMaxHeight: 1080,
  mediaConvertToWebp: false,
};
