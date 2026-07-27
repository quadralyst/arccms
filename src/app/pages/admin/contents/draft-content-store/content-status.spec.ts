/**
 * Tests for content publish-status derivation.
 *
 * The whole value of the "Edited" badge is that it is trustworthy, so the
 * cases that must NOT report "edited" are tested as carefully as the ones
 * that must.
 */
import { describe, it, expect } from 'vitest';
import {
    CONTENT_STATUS_CLASS,
    CONTENT_STATUS_LABEL,
    deriveContentStatus,
    toDate,
} from './content-status';

const PUBLISHED_AT = new Date('2026-07-20T10:00:00Z');
const BEFORE = new Date('2026-07-20T09:00:00Z');
const AFTER = new Date('2026-07-21T09:00:00Z');

describe('toDate', () => {
    it('passes through a Date', () => {
        expect(toDate(PUBLISHED_AT)).toEqual(PUBLISHED_AT);
    });

    it('unwraps a Firestore Timestamp', () => {
        expect(toDate({ toDate: () => PUBLISHED_AT })).toEqual(PUBLISHED_AT);
    });

    it('unwraps a serialized {seconds} timestamp', () => {
        expect(toDate({ seconds: Math.floor(PUBLISHED_AT.getTime() / 1000) })).toEqual(PUBLISHED_AT);
    });

    it('parses ISO strings', () => {
        expect(toDate('2026-07-20T10:00:00Z')).toEqual(PUBLISHED_AT);
    });

    it('returns null for anything unusable', () => {
        for (const input of [null, undefined, '', 0, 'not a date', {}, new Date('nope')]) {
            expect(toDate(input)).toBeNull();
        }
    });
});

describe('deriveContentStatus', () => {
    it('reports draft when never published', () => {
        expect(deriveContentStatus({ publishedStatus: false })).toBe('draft');
        expect(deriveContentStatus({})).toBe('draft');
        expect(deriveContentStatus(null)).toBe('draft');
        expect(deriveContentStatus(undefined)).toBe('draft');
    });

    it('reports draft even when timestamps suggest otherwise', () => {
        // Unpublishing leaves the stamps behind; publishedStatus is the gate.
        expect(deriveContentStatus({
            publishedStatus: false,
            lastPublishedAt: PUBLISHED_AT,
            modifiedAt: AFTER,
        })).toBe('draft');
    });

    it('reports published when the draft has not moved since publishing', () => {
        expect(deriveContentStatus({
            publishedStatus: true,
            lastPublishedAt: PUBLISHED_AT,
            modifiedAt: BEFORE,
        })).toBe('published');
    });

    it('reports published when the stamps are identical', () => {
        // The stamp is written after the publish, so equality means in sync.
        expect(deriveContentStatus({
            publishedStatus: true,
            lastPublishedAt: PUBLISHED_AT,
            modifiedAt: PUBLISHED_AT,
        })).toBe('published');
    });

    it('reports edited when the draft changed after publishing', () => {
        expect(deriveContentStatus({
            publishedStatus: true,
            lastPublishedAt: PUBLISHED_AT,
            modifiedAt: AFTER,
        })).toBe('edited');
    });

    it('reports published for items published before the stamp existed', () => {
        // Legacy rows: the honest answer is "unknown", and a badge that cries
        // wolf trains people to ignore it.
        expect(deriveContentStatus({
            publishedStatus: true,
            modifiedAt: AFTER,
        })).toBe('published');
    });

    it('falls back to updatedAt when modifiedAt is absent', () => {
        expect(deriveContentStatus({
            publishedStatus: true,
            lastPublishedAt: PUBLISHED_AT,
            updatedAt: AFTER,
        })).toBe('edited');
    });

    it('reports published when no modification time is known at all', () => {
        expect(deriveContentStatus({
            publishedStatus: true,
            lastPublishedAt: PUBLISHED_AT,
        })).toBe('published');
    });

    it('handles Firestore timestamp shapes on both fields', () => {
        expect(deriveContentStatus({
            publishedStatus: true,
            lastPublishedAt: { seconds: Math.floor(PUBLISHED_AT.getTime() / 1000) },
            modifiedAt: { seconds: Math.floor(AFTER.getTime() / 1000) },
        })).toBe('edited');
    });
});

describe('status presentation', () => {
    it('labels the three states', () => {
        expect(CONTENT_STATUS_LABEL.draft).toBe('Draft');
        expect(CONTENT_STATUS_LABEL.published).toBe('Published');
        expect(CONTENT_STATUS_LABEL.edited).toBe('Edited');
    });

    it('gives edited its own tone, distinct from published', () => {
        expect(CONTENT_STATUS_CLASS.edited).toBe('pending');
        expect(CONTENT_STATUS_CLASS.edited).not.toBe(CONTENT_STATUS_CLASS.published);
        expect(CONTENT_STATUS_CLASS.published).toBe('active');
    });
});
