# Phone Country Picker: Build Spec (PC)

**Status:** built 2026-10-08 on `feat/phone-country` (PC1 to PC5), browser-checked on the xlm dev project at localhost:5182; suite, functions build and production build green. Not yet merged to `dev`.
**Branch:** `feat/phone-country`, cut from `dev` (e945b17), worktree `../arccms-phone-country`.
**Scope:** wherever a member types a mobile number, the country is shown and chosen
separately from the number: a flag and calling code (`🇮🇳 +91`) beside the digits. The
admin picks countries, not codes, on Settings, SMS.

**Out of scope:**
- Exact number rules for every country (libphonenumber-js, about 80 KB). India keeps its
  own rule, every other country keeps "8 to 15 digits". A country gets its own rule only
  when a real install turns it on (PC-D9).
- Formatting as you type, beyond what `formatPhone` does today.
- The site's own contact number on Settings, About (`about-settings.page.ts`). It is not a
  sign-in number; it can adopt the component later.
- Any change to the server's checks: it already takes `+<code><number>` and enforces the
  allowed codes (PC-D4).

---

## 1. What is true today

- Sign-in (`signup.page.html`) has one box, "mobile number or email", `autocomplete="username"`.
  `classifyIdentifier` decides which one it is.
- A number typed without `+` or `00` gets the default calling code. The browser reads it
  from `Settings/users.phoneCountryCode` (public read), which saving Settings, SMS copies
  from `Settings/sms.defaultCountryCode` (admin only). Opening Settings, SMS repairs a
  missing or stale copy.
- The server (`phoneAuth.ts`) normalises with `normalizePhone(raw, sms.defaultCountryCode)`
  and refuses numbers outside `sms.allowedCountryCodes` (`isAllowedCountry`). An empty list
  means the default country only.
- Settings, SMS has a "default country code" box and an "allowed country codes" text box
  (`91, 44`). Both store calling codes, digits only.
- Profile, Sign-in methods (`sign-in-methods.component.ts`) has a `type="tel"` box for
  adding or changing the number, read against the same default code.
- Settings, SMS's test send has its own `type="tel"` box.
- The PWA precaches only CSS, fonts and the entry scripts (`scripts/pwa-workbox.ts`), so
  files added under `public/` are fetched only when a page asks for them.

The problem: the country is decided but never shown. Someone abroad who types their local
number on an Indian site is told it is not a valid Indian mobile, with no hint why.

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| PC-D1 | **One box, chip appears.** The sign-in box stays "mobile number or email". When phone sign-in is on and the box starts with a digit (or a bracket), a country chip appears at its left edge; a letter or `@` removes it and the box is an email box again. A number starting with `+` or `00` brings its own code, so the chip stays hidden until the number is complete: on paste, autofill, leaving the box or submitting it moves to the chip (PC-D10). Leaving the box for the chip does not tidy the number, so it is never read in the country being changed. | Keeps one-box sign-in; nobody has to choose Phone or Email first (ease of use first). |
| PC-D2 | **Allowed countries only, the default first.** The dropdown lists only the countries the admin allows, the default at the top and the rest in the admin's order (added after the team's review, 2026-10-08). With one allowed country (the default, India) the chip is a fixed label: no arrow, no menu. | A country the server will refuse should not be offered. Most installs allow one country, so they get clarity with no extra tap. |
| PC-D3 | **SVG flags**, vendored from `flag-icons` (MIT) as `public/flags/4x3/{iso}.svg`, licence kept beside them. Fetched only for countries on screen. If a flag fails to load, the chip shows the ISO letters. | Emoji flags show as letters on Windows. Not precached (PWA rule above), so installs pay nothing for unused flags. |
| PC-D4 | **The browser sends `+<code><number>`** whenever the chip is shown, built with the existing `normalizePhone(national, chipCode)`. The server is unchanged and still enforces the allowed codes. | No server change, no deploy of functions; the server never guesses when the member has chosen. |
| PC-D5 | **Settings store countries and codes.** `Settings/sms` gains `defaultCountry: 'IN'` and `allowedCountries: ['IN']` (ISO 3166 alpha-2). Saving still writes `defaultCountryCode` and `allowedCountryCodes`, derived from them, which the server keeps reading. | Several countries share a code (`+1` US, Canada, Caribbean; `+7` Russia, Kazakhstan; `+44` UK, Jersey, Guernsey): the dropdown needs countries. Deriving the codes keeps functions untouched. |
| PC-D6 | **Public copy for the sign-in page.** Saving also writes `Settings/users.phoneCountry` and `phoneCountries` beside the existing `phoneCountryCode`. The existing repair on opening Settings, SMS covers the new fields. No rules change: `Settings/users` is already public read, admin write. | The sign-in page cannot read `Settings/sms`. |
| PC-D7 | **Old installs keep working unchanged.** With no `allowedCountries`, each stored code maps to its main country (`91` IN, `1` US, `44` GB, `7` RU, and the table's `primary` flag for the rest). The admin sees those countries ticked and can change them. | No migration script; nothing breaks before an admin opens the page. |
| PC-D8 | **Which country the chip starts on:** the one last used on this device (local storage, if still allowed), else the admin's default. The browser language's region was tried and dropped in the PC4 browser pass: `en-US` is the default nearly everywhere, India included, so a site allowing India and the US started Indian members on `+1`. | Smart default; one allowed country makes both the same. |
| PC-D9 | **Number rules stay as today.** India: 10 digits starting 6 to 9, with `0` and repeated `91` removed. Others: 8 to 15 digits in total, leading `0` (or the country's own prefix, PC-D13) removed. Messages stay as they were ("too short", "too many digits"); the 6-to-9 message names India, and with several countries adds "choose the country next to it". A number from a country the site does not take says which countries it does take. | libphonenumber-js is not worth its size yet. |
| PC-D10 | **Pasting or autofilling `+44 7700 900123`** sets the chip to the matching allowed country (longest code first, then that code's main country) and leaves the national digits in the box. A country that is not allowed shows "This site accepts numbers from India only" (names from the allowed list) at once, before any code is sent. | Autofill and paste are the common way numbers arrive. |
| PC-D11 | **Country names** come from `Intl.DisplayNames` in the member's language. Only calling codes, ISO ids and the `primary` flag are stored in the table. | No translation work; the multilingual admin and member UI get local names for free. |
| PC-D13 | **Domestic prefixes other than `0`** (`8` in Russia, Kazakhstan, Belarus) are a `trunk` field in the country table and are taken off in the browser (`withoutTrunk`) before `normalizePhone`. Added in PC1. | A Russian types `8 912 345-67-89`; read as is beside `+7` it is a wrong number. The server never sees it: the browser sends E.164. |
| PC-D14 | **`+1` and `+7` take a number as already carrying the code only with all eleven digits** (`startsWithCode`, browser and server twins). Added in PC1. | Every Kazakh mobile starts with 7, so `701 123 45 67` was read as `+7011234567`. Under both codes every number is ten digits after the code. The same bug hit a site whose default code is `+7` or `+1` before this work. |
| PC-D12 | **One component, `arc-phone-country`** (the chip and its menu), used by the sign-in box, the profile number box and the test send box. Apps can use it too (documented as part of the app kit). | One behaviour everywhere; a plug point for apps that collect numbers. |

## 3. Design

### 3.1 Country table: `src/shared/data/countries.ts`

```ts
export interface Country { iso: string; code: string; primary?: true }
export const COUNTRIES: readonly Country[];          // ~245 rows, ISO order
export function countryByIso(iso: string): Country | undefined;
export function countriesForCode(code: string): Country[];   // primary first
export function countryForE164(e164: string, allowed: readonly string[]): Country | null;
```

`countryForE164` tries the allowed countries' codes longest first, so `+1868` (Trinidad) is
not read as `+1` when both are allowed.

### 3.2 Phone helpers: `src/shared/utils/identifier.util.ts`

- `nationalPart(e164, country)`: the digits after the code, for showing in the box.
- `identifierProblem` gains an optional country so errors can name it (PC-D9). The shared
  case table (`functions/src/__tests__/helpers/phoneCases.ts`) gets rows for the chip path.

### 3.3 Component: `arc-phone-country`

- Inputs: `countries` (ISO list, allowed order), `value` (ISO, two-way).
- One country: a label (`<span>` with flag and `+91`), not focusable.
- Several: a button (`aria-haspopup="listbox"`, label "Country: India, +91. Change") that
  opens a menu of flag, local name and code. More than eight countries adds a search box.
- Keyboard: Enter or Space opens, arrows move, typing jumps to a name, Escape closes and
  returns focus to the number.

### 3.4 Sign-in box (`signup.page.*`)

- The chip renders inside the input group only while PC-D1 says so. Showing or hiding it
  never moves the caret or loses typed text.
- `autocomplete="username"` stays (password managers). `inputmode` stays text, since the
  box also takes emails.
- Submitting sends `normalizePhone(box, chipCode)` for a number, the email otherwise.
- Placeholder per chip country (`98765 43210` for India, a generic one otherwise).

### 3.5 Profile and test send

Both are number-only boxes: the chip is always shown, `type="tel"`, `autocomplete="tel-national"`.

### 3.6 Settings, SMS

- "Countries": the chosen countries (flag, local name, code) and a search box to add one,
  by name in the page language or English, ISO id, or code (`44`, `+44`); the main country
  of a shared code is listed first. The last country cannot be removed.
- "Default country": a select of the allowed countries with the default's flag, shown only
  when more than one is allowed (with one, it is the default). Removing the default makes
  the first country left the default, which the select then shows.
- Saving writes the countries and derived codes (PC-D5) and the public copy (PC-D6) in the
  one batch that exists today.

## 4. Phases

Each phase: build, its tests, `npm run test` alone with a full log (it includes
`npm run typecheck`), browser check at localhost:5173, then a critical review as the last task.

### PC1: Country data and helpers
1. Vendor the flags into `public/flags/4x3/` with `LICENSE` (PC-D3).
2. `countries.ts` with the table and lookups (3.1).
3. `nationalPart`, the country-aware `identifierProblem`, and new rows in the shared case table (3.2).
4. Specs: every row has a flag file; `countryForE164` longest-code and shared-code cases; the `+1` and `+7` and `+44` families.
5. Critical review of PC1.

### PC2: Settings, SMS picks countries
1. Read: countries if present, else derived from stored codes (PC-D7).
2. The two pickers (3.6), the batch writing both shapes and the public copy (PC-D5, PC-D6); repair on open covers the new fields.
3. Specs for derive, save shape and repair; page spec for "removing the default".
4. Browser: save one country and three countries, reload, check `Settings/sms` and `Settings/users`.
5. Critical review of PC2.

### PC3: The component
1. `arc-phone-country` (3.3) with flag fallback to ISO letters.
2. Specs: one country renders a label, several render a menu, keyboard, search over eight.
3. The SMS test send box (3.5), moved here from PC4 so the component has a screen to be checked on.
4. Critical review of PC3.

### PC4: Sign-in, profile, test send
1. Sign-in box (3.4), starting country (PC-D8), paste and autofill (PC-D10), errors naming the country (PC-D9).
2. Profile number box (3.5); the test send box was done in PC3.
3. Member translation keys in every member language file.
4. Specs: chip appears and goes with the first character; paste `+44` with GB allowed and not allowed; submitted value is E.164; last-used country remembered.
5. Browser: India only, and India plus UK plus US, on desktop and phone width; autofill a saved `+91` number.
6. Critical review of PC4.

### PC5: Docs and screenshots
1. `npm run docs:affected`; update at least docs/features/sign-in.html, docs/features/sms.html and the app kit page (the component as a plug point).
2. Retake the sign-in, profile and Settings, SMS screenshots.
3. `npm run check:docs`, full suite.
4. Critical review of PC5 and of the whole PC build against this spec.

## 5. Deploy

No rules or index changes. Hosting is deployed by Gunjan. Old installs keep working
before and after (PC-D7).

One functions change (PC-D14) in `functions/src/auth/phoneNumber.ts`. It only changes
anything for an install whose default country code is `+1` or `+7`, so the deploy is
optional for India-default installs; the functions that read numbers with the default code
are the phone sign-in callables (`functions/src/auth/phoneAuth.ts`), `linkIdentifiers` and
`sendTestSms`.
