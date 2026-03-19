import { describe, it, expect } from 'vitest';
import {
    isKnownCollectionName,
    getCollectionGroupId,
    sortByImportOrder,
} from './data-constants';

describe('data-constants helpers', () => {
    describe('isKnownCollectionName', () => {
        it('should recognise static collection names', () => {
            expect(isKnownCollectionName('ContentTypes')).toBe(true);
            expect(isKnownCollectionName('users')).toBe(true);
            expect(isKnownCollectionName('Waitlists')).toBe(true);
            expect(isKnownCollectionName('Settings')).toBe(true);
        });

        it('should not recognise removed legacy collections', () => {
            expect(isKnownCollectionName('DraftContents')).toBe(false);
            expect(isKnownCollectionName('Contents')).toBe(false);
        });

        it('should recognise Tags_ dynamic collections', () => {
            expect(isKnownCollectionName('Tags_blog')).toBe(true);
            expect(isKnownCollectionName('Tags_news')).toBe(true);
        });

        it('should recognise arc_*_drafts collections', () => {
            expect(isKnownCollectionName('arc_articles_drafts')).toBe(true);
            expect(isKnownCollectionName('arc_news_drafts')).toBe(true);
        });

        it('should recognise arc_* published collections', () => {
            expect(isKnownCollectionName('arc_articles')).toBe(true);
            expect(isKnownCollectionName('arc_blog')).toBe(true);
        });

        it('should recognise subcollection paths', () => {
            expect(isKnownCollectionName('Waitlists/wl1/users')).toBe(true);
        });

        it('should reject unknown collections', () => {
            expect(isKnownCollectionName('RandomCollection')).toBe(false);
            expect(isKnownCollectionName('SomeOtherThing')).toBe(false);
        });
    });

    describe('getCollectionGroupId', () => {
        it('should map ContentTypes to content', () => {
            expect(getCollectionGroupId('ContentTypes')).toBe('content');
        });

        it('should map users to users-waitlists', () => {
            expect(getCollectionGroupId('users')).toBe('users-waitlists');
        });

        it('should map Waitlists to users-waitlists', () => {
            expect(getCollectionGroupId('Waitlists')).toBe('users-waitlists');
        });

        it('should map Settings to settings-media', () => {
            expect(getCollectionGroupId('Settings')).toBe('settings-media');
        });

        it('should map EmailTemplate to email', () => {
            expect(getCollectionGroupId('EmailTemplate')).toBe('email');
        });

        it('should map DraftContents to unknown (legacy removed)', () => {
            expect(getCollectionGroupId('DraftContents')).toBe('unknown');
        });

        it('should map Tags_* to content', () => {
            expect(getCollectionGroupId('Tags_blog')).toBe('content');
        });

        it('should map arc_*_drafts to content', () => {
            expect(getCollectionGroupId('arc_articles_drafts')).toBe('content');
        });

        it('should map arc_* (published) to content', () => {
            expect(getCollectionGroupId('arc_articles')).toBe('content');
        });

        it('should return unknown for unrecognised collections', () => {
            expect(getCollectionGroupId('RandomCollection')).toBe('unknown');
        });

        it('should handle subcollection paths by root name', () => {
            expect(getCollectionGroupId('Waitlists/wl1/users')).toBe('users-waitlists');
        });
    });

    describe('sortByImportOrder', () => {
        it('should put ContentTypes first', () => {
            const paths = ['Settings', 'ContentTypes', 'users'];
            const sorted = sortByImportOrder(paths);
            expect(sorted[0]).toBe('ContentTypes');
        });

        it('should put Tags_ after ContentTypes', () => {
            const paths = ['Tags_blog', 'ContentTypes', 'users'];
            const sorted = sortByImportOrder(paths);
            expect(sorted.indexOf('Tags_blog')).toBeGreaterThan(sorted.indexOf('ContentTypes'));
            expect(sorted.indexOf('Tags_blog')).toBeLessThan(sorted.indexOf('users'));
        });

        it('should put arc_*_drafts before arc_* (published)', () => {
            const paths = ['arc_articles', 'arc_articles_drafts'];
            const sorted = sortByImportOrder(paths);
            expect(sorted[0]).toBe('arc_articles_drafts');
            expect(sorted[1]).toBe('arc_articles');
        });

        it('should put arc_ collections after Tags_', () => {
            const paths = ['arc_blog_drafts', 'Tags_blog'];
            const sorted = sortByImportOrder(paths);
            expect(sorted.indexOf('Tags_blog')).toBeLessThan(sorted.indexOf('arc_blog_drafts'));
        });

        it('should put unknown collections at the end', () => {
            const paths = ['RandomCollection', 'ContentTypes', 'users'];
            const sorted = sortByImportOrder(paths);
            expect(sorted[sorted.length - 1]).toBe('RandomCollection');
        });

        it('should put subcollections after their parent', () => {
            const paths = ['Waitlists/wl1/users', 'Waitlists'];
            const sorted = sortByImportOrder(paths);
            expect(sorted.indexOf('Waitlists')).toBeLessThan(sorted.indexOf('Waitlists/wl1/users'));
        });
    });
});
