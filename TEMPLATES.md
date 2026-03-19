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
