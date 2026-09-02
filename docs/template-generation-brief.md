# Brief: designing Arc CMS page mockups

Paste this whole file into a fresh Claude conversation, followed by the home
page mockup and the list of content types. It explains what Arc CMS templates
are, what a page can bind to, and what to hand back.

---

## Your task

For **every content type** you are given, produce three things:

1. **A recommended set of custom fields** — you decide what the type should
   hold. This is a real deliverable: someone will create these fields in the
   CMS before your pages can work.
2. **`<slug>/list.html`** — the grid or list of all items of that type.
3. **`<slug>/detail.html`** — one item in full.

The pages are mockups a developer will convert into Arc CMS templates. Write
them already using Arc CMS's binding attributes (below) so conversion is mostly
copy-paste, not a rewrite.

**You are being asked to design the best page you can**, not to fill a form.
Choose fields that let you build something worth looking at, then build it.

### The one rule that keeps this honest

> A page may only bind to **fields you recommended for that same content type**,
> plus the universal built-ins listed later.

Your field recommendation and your HTML are one design. If the detail page shows
a facts panel, a `labelvalue` field must appear in that type's recommendation.
If a type has no gallery field, its pages have no gallery.

---

## What you will be given

**1. A home page mockup.** This is your design specification — there is no
written spec. Read the design language out of it and carry it through every
page you produce:

- Colour palette, and which colour means what (primary action, accent, muted)
- Type scale, weights, and heading hierarchy
- Spacing rhythm, container widths, corner radii, border and shadow treatment
- Component idioms already established — how a card looks, how a badge or pill
  looks, how a section header is introduced, button shapes
- Tone and density: airy or compact, decorative or restrained

Your pages should look like they came from the same designer as that mockup. Do
not introduce a new visual language.

**2. A list of content types** — names, and usually a sentence on each. If you
are given only a name, infer the purpose from it and say what you inferred.

---

## Recommending fields

### Fields that already exist — never recommend these

Every content type gets these for free. Recommending a custom field that
duplicates one is the most common mistake here, and it produces pages that bind
to an empty field instead of the populated built-in.

`title` · `urlSlug` · `url` · `coverImage` · `excerpt` · `content` (the main
rich-text body) · `publishedOn` / `date` · `readTime` · `author` · `tags` ·
`metaDescription`

So: no "Title" field, no "Cover Image" field, no "Body" field, no "Publish Date"
field, no "Summary" field.

### Field types you can recommend

| Type | Holds | Reach for it when |
|------|-------|-------------------|
| `text` | One line | Short labels, names, a subtitle |
| `number` | A number | Counts, prices, durations |
| `richtext` | Formatted HTML | A second body section — remember `content` is already there |
| `date` / `datetime` | A date | Event dates, deadlines |
| `image` | One image | A logo, portrait, or diagram beyond the cover |
| `icon` | A Font Awesome icon | A category marker, a visual key |
| `boolean` | Yes/no | A flag you show or hide something on |
| `dropdown` / `radio` | One of a fixed list | Category, status, tier |
| `checkbox` | Several of a fixed list | Multi-select attributes |
| `infocard` | **Rows** of icon-or-image + headline + info | Feature/benefit strips, "how it works" |
| `gallery` | **Rows** of photo or YouTube video + caption | Event coverage, portfolios, media |
| `labelvalue` | **Rows** of label + value, with a heading | "At a glance" facts, specs, key figures |
| `maplocation` | **Rows** of a place — name, address, map point | Offices, venues, chapters, "find us" |

The last four are repeating fields — one field holds a whole list. They are
what make a page look designed rather than typed, so prefer them over inventing
five separate text fields.

### Rules for the fields you recommend

- **Keys are lowercase letters, digits and underscores only** — `card_icon`,
  not `cardIcon` or `card-icon`. The CMS rejects anything else.
- Enter the key **without** any prefix. The CMS stores it prefixed with the
  content type slug, so `details` on `programs` becomes `programs_details`.
  Your HTML must use the **prefixed** form.
- Keep the set small. Four well-chosen fields beat ten that an editor will leave
  blank.
- Mark a field required only if a page genuinely breaks without it.
- Give every field a human label — it is what the editor sees.

Present each recommendation as a table:

| Key | Label | Type | Required | Why |
|-----|-------|------|----------|-----|
| `details` | At a glance | `labelvalue` | No | Key facts panel on the detail page |

---

## Arc CMS template syntax

A template is plain HTML with `data-arc-*` attributes. At publish time the CMS
walks the HTML and injects data. No framework, no build step.

### Binding a value

```html
<h1 data-arc-bind="title">Placeholder Title</h1>
```

The element's existing content is the **placeholder** — what a designer sees,
replaced at render time. Always write a sensible placeholder.

`data-arc-bind` adapts to the element:

| Element | What the value sets |
|---------|---------------------|
| `<img>` | `src` (and `alt` from the item title) |
| `<a>` | `href` |
| `<iframe>` | `src` |
| `<time>` | `datetime` plus formatted text |
| `<input>`, `<select>` | `value` |
| anything else | inner text, or inner HTML if the value contains tags |

### Interpolation

`{{ key }}` works in text **and in any attribute**:

```html
<a href="{{ langPrefix }}/{{ contentTypeSlug }}">Back</a>
<i class="card-icon {{ programs_card_icon }}"></i>
```

Dots (`share.twitter`) and hyphens (`awards-recognition_subtitle`) are both fine.

### Conditionals

```html
<div data-arc-if="coverImage">
    <img data-arc-bind="coverImage" alt="">
</div>
```

The element is **removed entirely** when the value is empty or missing. This is
how an optional field stays optional.

### Loops

```html
<div class="grid" data-arc-loop="items" data-limit="12">
    <article class="card">
        <h2 data-arc-bind="title">Title</h2>
    </article>
</div>
```

- The container's **first child is the row template**. It repeats once per item;
  anything else inside the container is discarded. Write exactly one card.
- `data-limit="N"` caps how many render.
- An empty or missing collection **clears the container**, so placeholder rows
  never reach a live page. Give such containers `:empty { display: none }` so
  they leave no gap.
- **Loops cannot nest.** A repeating field renders on a detail page, never
  inside the `items` loop of a list page.

### Other attributes

```html
<div [innerHTML]="programs_body"></div>          <!-- raw HTML, for richtext -->
<i [class]="programs_icon"></i>                  <!-- sets an attribute wholesale -->
<span data-arc-style-background="color"></span>  <!-- sets background-color -->
```

### Page shell

```html
<div class="arc-cms-template">
    <arc-header></arc-header>
    <!-- page content -->
    <arc-footer></arc-footer>
</div>

<style>
  /* Page CSS goes here, in the same file. */
</style>
```

`<style>` and `<script>` blocks inside the template file work, and are the normal
way to ship page CSS and any small interaction.

---

## Bindings available on every page

### List page

| Binding | Is |
|---------|-----|
| `contentType` | Plural display name — "Programs" |
| `contentTypeSlug` | "programs" |
| `description` | The type's description |
| `langPrefix` | Language path prefix; prepend to internal links |

### Inside `data-arc-loop="items"` (list page)

`title`, `url`, `urlSlug`, `coverImage`, `excerpt`, `content`, `publishedOn`,
`readTime`, `author`, `tagsDisplay`, `id`

### Detail page

Every item binding above, plus:

`metaDescription`, `date`, `readingTime`, `contentType`, `contentTypeSlug`,
`langPrefix`,
`nextContent.title`, `nextContent.url`,
`previousContent.title`, `previousContent.url`,
`share.facebook`, `share.twitter`, `share.linkedin`, `share.whatsapp`,
`share.email`

### Inside `data-arc-loop="tags"` (detail page)

`name`, `color` — pair them:
`data-arc-style-background="color" data-arc-bind="name"`

---

## Rendering each field type

Substitute the real prefixed key for `KEY`.

| Type | Markup |
|------|--------|
| `text`, `number` | `<span data-arc-bind="KEY">Placeholder</span>` |
| `richtext` | `<div [innerHTML]="KEY"></div>` — full HTML, give it room |
| `date`, `datetime` | `<time data-arc-bind="KEY">Jan 1, 2025</time>` |
| `image` | `<img data-arc-bind="KEY" alt="">` — wrap in `data-arc-if` if optional |
| `icon` | `<i class="{{ KEY }}" aria-hidden="true"></i>` — the value is a Font Awesome class list |
| `boolean` | A condition: `<span data-arc-if="KEY">Included</span>` |
| `dropdown`, `radio` | The chosen value, as text |
| `checkbox` | Several values; renders comma-separated |

### Repeating field types

Loop the field key; inside the loop, bind the row's own short names.

**`infocard`** — feature cards. Each row is an icon **or** an image, a headline,
and a paragraph.

```html
<section class="info-cards" data-arc-loop="KEY">
    <article class="info-card">
        <img data-arc-if="image" data-arc-bind="image" alt="">
        <i data-arc-if="icon" class="{{ icon }}" aria-hidden="true"></i>
        <h3 data-arc-bind="headline">Headline</h3>
        <p data-arc-bind="info">Supporting text.</p>
    </article>
</section>
```

Row bindings: `image`, `icon`, `icon_svg`, `icon_label`, `headline`, `info`,
`position`.

**`gallery`** — photos and YouTube videos with captions. Each row is a photo
**or** a video.

```html
<div class="gallery" data-arc-loop="KEY">
    <figure class="gallery-item">
        <img data-arc-if="image" data-arc-bind="image" alt="">
        <button data-arc-if="video_thumb" type="button"
                class="gallery-video" data-embed="{{ video_embed }}">
            <img data-arc-bind="video_thumb" alt="">
        </button>
        <figcaption data-arc-bind="caption">Caption</figcaption>
    </figure>
</div>
```

Row bindings: `image`, `caption`, `video`, `video_id`, `video_embed`,
`video_thumb`, `position`.

> **Render video posters, not iframes.** Each YouTube iframe pulls roughly a
> megabyte of player JavaScript. Show `video_thumb` as a poster and swap in an
> iframe on click with a small `<script>`. Use a bare
> `<iframe data-arc-bind="video_embed">` only if there is at most one video.

**`maplocation`** — map cards. Each row is a name, an address and a point.

```html
<div class="locations" data-arc-loop="KEY">
    <article class="location">
        <iframe data-arc-if="map_embed" data-arc-bind="map_embed"
                loading="lazy" title="Map"></iframe>
        <h4 data-arc-bind="label">Location name</h4>
        <p data-arc-bind="address">Street, City</p>
        <a data-arc-if="map_directions" data-arc-bind="map_directions">Get directions</a>
    </article>
</div>
```

Row bindings: `label`, `address`, `lat`, `lng`, `map_embed`, `map_directions`,
`map_view`, `position`. The map is a keyless OpenStreetMap frame — no API key
and no script. Always wrap it in `data-arc-if="map_embed"`, or a row where no
marker was placed renders a map of the Atlantic.

**`labelvalue`** — an "at a glance" facts card. Rows of label and value, plus an
editable heading bound **outside** the loop.

```html
<section class="glance" data-arc-if="KEY">
    <h3 data-arc-if="KEY_heading" data-arc-bind="KEY_heading">At a glance</h3>
    <dl class="glance-list" data-arc-loop="KEY">
        <div class="glance-row">
            <dt data-arc-bind="label">Label</dt>
            <dd data-arc-bind="value">Value</dd>
        </div>
    </dl>
</section>
```

Row bindings: `label`, `value`, `position`. The heading key is the field key with
`_heading` appended.

---

## Gotchas

**Optional fields need `data-arc-if`.** A field empty on some items otherwise
leaves an empty element and a hole in the layout.

**Empty loop containers keep their box.** Add `:empty { display: none }` to any
container with a margin, border or padding.

**One card per loop.** Writing three cards inside a `data-arc-loop` does not give
three columns — only the first survives, repeated per item.

**Repeating fields cannot go on a list page.** No nested loops. A list card can
show `title`, `excerpt`, `coverImage`, `tagsDisplay` and any *scalar* custom
field — not an `infocard`, `gallery` or `labelvalue`.

**Assume Bootstrap 5.3 and Font Awesome 6.5 are loaded**, plus the site's own
`main.css`. Use their classes freely; put everything else in a `<style>` block.

---

## What to hand back

Per content type, in this order:

1. **The field recommendation table**, with a one-line rationale each.
2. **`<slug>/list.html`**
3. **`<slug>/detail.html`**
4. **A short design note** — the idea behind the page, and which built-ins and
   recommended fields each page uses.

Every page must:

- Be a **complete standalone page** — `<div class="arc-cms-template">` with
  `<arc-header>` / `<arc-footer>` and its own `<style>` block.
- Bind **only** to that type's recommended fields and the universal built-ins.
- Carry **realistic placeholder content**, so the mockup can be opened in a
  browser and judged as a design.
- Be responsive, and use semantic HTML (`<article>`, `<figure>`, `<dl>`,
  headings in order).
- Give images `alt` text and decorative icons `aria-hidden="true"`.
- Match the home page mockup's colours, type scale, spacing and component style.

### Before you return, check

- [ ] Every `data-arc-bind` / `data-arc-loop` name is either a built-in or a field you recommended for **that** type
- [ ] No recommended field duplicates a built-in
- [ ] Every recommended key is lowercase letters, digits and underscores
- [ ] HTML uses the **slug-prefixed** key; the recommendation table shows the **unprefixed** key to type into the CMS
- [ ] Each loop container holds exactly **one** child row
- [ ] Optional fields are wrapped in `data-arc-if`
- [ ] No repeating field appears on a list page
- [ ] Internal links start with `{{ langPrefix }}`
- [ ] Placeholder copy is realistic but generic — no invented client claims or statistics
- [ ] The pages look like the home page mockup

---

## Appendix: checking the real keys afterwards

Once the recommended fields have been created in the CMS, this prints the actual
stored keys so the HTML can be checked against them. Open
**Admin → Contents → Content Types**, then the browser console:

```js
(() => {
  let page = null;
  const walk = (n, d) => {
    if (!n || d > 10 || page) return;
    const c = window.ng?.getComponent(n);
    if (c?.contentTypesStore) { page = c; return; }
    for (const ch of n.children || []) walk(ch, d + 1);
  };
  walk(document.body, 0);
  if (!page) return 'Run this on the Content Types page.';

  const types = page.contentTypesStore.items().map(t => ({
    name: t.name,
    slug: t.slug,
    fields: (t.fields || []).map(f => ({ key: f.key, label: f.label, type: f.type, required: !!f.required })),
  }));

  console.log(JSON.stringify(types, null, 2));
  return `${types.length} content types — copy the JSON above.`;
})()
```
