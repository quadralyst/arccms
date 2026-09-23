/**
 * ArcCMS legacy names (docs/coexistence-spec.md, CO-D6).
 *
 * Since CO4 every ArcCMS function is deployed as `arccms-<name>`. URLs built
 * from the old names are still out in the world: open-tracking pixels and
 * links in emails already sent, webhook URLs registered in the Dodo and email
 * provider dashboards, and the `search` endpoint baked into static pages
 * published before the upgrade. Each function here keeps one old name alive and
 * forwards to its successor.
 *
 * Only installs upgraded from before CO4 deploy this (`npm run arc:upgrade`
 * does it). Fresh installs never need it. It can be removed once webhooks are
 * re-registered, pages republished, and old emails no longer matter.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { forward, targetUrl } from './proxy.js';

/** Region of the arccms- functions (the CLI default unless the install changed it). */
const TARGET_REGION = process.env.ARC_FUNCTIONS_REGION || 'us-central1';

function legacy(name) {
    // cors: false, so preflights reach the successor and it answers them.
    return onRequest({ cors: false, invoker: 'public' }, (req, res) =>
        forward(req, res, targetUrl({
            name,
            project: process.env.GCLOUD_PROJECT,
            region: TARGET_REGION,
            originalUrl: req.originalUrl,
        })),
    );
}

export const trackEmailOpen = legacy('trackEmailOpen');
export const handleUnsubscribe = legacy('handleUnsubscribe');
export const handleEmailPreferences = legacy('handleEmailPreferences');
export const handleEmailWebhook = legacy('handleEmailWebhook');
export const dodoWebhook = legacy('dodoWebhook');
export const search = legacy('search');
