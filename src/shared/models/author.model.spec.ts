import { describe, it, expect } from 'vitest';
import { authorNameKey, authorSlug, normalizeAuthor } from './author.model';

describe('author.model', () => {
    it('authorSlug lowercases, strips accents and hyphenates', () => {
        expect(authorSlug('Gunjan Karun')).toBe('gunjan-karun');
        expect(authorSlug('  José  Álvarez ')).toBe('jose-alvarez');
        expect(authorSlug('गुंजन')).toBe('');
    });

    it('normalizeAuthor trims, derives the slug and keeps only http(s) sameAs', () => {
        const author = normalizeAuthor({
            name: '  Jane Doe ',
            bio: ' Writes. ',
            sameAs: ['https://x.com/jane', ' ', 'mailto:jane@x.com', 'http://jane.dev'],
        });
        expect(author).toEqual({
            name: 'Jane Doe',
            slug: 'jane-doe',
            bio: 'Writes.',
            photoUrl: '',
            jobTitle: '',
            url: '',
            sameAs: ['https://x.com/jane', 'http://jane.dev'],
        });
    });

    it('normalizeAuthor keeps an explicit slug', () => {
        expect(normalizeAuthor({ name: 'Jane', slug: 'jd' }).slug).toBe('jd');
    });

    it('authorNameKey folds case and whitespace', () => {
        expect(authorNameKey('  Jane   DOE ')).toBe('jane doe');
        expect(authorNameKey('')).toBe('');
    });
});
