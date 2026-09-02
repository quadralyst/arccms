# Static UI strings and translated pages

One folder per language, named by its BCP-47 code — the same code configured in
**Admin → Settings → Localization** and used as the URL prefix (`/hi/articles/...`).

```
public/i18n/
  hi/
    strings.json   # static text for templates and partials
    index.html     # translated home page (optional)
```

There is no folder for the **default language**: its text is the English authored
directly into the templates, which also serves as the fallback for any key a
translation is missing.

## strings.json

A flat map of key → text. Keys come from `data-arc-t` attributes in
`public/templates/**` and `public/_partials/**`:

```html
<span data-arc-t="read_more">Read Article</span>
```

The element's existing content is the English default. A key that is absent —
or set to an empty string — leaves that English in place, so a partial
translation is always safe to ship and templates stay readable, previewable
English documents.

Values may contain the same `{{ }}` interpolations as the surrounding template,
because strings are applied *before* the template is hydrated:

```json
{ "back_to": "वापस {{ contentType }} पर" }
```

Attributes are annotated separately, comma-separated for several:

```html
<input data-arc-t-attr="placeholder:search_placeholder">
```

### Adding a key

1. Wrap the text in `public/templates/**` or `public/_partials/**` with
   `data-arc-t="your_key"`, leaving the English inside.
2. Add `your_key` to each language's `strings.json`.
3. Republish affected content — strings are baked into the static pages at
   publish time (and fetched from `/i18n/{lang}/strings.json` by the SPA).

Strings are cached for five minutes per Cloud Function instance, so a freshly
deployed `strings.json` can take that long to appear on newly published pages.

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
