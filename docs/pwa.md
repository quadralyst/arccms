# The installable app (PWA)

An install of Arc CMS can be installed like an app: from the home screen on a
phone, or as a desktop app. It is **off by default**, so a plain website gets no
service worker at all. An app built on Arc CMS turns it on in its custom space.

## Turning it on

In `src/custom/pwa.ts`:

```ts
export const CUSTOM_PWA: Partial<PwaConfig> = {
    enabled: true,
    name: 'Sanskrit for Kids',   // under the icon when there is room, and in the install dialog
    shortName: 'Sanskrit',       // under the icon on a phone (about 12 characters)
    description: 'Learn Sanskrit through play.',
    themeColor: '#e8590c',       // the phone's status bar, and the install card
    backgroundColor: '#ffffff',  // the splash screen while the app opens
    startUrl: '/learn',          // the page the home screen icon opens
};
```

Anything left out keeps Arc CMS's default (`src/app/core/pwa/pwa-config.ts`).

Then add one square icon, at least 512 by 512 pixels, as `src/custom/pwa-icon.svg`
or `src/custom/pwa-icon.png`. Every size is made from it at build time, including
the iPhone icon and the "maskable" one Android crops into a circle or squircle: keep
the important part within the middle 80%. Without it, a plain "Arc" icon is used.

The settings are read at build time, so a change needs a new build and deploy.

## What people get

**Installing.** `<arc-install-prompt />` shows the right thing for each browser:

| Browser | Shown |
|---|---|
| Chrome and Edge on Android and computers | an **Install** button, which opens the browser's own dialog |
| Safari on iPhone and iPad | two steps: tap Share, then "Add to Home Screen" |
| Other browsers on iPhone and iPad | "To install, open this page in Safari", with **Copy link** |
| Already installed, or a browser that cannot install | nothing |

**Not now** hides it for 30 days on that device. Core shows it at the top of the
user dashboard; an app can place it on any of its own pages:

```ts
import { InstallPromptComponent } from '../../shared/components/install-prompt/install-prompt.component';
// template: <arc-install-prompt />
```

**Opening fast.** The app's main code, styles and fonts are stored on the device.
Other code, images and web fonts are stored the first time they are used. Pages
always come from the network first, so new content shows at once; without a
connection (or after 4 seconds of waiting) the stored app opens instead. Signed-in
data still needs a connection.

**Updates.** After a deploy, an open app notices the new version (on its next page
load, and every hour) and shows **A new version is ready** with an **Update**
button. It never reloads by itself, so nobody is cut off mid-way.

There is no version number to set. The service worker lists the app's files with a
fingerprint of each, so it changes only when a file changes: a deploy that changes
the app asks once, and a rebuild that changes nothing asks nobody. Content published
in the CMS needs no build and never asks: pages always come from the network.

## Install numbers

The admin dashboard shows **App installs** when the PWA is on:

- **Installs, last 30 days**, by platform (Android, iPhone and iPad, computer).
- **Install rate**: the people whose account says they installed the app, as a
  share of everyone with an account.
- **Opened from the home screen, last 30 days**: each device counts once a day.

The browser reports four events to the `trackPwaEvent` function: install card
shown, installed, "not now", and opened from the home screen. Each counts once per
device (opening: once a day). They are added up by day in `PwaStats/{YYYY-MM-DD}`
(UTC), readable by admins only. A signed-in person's record also gets
`pwa: { installed, platform, installedAt, lastOpenedAt }`, which is what the install
rate counts.

iPhone has no "installed" event, so the first open from the home screen counts as
the install. Visitors who are not signed in are counted too, since people often
install before signing in. The counters are a guide, not an audit: anyone can call
the function.

## Testing

A service worker runs only on `https` or on `localhost`, and only in a production
build (`npm run dev` has none).

On the computer:

```bash
npm run build
npx vite preview --port 5190 --outDir dist/client
```

Open http://localhost:5190, then in Chrome's DevTools, Application: the Manifest
shows the name and icons, Service workers shows `sw.js` running, and the install
icon appears in the address bar.

On a phone, the site needs a real `https` address: deploy to a Firebase Hosting
site and open it there.

## Turning it off again

Set `enabled: false` and deploy. On each visitor's next visit the site removes the
service worker and its stored files, so everyone gets the plain website again. An
icon already on a home screen still opens the site, now as a normal web page.
