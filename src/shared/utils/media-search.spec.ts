import { describe, expect, it } from 'vitest';
import { filterBySearch, matchesSearch, searchWords } from './media-search';

const report = { title: 'Annual Report 2025', notes: 'For the Pune store', name: 'annual-report-2025-k3f9qa.pdf' };
const photo = { title: 'Diwali stage', alt: 'Lamps on a stage at night', notes: 'Use for festival pages', name: 'img-0042-xl.webp' };

describe('media search (MF-D23)', () => {
    it('matches every word, in any field and any order', () => {
        expect(matchesSearch(report, 'pune report')).toBe(true);
        expect(matchesSearch(photo, 'festival lamps')).toBe(true);
        expect(matchesSearch(report, 'report delhi')).toBe(false);
    });

    it('ignores case and accents, and matches part of a word', () => {
        expect(matchesSearch(report, 'ANNU')).toBe(true);
        expect(matchesSearch({ title: 'Café menu' }, 'cafe')).toBe(true);
        expect(matchesSearch({ title: 'cafe menu' }, 'café')).toBe(true);
    });

    it('finds a file by the words of its stored name', () => {
        expect(matchesSearch(photo, 'img 0042')).toBe(true);
        expect(matchesSearch(report, 'k3f9qa')).toBe(true);
    });

    it('treats an empty search as everything', () => {
        expect(matchesSearch(report, '   ')).toBe(true);
        expect(searchWords('  a-b  ')).toEqual(['a', 'b']);
    });

    it('keeps the order of the list', () => {
        const items = [photo, report, { title: 'Report draft' }];
        expect(filterBySearch(items, 'report').map((i) => i.title)).toEqual(['Annual Report 2025', 'Report draft']);
    });

    it('matches Hindi text', () => {
        expect(matchesSearch({ title: 'मूल्य सूची' }, 'सूची')).toBe(true);
    });
});
