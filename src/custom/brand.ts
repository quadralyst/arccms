/**
 * The app's own name, and titles of its choosing for core pages (docs/app/admin-look.html).
 * Settings, About wins over the name here, so an admin can still rename the site with no
 * deploy. Arc CMS ships this empty and never edits it again.
 *
 *   export const CUSTOM_BRAND: CustomBrand = {
 *       name: 'Tapout POS',
 *       titles: { '/admin/users': 'Staff' },
 *   };
 *
 * The app's logo is a file beside this one: src/custom/logo.svg, .png or .webp. The image
 * that fills the sign-in page's brand panel is src/custom/sign-in-image.webp, .jpg, .jpeg,
 * .png or .svg.
 */
import type { CustomBrand } from '../app/core/brand/site-brand';

export const CUSTOM_BRAND: CustomBrand = {};
