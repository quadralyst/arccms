import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { Meta } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { arcEntry, setArcEntry } from './arc-entry';
import { arcEntry as publishedArcEntry } from '../../../../functions/src/shared/html-document';

describe('arc-entry meta (VE-D11)', () => {
    it('names every page kind as the publish pipeline does', () => {
        const cases: Array<[keyof typeof arcEntry, string[]]> = [
            ['content', ['events', 'abc123']],
            ['list', ['events']],
            ['home', []],
            ['staticPage', ['privacy-policy']],
        ];
        for (const [kind, args] of cases) {
            const app = (arcEntry[kind] as (...a: string[]) => string)(...args);
            const published = (publishedArcEntry[kind] as (...a: string[]) => string)(...args);
            expect(app).toBe(published);
        }
        expect(arcEntry.content('events', 'abc123')).toBe('events/abc123');
        expect(arcEntry.staticPage('terms')).toBe('p/terms');
    });

    it('writes one tag in the head, replaces it, and removes it', () => {
        const meta = TestBed.inject(Meta);
        const head = TestBed.inject(DOCUMENT).head;
        setArcEntry(meta, 'events/abc123');
        setArcEntry(meta, 'events/xyz');
        const tags = head.querySelectorAll('meta[name="arc-entry"]');
        expect(tags.length).toBe(1);
        expect(tags[0].getAttribute('content')).toBe('events/xyz');
        setArcEntry(meta, null);
        expect(head.querySelector('meta[name="arc-entry"]')).toBeNull();
    });

    it('says when a static page has areas to edit, and stops saying it for the next page (VE-D56)', () => {
        const meta = TestBed.inject(Meta);
        const head = TestBed.inject(DOCUMENT).head;
        setArcEntry(meta, 'p/about-us', true);
        expect(head.querySelector('meta[name="arc-entry"]')?.outerHTML).toBe('<meta name="arc-entry" content="p/about-us" data-arc-editable="">');
        setArcEntry(meta, 'p/terms');
        expect(head.querySelectorAll('meta[name="arc-entry"]').length).toBe(1);
        expect(head.querySelector('meta[name="arc-entry"]')?.hasAttribute('data-arc-editable')).toBe(false);
        setArcEntry(meta, null);
    });
});
