# Template Customization Guide

This guide explains how to customize the files in `public/` and `public/templates/` to suit your project's design needs — including creating new templates, modifying existing ones, and working with static pages.

---

## How Templates Work

Arc CMS uses a **template hydration system**. You write plain HTML/CSS templates with special `data-arc-*` attributes. At render time, Arc CMS injects your content data into these templates — no JavaScript framework knowledge required.

```
public/
├── templates/             # Content type templates
│   ├── templates.json     # Template registry
│   ├── articles/          # Template folder for "articles" content type
│   │   ├── list.html      # List/grid page
│   │   ├── detail.html    # Single item page
│   │   └── partials.html  # Embeddable card sections
│   └── manuals/           # Another template folder
│       ├── list.html
│       ├── detail.html
│       └── partials.html
├── _partials/             # Global header/footer partials
├── pages/                 # Static HTML pages
└── assets/                # CSS, images, compiled assets
```

---

## Creating a New Template

### Step 1: Create the Template Folder

Create a new folder under `public/templates/` with a descriptive name:

```bash
mkdir public/templates/blog
```

### Step 2: Register the Template

Add your template to `public/templates/templates.json`:

```json
{
    "folders": ["articles", "manuals", "blog"]
}
```

Your template folder name will appear in the **Template Folder** dropdown when editing content types in the admin panel.

### Step 3: Create Template Files

Each template folder can contain up to three files:

| File | Purpose | URL Pattern |
|------|---------|-------------|
| `list.html` | Displays a grid/list of all items | `/{content-type}` |
| `detail.html` | Displays a single content item | `/{content-type}/{slug}` |
| `partials.html` | Embeddable content cards for use on other pages | N/A (embedded) |

### Step 4: Link Template to Content Type

1. Go to **Admin > Contents > Content Types**
2. Edit your content type
3. Select your new template from the **Template Folder** dropdown
4. Save

---

## Template Syntax Reference

### Data Binding

Use `data-arc-bind` to inject content values into elements:

```html
<h1 data-arc-bind="title">Placeholder Title</h1>
<p data-arc-bind="excerpt">Placeholder excerpt text...</p>
<img data-arc-bind="coverImage" alt="Cover">
<time data-arc-bind="publishedOn">Jan 1, 2025</time>
```

The placeholder text is replaced with actual content at render time.

### Loops

Use `data-arc-loop` to repeat elements for collections:

```html
<div class="grid" data-arc-loop="items" data-limit="12">
    <a class="card" data-arc-bind="url">
        <h2 data-arc-bind="title">Title</h2>
        <p data-arc-bind="excerpt">Excerpt...</p>
    </a>
</div>
```

- `data-arc-loop="items"` — Loops over content items
- `data-arc-loop="tags"` — Loops over tags
- `data-limit="N"` — Limits the number of items displayed

### Style Binding

Use `data-arc-style-*` to dynamically set CSS properties:

```html
<span class="tag" data-arc-style-background="color" data-arc-bind="name">Tag</span>
```

This sets `background: {color value}` on the element.

### URL Binding

For `<a>` tags, `data-arc-bind="url"` sets the `href` attribute:

```html
<a data-arc-bind="url">Read More</a>
<!-- Renders as: <a href="/articles/my-post">Read More</a> -->
```

### Header and Footer

Include the global header and footer components:

```html
<div class="arc-cms-template">
    <arc-header></arc-header>
    <!-- Your template content -->
    <arc-footer></arc-footer>
</div>
```

> **Note:** Do NOT include `<arc-header>` / `<arc-footer>` in `partials.html` — partials are embedded within other pages that already have them.

---

## Available Data Bindings

### List Page Bindings

| Binding | Description | Example |
|---------|-------------|---------|
| `contentType` | Content type display name | "Articles" |
| `contentTypeSlug` | URL slug | "articles" |
| `description` | Content type description | "Latest blog posts" |

### Item Bindings (inside `data-arc-loop="items"`)

| Binding | Description | Example |
|---------|-------------|---------|
| `title` | Content title | "Getting Started" |
| `url` | Full URL path | "/articles/my-article" |
| `urlSlug` | URL slug only | "my-article" |
| `coverImage` | Cover image URL | "https://..." |
| `excerpt` | Short excerpt (25 words) | "This is a short..." |
| `content` | Full HTML content | "`<p>...</p>`" |
| `publishedOn` | Formatted date | "Dec 20, 2024" |
| `readTime` | Read time in minutes | "5" |
| `author` | Author name | "John Doe" |
| `tags` | Array of tag objects | `[{name, color}]` |
| `tagsDisplay` | First 3 tags as comma string | "Tech, Guide, News" |
| `id` | Content document ID | "abc123" |

### Detail Page Bindings

All item bindings above, plus:

| Binding | Description | Example |
|---------|-------------|---------|
| `metaDescription` | SEO meta description | "Learn how to..." |
| `nextContent.title` | Next content title | "Next Article" |
| `nextContent.url` | Next content URL | "/articles/next" |
| `previousContent.title` | Previous content title | "Previous Article" |
| `previousContent.url` | Previous content URL | "/articles/prev" |
| `share.facebook` | Facebook share URL | "https://facebook.com/..." |
| `share.twitter` | Twitter/X share URL | "https://twitter.com/..." |
| `share.linkedin` | LinkedIn share URL | "https://linkedin.com/..." |
| `share.whatsapp` | WhatsApp share URL | "https://wa.me/..." |
| `share.email` | Email share URL | "mailto:..." |

### Tags Loop Bindings (inside `data-arc-loop="tags"`)

| Binding | Description | Example |
|---------|-------------|---------|
| `name` | Tag name | "Technology" |
| `color` | Tag hex color | "#D81B60" |

### Partials Bindings

| Binding | Description | Example |
|---------|-------------|---------|
| `sectionTitle` | Section heading | "Latest Articles" |

Plus all item bindings inside `data-arc-loop="items"`.

### Custom Field Bindings

Any custom fields you define on a content type are automatically available using the field **key**:

```html
<!-- Dropdown field with key "cat" -->
<span data-arc-bind="cat">Category</span>

<!-- Number field with key "price" -->
<span data-arc-bind="price">0</span>
```

> **Field keys are prefixed with the content type slug.** Enter `subtitle` as
> the key on a content type slugged `awards-recognition` and it is stored — and
> bound — as `awards-recognition_subtitle`. Check the key shown in
> **Admin > Contents > Content Types** if a binding renders blank; the examples
> below use short keys for readability.

---

## Info Cards and other repeating fields

Some fields hold a **list of rows** rather than one value. An **Info Card**
field is the first: each row is an icon or image, a headline, and a short
paragraph — the row of feature cards you see under a page hero.

Repeating fields render with `data-arc-loop`, the same mechanism as `items`
and `tags`.

### Adding an Info Card field

1. **Admin > Contents > Content Types**, edit your type, add a field.
2. Set **Type** to `infocard` and give it a key, e.g. `info_cards`. Remember
   the stored key gains the slug prefix — `programs_info_cards` on a type
   slugged `programs`.
3. When editing content, add a card, pick an icon *or* an image for it, and
   fill in the headline and info. **Position** sets the display order; the
   list re-sorts when you leave the field.

### Rendering the cards

The loop name is the **stored field key**. Inside the loop each row exposes
its sub-fields by their own short names:

| Binding | Contains |
|---------|----------|
| `{{ headline }}` | The card's headline |
| `{{ info }}` | The card's paragraph |
| `{{ icon }}` | Icon class list, or empty when the card uses an image |
| `{{ image }}` | Image URL, or empty when the card uses an icon |
| `{{ icon_svg }}` | Inline SVG fallback for the icon |
| `{{ position }}` | The row's sort number |

A card has an icon **or** an image, never both. `data-arc-if` removes the one
that is not set, so a single template handles either:

```html
<section class="info-cards" data-arc-loop="programs_info_cards">
    <article class="info-card">
        <span class="info-card-visual">
            <img data-arc-if="image" data-arc-bind="image" alt="">
            <i data-arc-if="icon" class="{{ icon }}" aria-hidden="true"></i>
        </span>
        <h3 data-arc-bind="headline">Find volunteering opportunities</h3>
        <p data-arc-bind="info">Browse verified needs near you.</p>
    </article>
</section>
```

The container's **first child is the row template** — it is repeated once per
card and everything else inside the container is discarded. Write exactly one
card and let the loop multiply it.

An empty field clears the container, so the placeholder card above never
reaches a published page.

```css
.info-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
.info-card { padding: 1.25rem; border: 1px solid #d8ede0; border-radius: 12px; background: #f2faf5; }
.info-card-visual i { font-size: 1.25rem; color: #16a34a; }
.info-card-visual img { width: 2.5rem; height: 2.5rem; object-fit: cover; border-radius: 8px; }
```

### Ordering

Rows are stored in **Position** order, so a template loops and renders — no
sorting needed. Positions renumber to 1, 2, 3… whenever a row is reordered or
removed, so there are never gaps.

### Limitations

- **No nested loops.** A repeating field renders on a **detail** page or in a
  **partial**. It will *not* render inside `data-arc-loop="items"` on a list
  page: rows inside a loop are not looped again.
- **Not yet translatable.** Headlines and info text stay in the default
  language on every translated page. Every row carries a stable id ready for
  this, but the translation tabs do not offer repeating fields yet.
- **Not importable.** Bulk CSV import skips repeating fields — one cell
  cannot express a list of rows. Add the cards in the editor.
- **Not shown in the contents list.** Rows have no useful one-cell summary,
  so a repeating field is never offered as a list column.

---

## Icons

The **Icon** custom field type lets an editor pick from the full Font Awesome
Free library (1,873 icons across solid, regular and brands) instead of
uploading an image. Use it wherever a template needs a small symbol — feature
cards, list bullets, category markers, callouts.

An icon is not an image. It has no file, no URL and no fixed colour: it takes
the text colour of whatever it sits inside, so the same icon works on a light
card, a dark footer and a themed accent without anyone re-exporting anything.

### Adding an Icon field

1. Go to **Admin > Contents > Content Types** and edit your content type.
2. Add a field, set its **Type** to `icon`, and give it a key (e.g. `card_icon`).
   Field keys must be lowercase letters, digits and underscores — `^[a-z0-9_]+$`
   — and are then stored prefixed with the content type slug, so the binding
   for `card_icon` on `articles` is `articles_card_icon`.
3. When editing content, that field opens an icon picker. Search by name, by
   label, or by what the icon *means* — "search", "trophy", "chart" all work.
   The picker offers icons only; the image tabs are hidden, because a photo
   is not something an icon field can store.

### Rendering an icon

One picked icon gives you four bindings, all derived from the field key:

| Binding | Contains | Use for |
|---------|----------|---------|
| `{{ card_icon }}` | `fa-solid fa-magnifying-glass` | The class list — **this is the usual one** |
| `{{ card_icon_label }}` | `Magnifying Glass` | An `aria-label` when the icon is meaningful |
| `{{ card_icon_name }}` | `magnifying-glass` | The bare name, e.g. as a CSS hook |
| `{{ card_icon_svg }}` | `<svg …>` | Inline SVG fallback — see below |

Substitute your own **stored** field key for `card_icon` throughout — including the content type slug prefix.

The normal way to render one is an empty `<i>` with the class interpolated:

```html
<i class="card-icon {{ card_icon }}" aria-hidden="true"></i>
```

Keep your own classes alongside it — `card-icon` above is yours, and you size
and colour the icon through it:

```css
.card-icon {
    font-size: 1.5rem;
    color: var(--brand-green);  /* the icon inherits this */
}
```

### A complete info card

```html
<div class="cards" data-arc-loop="items">
    <a class="card" data-arc-bind="url">
        <span class="card-icon-badge">
            <i class="{{ card_icon }}" aria-hidden="true"></i>
        </span>
        <h3 data-arc-bind="title">Find volunteering opportunities</h3>
        <p data-arc-bind="excerpt">Browse verified needs near you.</p>
    </a>
</div>
```

### Accessibility

Decide whether the icon *means* something or merely decorates:

```html
<!-- Decorative: the heading beside it already says everything -->
<i class="{{ card_icon }}" aria-hidden="true"></i>

<!-- Meaningful: the icon is the only label -->
<i class="{{ card_icon }}" role="img" aria-label="{{ card_icon_label }}"></i>
```

Default to `aria-hidden="true"`. Most template icons sit next to text that
already carries the meaning, and announcing both makes the page read twice.

### If your site does not load Font Awesome

Icons render from a stylesheet, and by default Arc CMS puts Font Awesome 6.5.1
on every published page. That list lives in **Settings > Site** as `cssUrls`.
If you replace it with your own stylesheets and drop Font Awesome, every
`<i class="{{ card_icon }}">` on the site becomes an empty box.

Every icon also stores its own inline SVG, so a template can render without
the stylesheet entirely:

```html
<span class="card-icon" data-arc-bind="card_icon_svg"></span>
```

```css
.card-icon svg {
    width: 1.5rem;
    height: 1.5rem;
    /* The SVG uses fill="currentColor", so it inherits this. */
    color: var(--brand-green);
}
```

This is heavier — the markup repeats for every item in a loop — so prefer the
class binding unless you have actually removed Font Awesome.

### Adding icons to the library

The picker reads generated files under `public/assets/icons/`, built from the
`@fortawesome/fontawesome-free` package:

```bash
npm run icons:index
```

Run it after upgrading that package, and keep the package version in step with
the Font Awesome stylesheet in `cssUrls` — an index built from a newer release
offers class names the older stylesheet cannot draw. A test enforces both.

---

## List Template Example

```html
<div class="arc-cms-template">
    <arc-header></arc-header>

    <section class="hero">
        <h1 data-arc-bind="contentType">Articles</h1>
        <p data-arc-bind="description">Discover insights and tutorials</p>
    </section>

    <section class="content-grid">
        <div class="grid" data-arc-loop="items" data-limit="12">
            <a class="card" data-arc-bind="url">
                <div class="card-image">
                    <img data-arc-bind="coverImage" alt="">
                </div>
                <div class="card-body">
                    <div class="meta">
                        <time data-arc-bind="publishedOn">Jan 1, 2025</time>
                        <span>&middot;</span>
                        <span data-arc-bind="readTime">5</span> min read
                    </div>
                    <h2 data-arc-bind="title">Title</h2>
                    <p data-arc-bind="excerpt">Excerpt...</p>
                </div>
            </a>
        </div>
    </section>

    <arc-footer></arc-footer>
</div>

<style>
.hero {
    padding: 6rem 2rem 4rem;
    text-align: center;
    background: linear-gradient(180deg, #f5f5f7 0%, #fff 100%);
}
.hero h1 { font-size: 3rem; font-weight: 700; color: #1d1d1f; }
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 2rem;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
}
.card {
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    box-shadow: 0 2px 20px rgba(0,0,0,0.06);
    transition: transform 0.3s, box-shadow 0.3s;
}
.card:hover {
    transform: translateY(-6px);
    box-shadow: 0 12px 40px rgba(0,0,0,0.12);
}
.card-image { height: 200px; overflow: hidden; background: #f5f5f7; }
.card-image img { width: 100%; height: 100%; object-fit: cover; }
.card-body { padding: 1.5rem; }
.card-body h2 { font-size: 1.25rem; font-weight: 600; margin: 0.5rem 0; }
.meta { font-size: 0.85rem; color: #6e6e73; }
</style>
```

---

## Detail Template Example

```html
<div class="arc-cms-template">
    <arc-header></arc-header>

    <article class="article">
        <header class="article-header">
            <h1 data-arc-bind="title">Article Title</h1>
            <div class="meta">
                <time data-arc-bind="publishedOn">Jan 1, 2025</time>
                <span>&middot;</span>
                <span data-arc-bind="readTime">5</span> min read
            </div>
            <div class="tags" data-arc-loop="tags">
                <span class="tag" data-arc-style-background="color" data-arc-bind="name">Tag</span>
            </div>
            <img class="cover" data-arc-bind="coverImage" alt="">
        </header>

        <div class="article-body" data-arc-bind="content">
            Content goes here...
        </div>

        <div class="share-links">
            <a data-arc-bind="share.twitter">Twitter</a>
            <a data-arc-bind="share.facebook">Facebook</a>
            <a data-arc-bind="share.linkedin">LinkedIn</a>
            <a data-arc-bind="share.whatsapp">WhatsApp</a>
            <a data-arc-bind="share.email">Email</a>
        </div>

        <nav class="article-nav">
            <a data-arc-bind="previousContent.url">
                &larr; <span data-arc-bind="previousContent.title">Previous</span>
            </a>
            <a data-arc-bind="nextContent.url">
                <span data-arc-bind="nextContent.title">Next</span> &rarr;
            </a>
        </nav>
    </article>

    <arc-footer></arc-footer>
</div>

<style>
.article { max-width: 780px; margin: 0 auto; padding: 2rem; }
.article-header { text-align: center; margin-bottom: 3rem; }
.article-header h1 { font-size: 2.5rem; font-weight: 700; }
.cover { width: 100%; border-radius: 12px; margin-top: 2rem; }
.article-body { font-size: 1.1rem; line-height: 1.8; }
.tag {
    display: inline-block;
    padding: 0.2rem 0.8rem;
    border-radius: 100px;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 500;
}
.share-links { display: flex; gap: 1rem; margin: 3rem 0; }
.article-nav { display: flex; justify-content: space-between; margin: 2rem 0; }
</style>
```

---

## Partials Template Example

Partials are embeddable sections used on other pages (e.g., "Latest Articles" on the home page).

```html
<section class="partials-section">
    <div class="container">
        <h2 data-arc-bind="sectionTitle">Latest Articles</h2>
        <div class="grid" data-arc-loop="items" data-limit="4">
            <a class="card" data-arc-bind="url">
                <img data-arc-bind="coverImage" alt="">
                <h3 data-arc-bind="title">Title</h3>
                <p data-arc-bind="excerpt">Excerpt...</p>
            </a>
        </div>
    </div>
</section>

<style>
.partials-section { padding: 4rem 2rem; background: #f5f5f7; }
.partials-section .container { max-width: 1200px; margin: 0 auto; }
.partials-section .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.5rem;
}
</style>
```

Use partials in any page with the `<arc-content-partials>` component:

```html
<arc-content-partials
    contentType="articles"
    [count]="4"
    sectionTitle="Latest Articles">
</arc-content-partials>
```

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `contentType` | string | `''` | Content type slug |
| `count` | number | `6` | Max cards to display |
| `sectionTitle` | string | `''` | Section heading |
| `templateFolder` | string | `''` | Override template folder |

---

## Customizing Static Pages

Static pages live in `public/pages/` and are served at `/p/{filename}` (redirected to `/pages/{filename}`).

You can create any HTML file here for static content pages like About, Contact, Terms, etc.

---

## Customizing Header and Footer

Global header and footer partials are in `public/_partials/`. Edit these files to change the site-wide navigation and footer across all template pages.

---

## Customizing Assets

Static assets (CSS, images, fonts) can be placed in:
- `public/assets/` — Available at `/assets/` in the browser
- `src/assets/` — Bundled by Vite during build

---

## Tips

1. **Use semantic HTML** — Improves SEO and accessibility
2. **Make it responsive** — Use CSS Grid/Flexbox and media queries
3. **Handle missing images** — Show placeholder gradients when images fail to load:
   ```javascript
   document.querySelectorAll('img').forEach(img => {
       img.onerror = function() {
           this.style.display = 'none';
           this.parentElement.style.background =
               'linear-gradient(135deg, #e8e8ed 0%, #d2d2d7 100%)';
       };
   });
   ```
4. **Test with varied content** — Long titles, missing images, empty fields
5. **Keep styles scoped** — Use class prefixes to avoid CSS conflicts
6. **Embed styles in the template** — Each template file can include its own `<style>` block
