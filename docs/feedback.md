# The feedback button

Signed-in people can send feedback from any page: a message, a voice note, or
both, with a screenshot of the screen they are on. Admins read it in one inbox.

## Turning it on

Admin, **Feedback**, then the **Feedback button** switch at the top. It is off by
default, and takes effect on each person's next page load; no deploy is needed.

The button shows in the bottom corner for signed-in people only. It never shows on
admin pages.

## What people get

1. Tap **Feedback**. The panel opens, and a screenshot of the screen is taken behind
   it (the panel itself is not in the picture).
2. Type what happened, or tap **Record a voice note** (up to 2 minutes; the browser
   asks for the microphone the first time). Either is enough.
3. The screenshot shows as a small picture with **Remove**, for anything private.
4. **Send**, then a short thank-you.

Sent with it, without asking: the page (its path, not the full address, which can
carry codes), the browser and system, screen and window size, whether the app is
installed, and the language.

### Voice notes by browser

Recording works in current Chrome, Edge, Firefox and Safari, on Android, iPhone,
iPad, Mac and Windows. The page must be on `https` (or `localhost`).

| Browser | Records as |
|---|---|
| Safari (Mac, iPhone, iPad), recent Chrome and Edge | MP4, which plays everywhere |
| Firefox, older Chrome | WebM or Ogg, which plays in Chrome, Edge and Firefox, and in recent Safari |

Where a browser cannot record at all, the record button is not shown and people
type instead. Where the microphone is blocked (by the person, or by some apps'
built-in browsers on iPhone), the panel says how to allow it, or to type.

### The screenshot

It is drawn from the page itself, since a browser cannot capture the real screen
without asking each time. It shows the visible part of the page, a second or two
after the tap. Images still loading are left out, and so are images from other sites
that do not allow it.

A game canvas (Phaser, WebGL) comes out blank unless the game keeps its drawing:
`preserveDrawingBuffer: true` in the renderer settings (Phaser: `render: {
preserveDrawingBuffer: true }`).

## The inbox

Admin, **Feedback**: newest first, filtered **New**, **Done** or **All**. Each item
shows who sent it (name, email, phone, from their account), when, the message, the
voice note, the screenshot (click to open it full size), the page and the device.
**Mark done** moves it out of New; **Delete** removes it with its files.

Each new item also rings the admin bell (notification type `admin_new_feedback`).

## For apps

Hide the button on a page, for example during a game, in the route's data:

```ts
{ path: 'play', loadComponent: ..., data: { feedbackButton: false } }
```

Open the panel from the app's own button:

```ts
import { FeedbackService } from '../../app/core/feedback/feedback.service';
inject(FeedbackService).openPanel();
```

This works on pages that hide the floating button too.

## Where it is kept

- `Feedback/{id}`: the message, page, device, `status` (`new` or `done`), and
  `sender`, which the `onFeedbackCreated` function adds from the sender's record.
  The browser cannot set `sender` itself.
- Files: in the sender's own folder, `users/{userDocId}/feedback/{id}/` (after the
  install's storage prefix): `screenshot.jpg` and `voice.mp4`, `.webm` or `.ogg`,
  10 MB at most each.
- `Settings/feedback`: `{ enabled }`.

Rules: a signed-in person with an account record can create feedback that is
theirs, new, and points only at files in their own folder. Only admins can read,
change or delete it. Deleting an account deletes its feedback and files
(docs/account-contract.md).
