import { CollectionReferenceConfig, ContentType, ContentTypeField, ContentTypeFieldType, contentTypeDescription, contentTypeName, contentTypeSingularName, pruneNameTranslations, contentTypeFieldLabel, pruneFieldLabelTranslations } from './content-types.model';
import {
    contentTypeDescription as contentTypeDescriptionServer,
    contentTypeName as contentTypeNameServer,
    contentTypeSingularName as contentTypeSingularNameServer,
} from '../../../../../../functions/src/shared/content-type-names';

describe('ContentTypes Model', () => {
    describe('ContentTypeFieldType', () => {
        it('should have text type', () => {
            const type: ContentTypeFieldType = 'text';
            expect(type).toBe('text');
        });

        it('should have number type', () => {
            const type: ContentTypeFieldType = 'number';
            expect(type).toBe('number');
        });

        it('should have richtext type', () => {
            const type: ContentTypeFieldType = 'richtext';
            expect(type).toBe('richtext');
        });

        it('should have date type', () => {
            const type: ContentTypeFieldType = 'date';
            expect(type).toBe('date');
        });

        it('should have image type', () => {
            const type: ContentTypeFieldType = 'image';
            expect(type).toBe('image');
        });

        it('should have boolean type', () => {
            const type: ContentTypeFieldType = 'boolean';
            expect(type).toBe('boolean');
        });
    });

    describe('ContentTypeField', () => {
        it('should create a valid field object', () => {
            const field: ContentTypeField = {
                key: 'title',
                label: 'Title',
                type: 'text',
                required: true,
                order: 0,
            };
            expect(field).toBeDefined();
            expect(field.key).toBe('title');
            expect(field.label).toBe('Title');
            expect(field.type).toBe('text');
            expect(field.required).toBe(true);
            expect(field.order).toBe(0);
        });

        it('should create field with text type', () => {
            const field: ContentTypeField = {
                key: 'description',
                label: 'Description',
                type: 'text',
                required: false,
                order: 1,
            };
            expect(field.type).toBe('text');
        });

        it('should create field with number type', () => {
            const field: ContentTypeField = {
                key: 'age',
                label: 'Age',
                type: 'number',
                required: false,
                order: 2,
            };
            expect(field.type).toBe('number');
        });

        it('should create field with richtext type', () => {
            const field: ContentTypeField = {
                key: 'content',
                label: 'Content',
                type: 'richtext',
                required: true,
                order: 3,
            };
            expect(field.type).toBe('richtext');
        });

        it('should create field with date type', () => {
            const field: ContentTypeField = {
                key: 'publishDate',
                label: 'Publish Date',
                type: 'date',
                required: true,
                order: 4,
            };
            expect(field.type).toBe('date');
        });

        it('should create field with image type', () => {
            const field: ContentTypeField = {
                key: 'thumbnail',
                label: 'Thumbnail',
                type: 'image',
                required: false,
                order: 5,
            };
            expect(field.type).toBe('image');
        });

        it('should create field with boolean type', () => {
            const field: ContentTypeField = {
                key: 'featured',
                label: 'Featured',
                type: 'boolean',
                required: false,
                order: 6,
            };
            expect(field.type).toBe('boolean');
        });

        it('should allow required to be false', () => {
            const field: ContentTypeField = {
                key: 'optional',
                label: 'Optional Field',
                type: 'text',
                required: false,
                order: 0,
            };
            expect(field.required).toBe(false);
        });

        it('should allow required to be true', () => {
            const field: ContentTypeField = {
                key: 'mandatory',
                label: 'Mandatory Field',
                type: 'text',
                required: true,
                order: 0,
            };
            expect(field.required).toBe(true);
        });
    });

    describe('ContentType', () => {
        it('should create a valid content type object', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Article',
                slug: 'article',
                description: 'Article content type',
                icon: 'fa-solid fa-newspaper',
                order: 1,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType).toBeDefined();
            expect(contentType.name).toBe('Article');
            expect(contentType.slug).toBe('article');
        });

        it('should allow optional description', () => {
            const contentType: Partial<ContentType> = {
                name: 'Page',
                slug: 'page',
                order: 0,
                fields: [],
            };
            expect(contentType.description).toBeUndefined();
        });

        it('should allow optional icon', () => {
            const contentType: Partial<ContentType> = {
                name: 'Post',
                slug: 'post',
                order: 0,
                fields: [],
            };
            expect(contentType.icon).toBeUndefined();
        });

        it('should require name field', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Blog',
                slug: 'blog',
                order: 0,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.name).toBeDefined();
            expect(typeof contentType.name).toBe('string');
        });

        it('should require slug field', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'News',
                slug: 'news',
                order: 0,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.slug).toBeDefined();
            expect(typeof contentType.slug).toBe('string');
        });

        it('should require order field', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Event',
                slug: 'event',
                order: 5,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.order).toBeDefined();
            expect(typeof contentType.order).toBe('number');
        });

        it('should require fields array', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Product',
                slug: 'product',
                order: 0,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.fields).toBeDefined();
            expect(Array.isArray(contentType.fields)).toBe(true);
        });

        it('should allow empty fields array', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Category',
                slug: 'category',
                order: 0,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.fields.length).toBe(0);
        });

        it('should allow multiple fields', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Recipe',
                slug: 'recipe',
                order: 0,
                fields: [
                    { key: 'title', label: 'Title', type: 'text', required: true, order: 0 },
                    { key: 'ingredients', label: 'Ingredients', type: 'richtext', required: true, order: 1 },
                    { key: 'prepTime', label: 'Prep Time', type: 'number', required: false, order: 2 },
                ],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.fields.length).toBe(3);
        });

        it('should extend IBaseModel with id', () => {
            const contentType: ContentType = {
                id: 'unique-id-123',
                name: 'Video',
                slug: 'video',
                order: 0,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.id).toBeDefined();
            expect(contentType.id).toBe('unique-id-123');
        });

        it('should extend IBaseModel with timestamps', () => {
            const now = Date.now() / 1000;
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Gallery',
                slug: 'gallery',
                order: 0,
                fields: [],
                createdAt: { seconds: now, nanoseconds: 0 },
                modifiedAt: { seconds: now, nanoseconds: 0 },
            };
            expect(contentType.createdAt).toBeDefined();
            expect(contentType.modifiedAt).toBeDefined();
        });

        it('should allow setting custom icon', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Portfolio',
                slug: 'portfolio',
                icon: 'fa-solid fa-briefcase',
                order: 0,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.icon).toBe('fa-solid fa-briefcase');
        });

        it('should allow setting custom description', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Testimonial',
                slug: 'testimonial',
                description: 'Customer testimonials and reviews',
                order: 0,
                fields: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.description).toBe('Customer testimonials and reviews');
        });

        it('should allow optional templateFolder field', () => {
            const contentType: Partial<ContentType> = {
                name: 'Blog',
                slug: 'blog',
                order: 0,
                fields: [],
            };
            expect(contentType.templateFolder).toBeUndefined();
        });

        it('should allow setting templateFolder to default', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Articles',
                slug: 'articles',
                order: 0,
                fields: [],
                templateFolder: 'default',
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.templateFolder).toBe('default');
        });

        it('should allow setting templateFolder to custom template name', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Posts',
                slug: 'posts',
                order: 0,
                fields: [],
                templateFolder: 'articles',
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.templateFolder).toBe('articles');
        });

        it('should store templateFolder with all other fields in complete content type', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Tutorials',
                singularName: 'Tutorial',
                slug: 'tutorials',
                description: 'Programming tutorials',
                icon: 'fa-solid fa-book',
                order: 2,
                fields: [
                    { key: 'title', label: 'Title', type: 'text', required: true, order: 0 },
                ],
                templateFolder: 'articles',
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.name).toBe('Tutorials');
            expect(contentType.templateFolder).toBe('articles');
            expect(contentType.fields.length).toBe(1);
        });
    });

    describe('CollectionReferenceConfig', () => {
        it('should create a valid collection reference config', () => {
            const config: CollectionReferenceConfig = {
                collectionSlug: 'authors',
                collectionName: 'Authors',
                displayField: 'title',
                valueField: 'id',
                syncFields: ['title', 'urlSlug', 'coverImage'],
            };
            expect(config).toBeDefined();
            expect(config.collectionSlug).toBe('authors');
            expect(config.collectionName).toBe('Authors');
            expect(config.displayField).toBe('title');
            expect(config.valueField).toBe('id');
            expect(config.syncFields).toEqual(['title', 'urlSlug', 'coverImage']);
        });

        it('should allow empty syncFields array', () => {
            const config: CollectionReferenceConfig = {
                collectionSlug: 'categories',
                collectionName: 'Categories',
                displayField: 'name',
                valueField: 'id',
                syncFields: [],
            };
            expect(config.syncFields).toEqual([]);
            expect(config.syncFields.length).toBe(0);
        });

        it('should allow single syncField', () => {
            const config: CollectionReferenceConfig = {
                collectionSlug: 'tags',
                collectionName: 'Tags',
                displayField: 'name',
                valueField: 'id',
                syncFields: ['name'],
            };
            expect(config.syncFields).toEqual(['name']);
            expect(config.syncFields.length).toBe(1);
        });

        it('should store all required fields', () => {
            const config: CollectionReferenceConfig = {
                collectionSlug: 'products',
                collectionName: 'Products',
                displayField: 'productName',
                valueField: 'sku',
                syncFields: ['productName', 'price', 'image'],
            };
            expect(typeof config.collectionSlug).toBe('string');
            expect(typeof config.collectionName).toBe('string');
            expect(typeof config.displayField).toBe('string');
            expect(typeof config.valueField).toBe('string');
            expect(Array.isArray(config.syncFields)).toBe(true);
        });
    });

    describe('ContentTypeField with collection reference', () => {
        it('should create a field with useCollectionRef set to true', () => {
            const field: ContentTypeField = {
                key: 'author',
                label: 'Author',
                type: 'dropdown',
                required: true,
                order: 0,
                useCollectionRef: true,
                collectionRef: {
                    collectionSlug: 'authors',
                    collectionName: 'Authors',
                    displayField: 'title',
                    valueField: 'id',
                    syncFields: ['title', 'urlSlug'],
                },
            };
            expect(field.useCollectionRef).toBe(true);
            expect(field.collectionRef).toBeDefined();
            expect(field.collectionRef!.collectionSlug).toBe('authors');
        });

        it('should default useCollectionRef to undefined when not set', () => {
            const field: ContentTypeField = {
                key: 'category',
                label: 'Category',
                type: 'dropdown',
                required: false,
                order: 1,
                options: 'tech,sports,news',
            };
            expect(field.useCollectionRef).toBeUndefined();
            expect(field.collectionRef).toBeUndefined();
        });

        it('should allow useCollectionRef to be false with manual options', () => {
            const field: ContentTypeField = {
                key: 'status',
                label: 'Status',
                type: 'dropdown',
                required: true,
                order: 2,
                options: 'draft,published,archived',
                useCollectionRef: false,
            };
            expect(field.useCollectionRef).toBe(false);
            expect(field.options).toBe('draft,published,archived');
            expect(field.collectionRef).toBeUndefined();
        });

        it('should allow collectionRef with all syncFields populated', () => {
            const field: ContentTypeField = {
                key: 'relatedProduct',
                label: 'Related Product',
                type: 'dropdown',
                required: false,
                order: 3,
                useCollectionRef: true,
                collectionRef: {
                    collectionSlug: 'products',
                    collectionName: 'Products',
                    displayField: 'productName',
                    valueField: 'sku',
                    syncFields: ['productName', 'price', 'description', 'image'],
                },
            };
            expect(field.collectionRef!.syncFields.length).toBe(4);
            expect(field.collectionRef!.syncFields).toContain('productName');
            expect(field.collectionRef!.syncFields).toContain('price');
        });

        it('should coexist with other field properties', () => {
            const field: ContentTypeField = {
                key: 'author',
                label: 'Author',
                type: 'dropdown',
                required: true,
                order: 5,
                useCollectionRef: true,
                collectionRef: {
                    collectionSlug: 'authors',
                    collectionName: 'Authors',
                    displayField: 'title',
                    valueField: 'id',
                    syncFields: ['title'],
                },
            };
            expect(field.key).toBe('author');
            expect(field.label).toBe('Author');
            expect(field.type).toBe('dropdown');
            expect(field.required).toBe(true);
            expect(field.order).toBe(5);
            expect(field.useCollectionRef).toBe(true);
            expect(field.collectionRef).toBeDefined();
        });
    });

    describe('ContentType with listColumns', () => {
        it('should allow listColumns to be undefined', () => {
            const contentType: Partial<ContentType> = {
                name: 'Articles',
                slug: 'articles',
                order: 0,
                fields: [],
            };
            expect(contentType.listColumns).toBeUndefined();
        });

        it('should allow listColumns as an empty array', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Articles',
                slug: 'articles',
                order: 0,
                fields: [],
                listColumns: [],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.listColumns).toEqual([]);
            expect(contentType.listColumns!.length).toBe(0);
        });

        it('should allow listColumns with field keys', () => {
            const contentType: ContentType = {
                id: 'test-id',
                name: 'Articles',
                slug: 'articles',
                order: 0,
                fields: [
                    { key: 'title', label: 'Title', type: 'text', required: true, order: 0 },
                    { key: 'author', label: 'Author', type: 'text', required: false, order: 1 },
                    { key: 'publishDate', label: 'Publish Date', type: 'date', required: false, order: 2 },
                ],
                listColumns: ['title', 'author', 'publishDate'],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.listColumns).toEqual(['title', 'author', 'publishDate']);
            expect(contentType.listColumns!.length).toBe(3);
        });

        it('should store listColumns alongside all other ContentType fields', () => {
            const contentType: ContentType = {
                id: 'full-id',
                name: 'Blog Posts',
                singularName: 'Blog Post',
                slug: 'blog-posts',
                description: 'Blog post entries',
                icon: 'fa-solid fa-pen',
                order: 1,
                fields: [
                    {
                        key: 'title',
                        label: 'Title',
                        type: 'text',
                        required: true,
                        order: 0,
                    },
                    {
                        key: 'author',
                        label: 'Author',
                        type: 'dropdown',
                        required: true,
                        order: 1,
                        useCollectionRef: true,
                        collectionRef: {
                            collectionSlug: 'authors',
                            collectionName: 'Authors',
                            displayField: 'title',
                            valueField: 'id',
                            syncFields: ['title', 'urlSlug'],
                        },
                    },
                ],
                templateFolder: 'blog',
                listColumns: ['title', 'author'],
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
                modifiedAt: { seconds: Date.now() / 1000, nanoseconds: 0 },
            };
            expect(contentType.name).toBe('Blog Posts');
            expect(contentType.singularName).toBe('Blog Post');
            expect(contentType.templateFolder).toBe('blog');
            expect(contentType.listColumns).toEqual(['title', 'author']);
            expect(contentType.fields[1].useCollectionRef).toBe(true);
            expect(contentType.fields[1].collectionRef!.collectionSlug).toBe('authors');
        });
    });
});

// ── Per-language names (M5.2) ───────────────────────────────────────────────

describe('contentTypeName', () => {
    const type = {
        name: 'Articles',
        singularName: 'Article',
        nameTranslations: { hi: { name: 'लेख', singularName: 'लेख' } },
    };

    it('returns the translated name for a language', () => {
        expect(contentTypeName(type, 'hi')).toBe('लेख');
    });

    it('falls back to the default name for an untranslated language', () => {
        expect(contentTypeName(type, 'fr')).toBe('Articles');
    });

    it('falls back when no language is given', () => {
        expect(contentTypeName(type)).toBe('Articles');
        expect(contentTypeName(type, '')).toBe('Articles');
    });

    it('treats a blank translation as absent', () => {
        expect(contentTypeName({ ...type, nameTranslations: { hi: { name: '  ' } } }, 'hi'))
            .toBe('Articles');
    });

    it('copes with no translations at all', () => {
        expect(contentTypeName({ name: 'Articles' }, 'hi')).toBe('Articles');
    });
});

describe('contentTypeSingularName', () => {
    const type = {
        name: 'Articles',
        singularName: 'Article',
        nameTranslations: { hi: { name: 'लेख' } },
    };

    it('falls back to the default singular when only the plural is translated', () => {
        expect(contentTypeSingularName(type, 'hi')).toBe('Article');
    });

    it('returns the translated singular when present', () => {
        expect(contentTypeSingularName(
            { ...type, nameTranslations: { hi: { singularName: 'एक लेख' } } }, 'hi',
        )).toBe('एक लेख');
    });

    it('falls back to the plural when no singular is set at all', () => {
        expect(contentTypeSingularName({ name: 'Articles' }, 'hi')).toBe('Articles');
    });
});

describe('contentTypeDescription', () => {
    const type = {
        description: 'Blog posts, news, and announcements',
        nameTranslations: { hi: { description: 'ब्लॉग पोस्ट, समाचार और घोषणाएँ' } },
    };

    it('returns the translated description', () => {
        expect(contentTypeDescription(type, 'hi')).toBe('ब्लॉग पोस्ट, समाचार और घोषणाएँ');
    });

    it('falls back for a language with no translation', () => {
        expect(contentTypeDescription(type, 'fr')).toBe('Blog posts, news, and announcements');
    });

    it('falls back with no language', () => {
        expect(contentTypeDescription(type)).toBe('Blog posts, news, and announcements');
        expect(contentTypeDescription(type, '')).toBe('Blog posts, news, and announcements');
    });

    it('treats a blank translation as absent', () => {
        expect(contentTypeDescription({ ...type, nameTranslations: { hi: { description: '  ' } } }, 'hi'))
            .toBe('Blog posts, news, and announcements');
    });

    it('copes with a type that has no description at all', () => {
        expect(contentTypeDescription({}, 'hi')).toBe('');
        expect(contentTypeDescription(null, 'hi')).toBe('');
        expect(contentTypeDescription(undefined)).toBe('');
    });

    it('does not disturb the name when only the description is translated', () => {
        // Both live in nameTranslations; a language may translate either.
        expect(contentTypeName({ name: 'Articles', nameTranslations: type.nameTranslations }, 'hi'))
            .toBe('Articles');
    });
});

describe('pruneNameTranslations', () => {
    it('drops blank entries so they fall back to the default', () => {
        expect(pruneNameTranslations({
            hi: { name: 'लेख', singularName: '  ' },
            fr: { name: '', singularName: '' },
        })).toEqual({ hi: { name: 'लेख' } });
    });

    it('trims values', () => {
        expect(pruneNameTranslations({ hi: { name: '  लेख  ' } })).toEqual({ hi: { name: 'लेख' } });
    });

    it('keeps a language that translated only the description', () => {
        expect(pruneNameTranslations({ hi: { name: '', description: '  विवरण  ' } }))
            .toEqual({ hi: { description: 'विवरण' } });
    });

    it('copes with null and undefined', () => {
        expect(pruneNameTranslations(null)).toEqual({});
        expect(pruneNameTranslations(undefined)).toEqual({});
    });
});

// ── Custom field label translations ─────────────────────────────────────────

describe('contentTypeFieldLabel', () => {
    const type = { fieldLabelTranslations: { hi: { articles_title: 'शीर्षक' } } };

    it('returns the translated label', () => {
        expect(contentTypeFieldLabel(type, 'articles_title', 'Title', 'hi')).toBe('शीर्षक');
    });

    it('falls back to the authored label', () => {
        expect(contentTypeFieldLabel(type, 'articles_body', 'Body', 'hi')).toBe('Body');
        expect(contentTypeFieldLabel(type, 'articles_title', 'Title', 'fr')).toBe('Title');
        expect(contentTypeFieldLabel(type, 'articles_title', 'Title')).toBe('Title');
    });

    it('treats a blank translation as absent', () => {
        expect(contentTypeFieldLabel(
            { fieldLabelTranslations: { hi: { articles_title: '   ' } } }, 'articles_title', 'Title', 'hi',
        )).toBe('Title');
    });

    it('copes with a type that has no translations', () => {
        expect(contentTypeFieldLabel(null, 'k', 'Fallback', 'hi')).toBe('Fallback');
        expect(contentTypeFieldLabel({}, 'k', 'Fallback', 'hi')).toBe('Fallback');
    });
});

describe('pruneFieldLabelTranslations', () => {
    it('drops labels for fields that no longer exist', () => {
        // The type's fields are the source of truth; a removed field must not
        // leave a stale translation behind.
        expect(pruneFieldLabelTranslations(
            { hi: { kept: 'रखा', removed: 'हटाया' } },
            ['kept'],
        )).toEqual({ hi: { kept: 'रखा' } });
    });

    it('drops blank labels so they fall back', () => {
        expect(pruneFieldLabelTranslations({ hi: { a: '  ', b: 'ख' } }, ['a', 'b']))
            .toEqual({ hi: { b: 'ख' } });
    });

    it('drops a language left entirely empty', () => {
        expect(pruneFieldLabelTranslations({ hi: { a: '' } }, ['a'])).toEqual({});
    });

    it('trims values', () => {
        expect(pruneFieldLabelTranslations({ hi: { a: '  क  ' } }, ['a'])).toEqual({ hi: { a: 'क' } });
    });

    it('copes with null and undefined', () => {
        expect(pruneFieldLabelTranslations(null, ['a'])).toEqual({});
        expect(pruneFieldLabelTranslations(undefined, [])).toEqual({});
    });
});

// ── Client/server mirror ────────────────────────────────────────────────────

describe('content-type display text agrees with the publish pipeline', () => {
    // A statically published page and its SPA fallback are the same page; a
    // difference here means the two render different words for the same type.
    const type = {
        name: 'Articles',
        singularName: 'Article',
        description: 'Blog posts, news, and announcements',
        nameTranslations: {
            hi: { name: 'लेख', singularName: 'लेख', description: 'ब्लॉग पोस्ट' },
            fr: { name: 'Articles FR' },
        },
    };

    it.each(['hi', 'fr', 'de', '', undefined])('matches for %j', (lang) => {
        expect(contentTypeName(type, lang)).toBe(contentTypeNameServer(type, lang));
        expect(contentTypeSingularName(type, lang)).toBe(contentTypeSingularNameServer(type, lang));
        expect(contentTypeDescription(type, lang)).toBe(contentTypeDescriptionServer(type, lang));
    });

    it('matches when the type has no translations at all', () => {
        const plain = { name: 'Notes', description: 'Just notes' };
        expect(contentTypeDescription(plain, 'hi')).toBe(contentTypeDescriptionServer(plain, 'hi'));
        expect(contentTypeName(plain, 'hi')).toBe(contentTypeNameServer(plain, 'hi'));
    });
});
