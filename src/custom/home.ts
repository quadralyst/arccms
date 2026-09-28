/**
 * Where people land after signing in, by role (docs/custom-code.md), laid over
 * Arc CMS's defaults (admins: /admin/dashboard, everyone else: /user/dashboard).
 * Arc CMS ships this empty and never edits it again.
 *
 *   export const CUSTOM_HOME: HomePages = {
 *       user: '/learn',       // a role: admin, user, or the install's own
 *       '*': '/learn',        // every role not listed
 *   };
 *
 * A sign-in that came from a page (a signed-out visit to /learn goes to
 * /signup?redirect=/learn) returns to that page instead.
 */
import type { HomePages } from '../app/core/home/home';

export const CUSTOM_HOME: HomePages = {};
