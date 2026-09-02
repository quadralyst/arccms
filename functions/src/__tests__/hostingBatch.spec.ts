/**
 * Tests for HostingBatch.
 *
 * The batch exists because per-file deploys raced: each builds its version
 * from the *latest release's* manifest, so a deploy seconds after another can
 * read a stale release and silently drop the earlier file. A publish of a
 * two-language article lost its Hindi page that way (docs/_todo.md item 3c).
 * Collecting a publish into one batch is what makes that impossible.
 */
import { describe, it, expect } from 'vitest';
import { HostingBatch } from '../pages/deployToHosting.js';

describe('HostingBatch', () => {
    it('should start empty', () => {
        const batch = new HostingBatch();

        expect(batch.isEmpty).toBe(true);
        expect(batch.size).toBe(0);
        expect(batch.files).toEqual([]);
        expect(batch.removedPaths).toEqual([]);
    });

    it('should collect files in order', () => {
        const batch = new HostingBatch()
            .add('/articles/a.html', 'A')
            .add('/hi/articles/a.html', 'HI-A');

        expect(batch.files).toEqual([
            { path: '/articles/a.html', content: 'A' },
            { path: '/hi/articles/a.html', content: 'HI-A' },
        ]);
        expect(batch.size).toBe(2);
        expect(batch.isEmpty).toBe(false);
    });

    it('should hold every file of a multi-language publish', () => {
        // The case that regressed: four files released together rather than
        // four releases racing each other.
        const batch = new HostingBatch()
            .add('/articles/a.html', 'A')
            .add('/hi/articles/a.html', 'HI-A')
            .add('/articles/index.html', 'LIST')
            .add('/hi/articles/index.html', 'HI-LIST');

        expect(batch.files.map(f => f.path)).toEqual([
            '/articles/a.html',
            '/hi/articles/a.html',
            '/articles/index.html',
            '/hi/articles/index.html',
        ]);
    });

    it('should let a later add replace an earlier one', () => {
        const batch = new HostingBatch()
            .add('/a.html', 'first')
            .add('/a.html', 'second');

        expect(batch.files).toEqual([{ path: '/a.html', content: 'second' }]);
    });

    it('should collect removals', () => {
        const batch = new HostingBatch().remove('/gone.html');

        expect(batch.removedPaths).toEqual(['/gone.html']);
        expect(batch.isEmpty).toBe(false);
    });

    it('should let a removal supersede a queued add', () => {
        // Unpublish after a publish in the same run: the file must not be
        // written and then removed, nor written at all.
        const batch = new HostingBatch()
            .add('/a.html', 'content')
            .remove('/a.html');

        expect(batch.files).toEqual([]);
        expect(batch.removedPaths).toEqual(['/a.html']);
    });

    it('should let an add supersede a queued removal', () => {
        const batch = new HostingBatch()
            .remove('/a.html')
            .add('/a.html', 'content');

        expect(batch.files).toEqual([{ path: '/a.html', content: 'content' }]);
        expect(batch.removedPaths).toEqual([]);
    });

    it('should not duplicate a repeated removal', () => {
        const batch = new HostingBatch().remove('/a.html').remove('/a.html');

        expect(batch.removedPaths).toEqual(['/a.html']);
        expect(batch.size).toBe(1);
    });

    it('should count additions and removals together', () => {
        const batch = new HostingBatch().add('/a.html', 'A').remove('/b.html');

        expect(batch.size).toBe(2);
    });
});
