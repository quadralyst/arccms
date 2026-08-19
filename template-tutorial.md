# Template Tutorial - Creating Custom Templates for Arc CMS

This guide explains how to create custom templates for your content types in Arc CMS.

## Overview

Arc CMS uses a template hydration system that allows you to create beautiful, custom HTML templates for your content list and detail pages. Templates are placed in the `public/templates/` folder and linked to content types via the admin panel.

---

## Step 1: Create a Template Folder

1. Navigate to `/public/templates/`
2. Create a new folder with a descriptive name (e.g., `articles`, `blog`, `products`)

```
public/
└── templates/
    ├── default/           # Built-in default templates
    ├── articles/          # Your custom template folder
    │   ├── list.html      # List page template
    │   ├── detail.html    # Detail page template  
    │   └── partials.html  # Embeddable partials template
    └── templates.json     # Template registry
```

---

## Step 2: Register the Template

Add your template folder to `templates.json`:

```json
[
    {
        "name": "default",
        "displayName": "Default Templates"
    },
    {
        "name": "articles",
        "displayName": "Articles - Apple Inspired"
    }
]
```

---

## Step 3: Create the List Template

Create `list.html` in your template folder:

```html
<div class="arc-cms-template">
    <arc-header></arc-header>
    
    <!-- Hero Section -->
    <section class="hero">
        <h1 data-arc-bind="contentType">Content Type Name</h1>
        <p data-arc-bind="description">Description goes here</p>
    </section>

    <!-- Content Grid -->
    <section class="content-grid">
        <div class="grid" data-arc-loop="items" data-limit="12">
            <a class="card" data-arc-bind="url">
                <img data-arc-bind="coverImage" alt="">
                <h2 data-arc-bind="title">Title</h2>
                <p data-arc-bind="excerpt">Excerpt...</p>
                <time data-arc-bind="publishedOn">Date</time>
                <span data-arc-bind="readTime">5</span> min read
            </a>
        </div>
    </section>

    <arc-footer></arc-footer>
</div>

<style>
    /* Your custom CSS here */
</style>
```

---

## Step 4: Create the Detail Template

Create `detail.html` in your template folder:

```html
<div class="arc-cms-template">
    <arc-header></arc-header>
    
    <!-- Article Header -->
    <header class="article-header">
        <h1 data-arc-bind="title">Article Title</h1>
        <div class="meta">
            <time data-arc-bind="publishedOn">Published Date</time>
            <span data-arc-bind="readTime">5</span> min read
        </div>
        <img data-arc-bind="coverImage" alt="">
    </header>

    <!-- Article Content -->
    <article class="content" data-arc-bind="content">
        Article body content...
    </article>

    <arc-footer></arc-footer>
</div>

<style>
    /* Your custom CSS here */
</style>
```

---

## Step 5: Link Template to Content Type

1. Go to **Admin → Contents → Content Types**
2. Edit your content type (e.g., "Articles")
3. In the **Template Folder** dropdown, select your new template
4. Save the content type

---

## Available Data Bindings

### List Page (`data-arc-bind`)

| Attribute | Description | Example Value |
|-----------|-------------|---------------|
| `contentType` | Name of the content type | "Articles" |
| `contentTypeSlug` | URL slug of the content type | "articles" |
| `contentTypeDescription` | Content type description | "Latest blog posts" |

### List Page Loop (`data-arc-loop="items"`)

| Attribute | Description | Example Value |
|-----------|-------------|---------------|
| `title` | Content title | "Getting Started" |
| `url` | Full URL to content | "/articles/my-article" |
| `urlSlug` | URL slug only | "my-article" |
| `coverImage` | Cover image URL | "https://..." |
| `excerpt` | Short excerpt (25 words) | "This is..." |
| `content` | Full HTML content | "<p>...</p>" |
| `publishedOn` | Formatted publish date | "Dec 20, 2024" |
| `readTime` | Read time in minutes | "5" |
| `author` | Author name | "John Doe" |
| `tags` | Array of tag names | ["Tech", "Guide"] |
| `tagsDisplay` | First 3 tags as comma-separated string | "Tech, Guide, News" |
| `id` | Content ID | "abc123" |

### Detail Page (`data-arc-bind`)

All items from the loop above are available, plus:

| Attribute | Description | Example Value |
|-----------|-------------|---------------|
| `title` | Content title | "Getting Started" |
| `content` | Full HTML content | "<p>...</p>" |
| `coverImage` | Cover image URL | "https://..." |
| `publishedOn` | Formatted publish date | "Dec 20, 2024" |
| `readTime` | Read time in minutes | "5" |
| `metaDescription` | SEO meta description | "Learn how to..." |
| `nextContent.title` | Title of next content | "Next Article" |
| `nextContent.url` | URL to next content | "/articles/next" |
| `previousContent.title` | Title of previous content | "Previous Article" |
| `previousContent.url` | URL to previous content | "/articles/prev" |
| `share.facebook` | Facebook share URL | "https://facebook.com..." |
| `share.twitter` | Twitter share URL | "https://twitter.com..." |
| `share.linkedin` | LinkedIn share URL | "https://linkedin.com..." |
| `share.whatsapp` | WhatsApp share URL | "https://wa.me..." |
| `share.email` | Email share URL | "mailto:..." |

### Tags Loop (`data-arc-loop="tags"`)

| Attribute | Description | Example Value |
|-----------|-------------|---------------|
| `name` | Tag name | "Technology" |
| `color` | Tag hex color | "#D81B60" |

**Example usage with colored tag pills:**
```html
<div class="tag-list" data-arc-loop="tags">
    <span class="tag" data-arc-style-background="color" data-arc-bind="name">Tag</span>
</div>
```

Custom fields defined in your content type are also available by their field key.

---

## Custom Fields

Custom fields defined in your content type (via Admin → Contents → Content Types) are automatically available in templates. Use the **field key** (not the label) to bind custom field values.

### Defining Custom Fields

In the Content Types admin panel, you can add custom fields with various types:
- **text**: Single-line text input
- **textarea**: Multi-line text
- **richtext**: Formatted content, edited in the rich-text editor
- **dropdown**: Select from predefined options
- **checkbox**: Boolean true/false
- **number**: Numeric values
- **image**: An image chosen from the Media Manager
- **icon**: A Font Awesome icon, chosen from a searchable icon picker
- **infocard**: A repeating list of cards — icon or image, headline and info
- **gallery**: A repeating list of photos and YouTube videos with captions

Each field has a **key** (used for binding) and a **label** (displayed in admin).

### Using Custom Fields in Templates

Bind custom fields using their **key**:

```html
<!-- For a dropdown field with key "cat" (Category) -->
<span class="category-badge" data-arc-bind="cat">Category</span>

<!-- For a text field with key "author" -->
<span data-arc-bind="author">Author Name</span>

<!-- For a number field with key "price" -->
<span data-arc-bind="price">0</span>
```

### Example: Category Badge in Article List

If you have a dropdown custom field:
- **Key**: `cat`
- **Label**: `Category`
- **Options**: `Help, Articles, News, Updates, Other`

Add to your list template:
```html
<div class="article-meta">
    <time data-arc-bind="publishedOn">Jan 1, 2025</time>
    <span class="meta-separator">•</span>
    <span class="category-badge" data-arc-bind="cat">Category</span>
</div>
```

Style the badge:
```css
.category-badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    background: #e8e8ed;
    border-radius: 100px;
    font-size: 0.75rem;
    font-weight: 500;
    color: #6e6e73;
}
```

### Example: Category in Detail Template

Add to article header:
```html
<div class="article-meta">
    <span><i class="far fa-calendar"></i> <span data-arc-bind="date">January 1, 2025</span></span>
    <span class="meta-separator">·</span>
    <span><i class="far fa-clock"></i> <span data-arc-bind="readingTime">5 min read</span></span>
    <span class="meta-separator">·</span>
    <span><i class="fas fa-folder"></i> <span data-arc-bind="cat">Category</span></span>
</div>
```

### Example: An Icon Field

An `icon` field is a class list, not an image, so bind it to the `class`
attribute of an empty `<i>` rather than with `data-arc-bind`:

```html
<!-- For an icon field with key "card_icon" -->
<i class="card-icon {{ card_icon }}" aria-hidden="true"></i>
```

```css
.card-icon {
    font-size: 1.5rem;
    color: #16a34a;  /* the icon takes this colour */
}
```

The same field also gives you `{{ card_icon_label }}` for an `aria-label`,
`{{ card_icon_name }}` for the bare name, and `{{ card_icon_svg }}` for an
inline SVG fallback. See the **Icons** section of [TEMPLATES.md](TEMPLATES.md) for
when you need each.

### Example: An Info Card Field

An `infocard` field holds a *list* of cards, so it renders with a loop rather
than a single binding. The loop name is the stored field key:

```html
<section class="info-cards" data-arc-loop="programs_info_cards">
    <article class="info-card">
        <img data-arc-if="image" data-arc-bind="image" alt="">
        <i data-arc-if="icon" class="{{ icon }}" aria-hidden="true"></i>
        <h3 data-arc-bind="headline">Headline</h3>
        <p data-arc-bind="info">Info text.</p>
    </article>
</section>
```

Write **one** card inside the container — it is the row template, repeated
once per card. Each card has an icon or an image, never both, and
`data-arc-if` drops whichever is unset. See the **Info Cards** section of
[TEMPLATES.md](TEMPLATES.md) for the full binding list and the limitations.

A `gallery` field works the same way, with `{{ image }}`, `{{ caption }}` and
`{{ video_embed }}` / `{{ video_thumb }}` per row — see **Galleries** in
[TEMPLATES.md](TEMPLATES.md), which also explains why you should render video
posters rather than a page full of iframes.

### Notes

- Custom fields are available in **list**, **detail**, and **partials** templates
- **Field keys are stored prefixed with the content type slug** — a key of
  `subtitle` on `awards-recognition` binds as `awards-recognition_subtitle`.
  Copy the key shown in the Content Types admin
- Repeating fields (`infocard`, `gallery`) render on **detail** and **partials**
  templates only — they cannot be nested inside a list page's `items` loop
- For dropdown fields, the **selected option value** is displayed (not the key)
- If a custom field is empty or not set, the placeholder text remains
- Custom field keys are case-sensitive
- `icon` fields bind into a `class` attribute, not with `data-arc-bind` — using
  `data-arc-bind` would print the class list as visible text

## Special Template Features

### 1. Loop with Limit

Limit the number of items displayed:

```html
<div data-arc-loop="items" data-limit="6">
    <!-- Shows only 6 items -->
</div>
```

### 2. Image Error Handling

Show a placeholder when images fail to load:

```html
<script>
document.querySelectorAll('.article-image').forEach(img => {
    img.onerror = function() {
        this.style.display = 'none';
        this.parentElement.style.background = 
            'linear-gradient(135deg, #e8e8ed 0%, #d2d2d7 100%)';
    };
});
</script>
```

### 3. Header and Footer Components

Use the built-in components:

```html
<arc-header></arc-header>
<!-- Your content -->
<arc-footer></arc-footer>
```

---

## Complete Example: Articles List Template

```html
<div class="arc-cms-template">
    <arc-header></arc-header>

    <section class="articles-hero">
        <div class="container">
            <h1 class="articles-title" data-arc-bind="contentType">Articles</h1>
            <p class="articles-subtitle" data-arc-bind="description">
                Discover insights and tutorials
            </p>
        </div>
    </section>

    <section class="articles-section">
        <div class="container">
            <div class="articles-grid" data-arc-loop="items" data-limit="12">
                <a class="article-card" data-arc-bind="url">
                    <div class="article-image-wrapper">
                        <img class="article-image" data-arc-bind="coverImage" alt="">
                    </div>
                    <div class="article-content">
                        <div class="article-meta">
                            <time data-arc-bind="publishedOn">Jan 1, 2025</time>
                            <span>•</span>
                            <span data-arc-bind="readTime">5</span> min read
                        </div>
                        <h2 class="article-title" data-arc-bind="title">Title</h2>
                        <p class="article-excerpt" data-arc-bind="excerpt">Excerpt...</p>
                        <span class="article-read-more">
                            Read Article <i class="fas fa-arrow-right"></i>
                        </span>
                    </div>
                </a>
            </div>
        </div>
    </section>

    <arc-footer></arc-footer>
</div>

<style>
.articles-hero {
    padding: 6rem 0 4rem;
    text-align: center;
    background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%);
}

.articles-title {
    font-size: 3.5rem;
    font-weight: 700;
    color: #1d1d1f;
}

.articles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 2rem;
}

.article-card {
    background: #ffffff;
    border-radius: 20px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    box-shadow: 0 2px 20px rgba(0, 0, 0, 0.06);
}

.article-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
}

.article-image-wrapper {
    height: 200px;
    overflow: hidden;
    background: #f5f5f7;
}

.article-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.article-content {
    padding: 1.5rem;
}

.article-title {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
}

.article-meta {
    font-size: 0.85rem;
    color: #6e6e73;
    margin-bottom: 0.75rem;
}
</style>

<script>
// Image error handler - show gradient placeholder
(function() {
    function handleImageError(img) {
        img.style.display = 'none';
        img.parentElement.style.background = 
            'linear-gradient(135deg, #e8e8ed 0%, #d2d2d7 100%)';
    }

    document.querySelectorAll('.article-image').forEach(function(img) {
        if (!img.src || (img.complete && img.naturalHeight === 0)) {
            handleImageError(img);
        }
        img.onerror = function() { handleImageError(this); };
    });
    
    // Handle dynamic content
    setTimeout(function() {
        document.querySelectorAll('.article-image').forEach(function(img) {
            if (img.complete && img.naturalHeight === 0) {
                handleImageError(img);
            }
        });
    }, 1000);
})();
</script>
```

---

## Content Partials (Embeddable Sections)

Content Partials allow you to embed content cards from any content type into any page. This is useful for showing "Recent Articles", "Featured Posts", etc.

### Using Content Partials

Add the `<arc-content-partials>` component in any HTML file:

```html
<!-- Display last 4 articles -->
<arc-content-partials 
    contentType="articles" 
    [count]="4" 
    sectionTitle="Latest Articles">
</arc-content-partials>
```

### Available Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `contentType` | string | `''` | Content type slug (e.g., 'articles') |
| `count` | number | `6` | Maximum cards to display |
| `sectionTitle` | string | `''` | Section heading (defaults to "Latest {ContentType}") |
| `templateFolder` | string | `''` | Override template folder |

### Creating a Partials Template

Create `partials.html` in your template folder:

```html
<section class="articles-partials-section">
    <div class="container">
        <div class="articles-partials-header">
            <h2 data-arc-bind="sectionTitle">Latest Articles</h2>
            <a href="/articles" class="view-all">View All →</a>
        </div>

        <div class="articles-grid" data-arc-loop="items" data-limit="6">
            <a class="article-card" data-arc-bind="url">
                <img data-arc-bind="coverImage" alt="">
                <h3 data-arc-bind="title">Title</h3>
                <p data-arc-bind="excerpt">Excerpt...</p>
                <time data-arc-bind="publishedOn">Date</time>
            </a>
        </div>
    </div>
</section>

<style>
    .articles-partials-section {
        padding: 4rem 0;
        background: #f5f5f7;
    }
    /* Add your custom styles */
</style>
```

### Key Differences from List Templates

| Feature | List Template | Partials Template |
|---------|---------------|-------------------|
| **File name** | `list.html` | `partials.html` |
| **Header/Footer** | Includes `<arc-header>` / `<arc-footer>` | No header/footer (embeddable) |
| **Use case** | Full page at `/{content-type}` | Embedded in other pages |
| **Binding** | `contentType`, `description` | `sectionTitle` |

---

## Tips for Great Templates

1. **Use semantic HTML** - Improves SEO and accessibility
2. **Add responsive styles** - Use CSS Grid/Flexbox and media queries
3. **Include hover effects** - Makes the UI feel interactive
4. **Handle missing images** - Show placeholder gradients
5. **Use consistent spacing** - Follow a design system
6. **Test with different content** - Verify with long titles, missing images, etc.
