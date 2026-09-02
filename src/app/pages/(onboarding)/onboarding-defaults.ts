/**
 * Onboarding Wizard Defaults
 *
 * Constants for the default content types, waitlist, and email template previews
 * that are auto-created when the onboarding wizard completes.
 */

import { ContentType } from '../admin/contents/content-types/content-types.model';
import { DEFAULT_UI_CONFIG } from '../waitlist/waitlist.model';

/**
 * Default CSS URLs for the site (matches cloud function defaults in site-settings.ts)
 */
export const DEFAULT_SITE_CSS_URLS = [
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    '/assets/css/main.css',
];

/**
 * The content types created during onboarding.
 *
 * **Articles, and only Articles.** The seed used to ship User Manuals and
 * Release Notes alongside it, on the theory that a new site would want all
 * three. Most do not, and an unwanted type is not free: it claims a slug, and
 * with it the `arc_{slug}`, `arc_{slug}_drafts` and `Tags_{slug}` collections,
 * all of which the admin then has to find and delete. A site that wants
 * manuals or release notes can add them in the admin UI in under a minute,
 * with names and fields that match how it actually publishes.
 *
 * **`fields` is for what a content type adds, never for what every content
 * item already has.** Title, URL slug, cover image, body, summary/excerpt and
 * the published date are built into the content document and already have
 * their own controls in the editor — the list of them is in
 * `ContentTypeViewPage.builtInContentFields`, which is what the admin UI shows
 * authors as available template placeholders.
 *
 * The seeded types used to declare `title`, `urlSlug`, `coverImage`, `body`,
 * `excerpt` and `publishDate` as custom fields, and the damage was not
 * cosmetic. Authors got two Title inputs and two URL Slug inputs per item, and
 * `buildTemplateData` spreads `customFields` last, so the duplicate silently
 * outranked the real field: a published article rendered its `customFields.
 * title` while the document's own title said something else. The empty
 * duplicates also collected junk — one seeded item stored an admin URL as its
 * `urlSlug`.
 *
 * A type with no fields at all is correct and normal: an article *is* a title,
 * a body and a cover image.
 */
export const DEFAULT_CONTENT_TYPES: Omit<ContentType, 'id' | 'createdAt' | 'modifiedAt' | 'createdBy' | 'modifiedBy'>[] = [
    {
        name: 'Articles',
        singularName: 'Article',
        slug: 'articles',
        description: 'Blog posts, news, and announcements',
        icon: 'fas fa-newspaper',
        order: 1,
        hasPublicUrl: true,
        templateFolder: 'default',
        listColumns: ['title', 'status', 'createdAt'],
        // Nothing beyond the built-ins: an article is a title, a body, a cover
        // image and a slug, all of which every content item already has.
        fields: [],
    },
];

/**
 * Default waitlist created during onboarding.
 * Doc ID will be 'default' so landing pages using data-waitlist-id="default" work immediately.
 */
export const DEFAULT_WAITLIST = {
    slug: 'default',
    name: 'Waitlist',
    description: 'Default waitlist for early access signups',
    isActive: true,
    otpEnabled: true,
    startingPoint: 0,
    totalSignups: 0,
    uiConfig: DEFAULT_UI_CONFIG,
};

/**
 * Preview of the OTP verification email template.
 * Matches the template created by onWaitlistsCreate cloud function.
 */
export const OTP_TEMPLATE_PREVIEW = `<div class="container" style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; padding: 40px; box-sizing: border-box;">
  <div class="header" style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb;">
    <h1 style="font-size: 24px; font-weight: 600; color: #1f2937; margin: 0;">
      Verification Code
    </h1>
  </div>
  <div class="content" style="padding: 30px 0; text-align: center;">
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      Hello,
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      You have requested to join our waitlist. Please use the following One-Time Password (OTP) to verify your email address. This code is valid for 15 minutes.
    </p>
    <div class="otp-code" style="display: inline-block; background-color: #e0f2fe; color: #0369a1; font-size: 32px; font-weight: 600; letter-spacing: 4px; padding: 15px 30px; border-radius: 8px; margin-bottom: 20px; border: 2px dashed #93c5fd;">123456</div>
    <p class="otp-note" style="font-size: 14px; color: #6b7280; margin-bottom: 30px;">
      If you did not request this, please ignore this email.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      Thank you!</p>
  </div>
  <div class="footer" style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="font-size: 12px; color: #9ca3af; margin: 0;">All rights reserved.</p>
  </div>
</div>`;

/**
 * Preview of the welcome email template.
 * Matches the template created by onWaitlistsCreate cloud function.
 */
export const WELCOME_TEMPLATE_PREVIEW = `<div class="container" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
  <div class="header" style="background-color: #2c3e50; color: #ffffff; text-align: center; padding: 40px 20px;">
    <h1 style="margin: 0; font-size: 28px; font-weight: 700;">
      You're on the Waitlist!
    </h1>
  </div>
  <div class="content" style="padding: 40px; text-align: center; color: #34495e; line-height: 1.6;">
    <p style="margin: 0 0 20px; font-size: 16px;">
      Hello,
    </p>
    <p style="margin: 0 0 20px; font-size: 16px;">
      Thank you for joining our waitlist! We're excited to have you. You can check your progress and see your rank on the leaderboard by clicking the links below.
    </p>
    <a href="#" style="display: inline-block; text-decoration: none; color: #ffffff; font-weight: 600; font-size: 16px; padding: 12px 24px; border-radius: 8px; margin: 10px; background-color: #3498db;">
      Your Referral Link
    </a>
    <a href="#" style="display: inline-block; text-decoration: none; color: #ffffff; font-weight: 600; font-size: 16px; padding: 12px 24px; border-radius: 8px; margin: 10px; background-color: #3498db;">
      Waitlist Leaderboard
    </a>
    <p style="margin: 0 0 20px; font-size: 16px; margin-top: 32px;">
      We'll notify you as soon as your spot is ready.
    </p>
    <p style="margin: 0 0 20px; font-size: 16px;">
      Best regards,<br>The Team
    </p>
  </div>
  <div class="footer" style="text-align: center; padding: 20px; font-size: 12px; color: #9baec8; border-top: 1px solid #e2e8f0;">
    <p style="margin: 0; font-size: 12px; color: #9baec8;">All rights reserved.</p>
  </div>
</div>`;
