import { sanitizeSvg } from './sanitize-svg';
import { buildFaMarkup } from '../models/icon.model';

/**
 * The markup this returns is injected into published pages with `$el.html()`,
 * so the interesting cases here are the hostile ones. Each of these is a real
 * SVG script vector, not a hypothetical.
 */
describe('sanitizeSvg', () => {
    describe('valid icon markup', () => {
        it('keeps the markup the icon builder produces', () => {
            const markup = buildFaMarkup('0 0 512 512', 'M416 208c0 45.9-14.9 88.3-40 122.7z');
            const result = sanitizeSvg(markup);

            expect(result).toContain('<svg');
            expect(result).toContain('viewBox="0 0 512 512"');
            expect(result).toContain('fill="currentColor"');
            expect(result).toContain('M416 208c0 45.9-14.9 88.3-40 122.7z');
        });

        it('preserves viewBox capitalisation', () => {
            // Parsed as HTML this would come back as `viewbox`, which SVG ignores,
            // and every icon would render at its default size.
            const result = sanitizeSvg(buildFaMarkup('0 0 24 24', 'M0 0h24v24z'));
            expect(result).toContain('viewBox=');
            expect(result).not.toContain('viewbox=');
        });

        it('keeps shape elements other than path', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<g><circle cx="12" cy="12" r="10"/><rect x="1" y="1" width="4" height="4"/></g></svg>',
            );
            expect(result).toContain('<circle');
            expect(result).toContain('<rect');
        });
    });

    describe('script vectors', () => {
        it('removes a script element', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<script>alert(1)</script><path d="M0 0h24v24z"/></svg>',
            );
            expect(result).not.toContain('script');
            expect(result).toContain('<path');
        });

        it('removes an onload handler', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)">' +
                '<path d="M0 0h24v24z"/></svg>',
            );
            expect(result).not.toContain('onload');
            expect(result).not.toContain('alert');
        });

        it('removes an onclick handler on a child', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<path d="M0 0h24v24z" onclick="alert(1)"/></svg>',
            );
            expect(result).not.toContain('onclick');
        });

        it('removes a use element pointing at an external document', () => {
            // `<use href="https://evil/x#y">` pulls in a remote subtree.
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<use href="https://evil.example/x.svg#y"/><path d="M0 0h24v24z"/></svg>',
            );
            expect(result).not.toContain('use');
            expect(result).not.toContain('evil.example');
        });

        it('removes a foreignObject', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">' +
                '<img src=x onerror="alert(1)"/></body></foreignObject>' +
                '<path d="M0 0h24v24z"/></svg>',
            );
            expect(result).not.toContain('foreignObject');
            expect(result).not.toContain('onerror');
        });

        it('removes an animate element that rewrites an attribute', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<animate attributeName="href" values="javascript:alert(1)"/>' +
                '<path d="M0 0h24v24z"/></svg>',
            );
            expect(result).not.toContain('animate');
            expect(result).not.toContain('javascript:');
        });

        it('removes an anchor with a javascript: href', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<a href="javascript:alert(1)"><path d="M0 0h24v24z"/></a></svg>',
            );
            expect(result).not.toContain('javascript:');
        });

        it('strips a namespaced href even on an allowed element', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
                'viewBox="0 0 24 24"><path xlink:href="https://evil.example/x" d="M0 0h24v24z"/></svg>',
            );
            expect(result).not.toContain('evil.example');
        });

        it('strips a fill that references a data URI', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<path d="M0 0h24v24z" fill="url(data:image/svg+xml;base64,AAA)"/></svg>',
            );
            expect(result).not.toContain('data:');
            expect(result).toContain('<path');
        });

        it('strips a style attribute', () => {
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<path d="M0 0h24v24z" style="background:url(https://evil.example/x)"/></svg>',
            );
            expect(result).not.toContain('style');
            expect(result).not.toContain('evil.example');
        });
    });

    describe('unusable input', () => {
        it.each([
            ['null', null],
            ['undefined', undefined],
            ['empty string', ''],
            ['whitespace', '   '],
        ])('returns empty for %s', (_label, input) => {
            expect(sanitizeSvg(input as any)).toBe('');
        });

        it('returns empty for markup that is not an svg', () => {
            expect(sanitizeSvg('<div>not an icon</div>')).toBe('');
        });

        it('returns empty for malformed markup', () => {
            expect(sanitizeSvg('<svg><path d="M0 0"')).toBe('');
        });

        it('returns empty when nothing drawable survives', () => {
            // An `<svg>` whose only child is disallowed leaves an empty shell.
            // Storing that would look like a working icon and render nothing.
            const result = sanitizeSvg(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<script>alert(1)</script></svg>',
            );
            expect(result).toBe('');
        });
    });
});
