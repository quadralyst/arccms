# Member Languages Added by the App: Build Spec (A1)

**Status:** A1a (the mechanism) built 2026-10-06 on `feat/app-member-language`; A1b to A1d not built.
**Branch:** `feat/app-member-language`, cut from `dev` (10c8734).
**Scope:** an app built on Arc CMS adds a language Arc does not ship (for example German)
and shows it to its members: signed-in non-admin people, and visitors on the sign-in
screen. Arc builds the mechanism and makes its member screens translatable. The app writes
the translations. **Arc admin stays in Arc's own languages** (English and Hindi), unchanged.

**Out of scope:** any real translation beyond the Hindi Arc already ships (the app writes
its own), translating the admin, a language picker for members (the app calls the API), a
per-person language stored on the user record (the choice is per device), translating the
site's published content (that is the multilingual feature, `specs/multilingual-spec.md`),
the pages of optional features (pricing and checkout, signup forms and leaderboards,
notifications, content pages and list pages; section 7), page titles in the browser tab,
the English error text that Arc's server functions send back (L-D14), and the admin-set
text of the cookie banner (that is the site owner's content).

---

## 1. What is true today

- `ADMIN_LANGUAGES` (`src/app/core/i18n/admin-languages.ts`) is a fixed `en` and `hi`.
  Adding a language means editing three core places: that list, the two import maps in
  `translation.loader.ts`, and `registerLocaleData` in `admin-locale.provider.ts`.
  `src/custom/i18n/{lang}.json` can only override a language that already exists.
- There is one Transloco active language for the whole app. Member screens that use
  Transloco follow the admin's choice (cached in `arc-admin-lang`), so a member can never
  see Hindi unless an admin chose it on that device.
- **Most member screens are not translated at all.** Hard-coded English, by the survey
  (about 380 strings): sign-in, sign-up, forgot password and verify, all one page
  (`signup.page`, ~95); the profile card (`profile.page`, ~56); the sign-in methods card
  (~43); the auth store's messages and the 24 Firebase error messages (~36); not-found
  (~6); the cookie banner's fixed text (3); `account.page` (~31, with 15 unused
  `user.account.*` keys already in `en.json`); and about 19 leftovers in `payments.page`
  and the user shell. Already translated: the install and update prompts, the feedback
  panel, the dashboard, user profile and premium pages.
- The sign-in screens show **server text verbatim**: about 63 `HttpsError` throws in
  `functions/src/auth/` (about 45 distinct messages), and only some carry a machine-readable
  `reason` (10 values).
- Dates and numbers on member screens use the browser locale, not the Transloco language.
  `LOCALE_ID` is set once at bootstrap from the admin cache.
- Tests: `translocoTestingModule()` gives every spec the real `en` and `hi`. The member
  specs mostly call methods with a mock `this` or read the HTML file as a string, so they
  assert on literal English.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| L-D1 | Declaring languages | `src/custom/languages.ts`, a new starter file shipped empty, exporting `MEMBER_LANGUAGES: readonly MemberLanguage[]`. A `MemberLanguage` is `{ code, label, locale, localeData? }`: `code` names the translation file (`src/custom/i18n/{code}.json`), `label` is the name in its own language, `locale` is the BCP-47 locale for dates and numbers (`de-CH`), and `localeData` is `() => import('@angular/common/locales/de-CH')`. The type and the pure resolver live in core (`member-languages.ts`, no imports), like `feature-registry.ts`. |
| L-D2 | Which languages members get | English always, plus what the app declares. Arc's `hi` is offered only if the app declares `{ code: 'hi', ... }`, and then needs no file: core already has it. **If the app declares nothing, nothing changes**: the member area keeps following the admin language state exactly as today. |
| L-D3 | Admin stays separate | `ADMIN_LANGUAGES`, the admin picker and `AdminLanguageService.languages` are unchanged, and a test proves a declared language never appears in them. A small `LanguageAreaService` applies one language to Transloco from the current route: URLs under `/admin` use the admin language, every other URL the member language. Shared components follow whichever area they are on. |
| L-D4 | Loading files | `translation.loader.ts` finds the app's files with `import.meta.glob` over `src/custom/i18n/*.json`, so a new language needs **no core edit**. Core `en` and `hi` keep their static imports. For a declared language with no core file, only the app's file loads, and Transloco's English fallback fills any gap per key. A token (`MEMBER_TRANSLATION_SOURCES`) holds the glob result so tests can supply a fake. |
| L-D5 | The member language state | `MemberLanguageService` (`src/app/core/i18n/`): `activeLang` and `languages` signals, `use(code, { reload? })`, and a plain `setMemberLanguage(code)` function for code outside Angular classes. The choice is stored on the device in `arc-member-lang` (localStorage, safe when unavailable), so a shared device shows it **on the sign-in screen**. No Firestore field, no rules change. |
| L-D6 | First visit | The first match of `navigator.languages` against the declared codes (exact, then the part before `-`, so `de-AT` finds `de`), else English. A saved choice that is no longer declared is ignored. |
| L-D7 | Dates and numbers | `LOCALE_ID` is chosen at bootstrap from the URL area and the member choice. A `provideAppInitializer` awaits `localeData` for that language and registers it first. Like the admin today, **pipes pick up a changed language on the next load**; strings change at once. `use(code, { reload: true })` reloads for an app that wants both. The docs show passing the locale to a pipe for live formatting. The same holds across areas: a person who opens `/admin` first and then goes to the member area in the same session keeps the admin's date and number formats until the next load (strings switch at once). Documented. Hard-coded `toLocaleDateString()` and `Intl.NumberFormat(undefined)` calls on member screens use the active member locale. |
| L-D8 | Which keys are member-facing | A list in `src/app/core/i18n/member-keys.ts`: the new namespace `member.*` (everything extracted by this item) plus the existing member prefixes, **not renamed**, because apps may already override them: `user.*`, `common.pwa.*`, `common.feedback.*`, the few `common.*` keys member screens use (named one by one). Also `MEMBER_SCREEN_FILES`, the files that make up member screens. A test scans those files for translation keys and fails if one is used but not listed, so a new member screen cannot slip out of the list. |
| L-D9 | Missing keys | Fall back to English per key (Transloco's `fallbackLang`, as today). Never the raw key. |
| L-D10 | Parity test | `member-language-parity.spec.ts`: for each declared language, the member-facing core keys plus every key in the app's `src/custom/i18n/en.json` must exist in that language (core file for `hi`, plus the app's file). It fails **naming each missing key**. A language may set `partial: true` to turn the failure into a printed warning while the app is being translated. With nothing declared it passes trivially. `npm run i18n:member -- --lang=de` prints the same list for a translator. |
| L-D11 | Testing without a real language | Test setup declares a fake language `zz` through the token (L-D4) and a fixture under `src/test/`. A script `scripts/i18n-pseudo.mjs` writes a **pseudo translation** of the member keys (`[Ŵéĺćöḿé]` style) to a path you give, for checking a screen by eye in the browser; nothing in Arc ships it. |
| L-D12 | No English left, enforced | `member-screens-translated.spec.ts` scans the templates (inline and `.html`) of `MEMBER_SCREEN_FILES`: any text node or `placeholder`, `title`, `aria-label` or `alt` that is not a Transloco expression fails, and any call to the known message sinks (`successMsg.set`, `errorMsg.set`, toasts, `notify`) with a string literal fails. Plus render tests of the smaller screens (not-found, banner, sign-in methods) in the fake language, asserting every visible text carries the fake language's marker. |
| L-D13 | Emails (the question the brief asks) | **Password reset** is Firebase's own email: Arc sets `auth.languageCode` to the member language before `sendPasswordResetEmail`, so Firebase uses its own template for that language when it has one (it has German and Hindi; the wording is edited in the Firebase console) and English when it does not. **Sign-up verification codes** (the `signup_otp_email` template and SMS codes) have no language parameter and **stay English**. Documented. A language-aware template lookup is a separate item. |
| L-D14 | Server messages | **Not translated in this item** (decided 2026-10-06). The sign-in screens still show the English text that Arc's server functions send back for errors such as a wrong code or a locked PIN. The client keeps showing it verbatim, as today. Documented as a known limit; a later item can add a stable `reason` to every throw and map it to keys. |
| L-D15 | Word order | Messages built by joining words (`` `${label} moved to this account.` ``) become whole-sentence keys with parameters, one per case (email, phone), so a language is free to order the words. |
| L-D16 | Sentinel strings | The strings `auth.service` returns and the store compares (`'Profile updated'`, `'Password updated'`) are values, not text, and are **not** translated; the store maps them to messages. |

## 3. Phases

Each phase ends green (`npm run test -- --run`, `npm run build`, `npm run check:core`)
and is checked in the browser at
`localhost:5173` before the next. Docs go last, in their own phase.

**A1a. The mechanism.** L-D1 to L-D7, L-D9 to L-D11: `languages.ts` and its README row, the
resolver and types, the loader and token, `MemberLanguageService`, `LanguageAreaService`
(and the `AdminLanguageService` change so only the admin area applies the admin language),
`LOCALE_ID` and locale data, `setMemberLanguage`, `member-keys.ts` with the existing member
prefixes, the parity test, the fake language fixture, the pseudo script, `npm run i18n:member`.
Nothing is extracted yet, so the visible change is none.

**A1b. Sign-in, profile and account screens.** L-D12, L-D13, L-D15, L-D16 for: `signup.page`
(html and ts, all steps and messages), the auth store's messages, the 24 Firebase error
messages (to `member.errors.<code>`), `sign-in.service`, `profile.page`,
`sign-in-methods.component` and `account.page` (reusing the 15 unused `user.account.*` keys).
`en` and `hi`, the member-screens-translated test, the `auth.languageCode` line, and the
existing specs updated (section 5).

**A1c. The remaining member screens.** The not-found page and the content not-found
headings, the unauthorized page's fallback, the cookie banner's "Learn more" and fallback
buttons, the `payments.page` leftovers and the user shell fallbacks (`Member`, `Pro` and
the like). `en` and `hi`; render tests in the fake language.

**A1d. Docs.** Section 6.

## 4. Counts, to size the work

About 380 client strings, so roughly 380 keys in `en` and `hi`.
The Hindi is written as part of this work and should get a read by a Hindi speaker before it
is relied on; the parity test only proves it is complete, not good.

## 5. Tests

- **Mechanism (A1a):** declared languages resolve (code, locale, loaders); the glob finds a
  fake file; a language with no core file falls back to English per key; first visit picks
  `de-AT` for `de` and ignores undeclared; a saved choice wins and an undeclared saved
  choice is ignored; `setMemberLanguage` stores and applies; the area service applies the
  admin language under `/admin` and the member language elsewhere, and switches on
  navigation; with nothing declared the member area follows the admin language (today's
  behaviour); a declared language never reaches `ADMIN_LANGUAGES`, the admin picker or
  `isAdminLanguage`; locale data is registered before first render; missing localeData for
  a non-English locale is reported.
- **Parity (A1a):** reports a missing member key and a missing custom English key **by
  name**; `partial: true` warns instead; passes with nothing declared.
- **Extraction (A1b, A1c):** L-D12's scans and render tests. The member specs that assert
  on English literals are updated: `signup.page.spec.ts` (the toast `'Code sent by SMS'`,
  the OTP message, `routeMeta`), `profile.page.spec.ts` (it reads the HTML as a string and
  asserts `'Personal Information'`, `'Security'`, `'Change Photo'`, `'Passwords do not
  match'`), `sign-in-methods.component.spec.ts` (3 messages), `auth.store.login.spec.ts`
  (`'Logged in successfully.'`), and `site-usage-banner.component.spec.ts` keeps passing
  because the English value of the key is the same text. Methods called with a mock `this`
  get a `t` on the mock.
- The existing `i18n-parity.spec.ts` (every `en` key in `hi`, no extras, generated
  `TranslationKey` union current) stays green; `npm run i18n:keys` is rerun with each phase.

## 6. Docs (A1d)

- New `docs/app/member-languages.html`: declaring a language, the files, `localeData`,
  setting the language, the first-visit rule, the member key list and `npm run i18n:member`,
  the parity test and `partial`, dates and numbers (what changes live and what on next
  load), **which emails follow the language and which do not (L-D13)**, that server error
  messages stay English (L-D14), the list of what is not translated, a worked German
  example with three keys.
- `docs/app/custom-space.html`, the `src/custom/README.md` table, `docs/app/sign-in.html`
  and `docs/contributing/` (a rule for core authors: **a member-facing string is never
  hard-coded**; add the key to `en.json` and `hi.json` and the member list).
- Retake any screenshot of a screen whose text changed (none should, in English). Run
  `npm run docs:affected` and `npm run check:docs`.

## 7. Not covered, and why

Pages of optional features keep English for now: pricing, checkout and checkout result
pages (payments), signup forms, leaderboard and unsubscribe pages (forms), the content list
and detail pages (content, which has its own translations by language), notifications, the
public header and footer. Arc POS turns most of these off. Each is a mechanical follow-up
once this mechanism exists: add keys under `member.*` and the file to `MEMBER_SCREEN_FILES`.
The page titles shown in the browser tab (`routeMeta.title`) are static strings and stay
English; the app can set its own.

## 8. Checks before it is done

- The suite, build, `check:core` and docs checks green.
- The guard in A1b makes any later hard-coded member string a failing test.
- By eye at `localhost:5173`: generate the pseudo translation, declare it in a local
  `src/custom/languages.ts`, then walk sign-in, sign-up, forgot password, the code step,
  profile, sign-in methods, account, not-found and the cookie banner: every word must carry
  the pseudo marker, `/admin` must stay English, and the saved language must show on the
  sign-in screen after a reload. Remove the local files afterwards.
- Password reset with a language Firebase has: check the email arrives in it, by Gunjan,
  against the dev project.

**A1a built 2026-10-06.** As specced, with these notes:

- `docs/app/member-languages.html` was written in A1a, not left to A1d, because the code
  names it and the docs checks fail on a page that does not exist; A1d extends it.
- The scripts read the TypeScript key list directly (Node 22.18); their tests pass vitest's
  own loader, which cannot transform a TypeScript file given as a `file://` URL. The new
  scripts have no shebang line: Vite puts an import above it when a module has a dynamic
  import, which breaks the parse.
- `npm run i18n:member -- --lang=de` on Arc CMS today lists 93 member keys; A1b and A1c add
  the extracted screens to that list.
