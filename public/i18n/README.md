# Translated home pages

One folder per language, named by its BCP-47 code: the same code configured in
**Admin → Settings → Localization** and used as the URL prefix (`/hi/articles/...`).

```
public/i18n/
  hi/
    index.html     # translated home page (optional)
```

The static UI strings that `data-arc-t` reads (the translations of the header,
footer and templates) are not here: Arc CMS's are in `public/_site/strings/{lang}.json`,
an app's in `src/custom/site/strings/{lang}.json`, merged key by key and served at
`/_site/strings/{lang}.json`. See docs/website/languages.html and
docs/features/languages.html.

## index.html

An optional full translation of `public/index.html`. The home page is prose with
inline formatting, where per-key strings cannot express word order, so it is
translated as a whole document instead.

Keep the `<!-- arc-source-version: N -->` marker in sync with the one in
`public/index.html`. When the English page's structure changes, bump its version
and update each translation; the mismatch is what makes drift visible instead of
silent.

A language folder without an `index.html` simply has no translated home page —
the language switcher will not offer one there.

### Adding a translated home page

`templateUrl` is resolved at build time, so a translated home page cannot be one
component choosing a file at runtime — each language needs its own component.
All behaviour (waitlist wiring, the onboarding redirect, the article cards)
lives in `HomeBaseComponent`, so those components are a few lines each.

1. `public/i18n/{lang}/index.html` — translate `public/index.html`, keeping the
   `arc-source-version` marker in step.
2. A component in `src/app/pages/home-i18n/`, copying `home.hi.component.ts`
   and changing `pageLang` and `templateUrl`.
3. Add the code to `HOME_PAGE_LANGUAGES` in
   `src/app/pages/page.parts/home-base.component.ts`, which is what the
   switcher offers.
4. A route in `src/app/app.routes.ts` (`path: '{lang}'`).
5. The path in `vite.config.ts`'s `prerender.routes`, so it is crawlable
   like `/`.

Steps 3–5 are hand-maintained on purpose: the enabled-language list is runtime
data in Firestore, but prerendering is decided at build time and only a real
file can be prerendered. Enabling a language in settings does not conjure a
translated home page.
