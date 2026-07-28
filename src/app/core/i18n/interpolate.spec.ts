/**
 * The `{{ token }}` rule, and that both renderers apply the same one.
 */

import { describe, it, expect } from 'vitest';
import { interpolate, parseParams } from './interpolate';
import {
    interpolate as interpolateServer,
    parseParams as parseParamsServer,
} from '../../../../functions/src/shared/interpolate';

describe('interpolate', () => {
    it('substitutes named tokens', () => {
        expect(interpolate('वापस {{ contentType }} पर', { contentType: 'लेख' })).toBe('वापस लेख पर');
    });

    it('tolerates the spacing a translator might use', () => {
        expect(interpolate('{{a}} {{ a }} {{  a  }}', { a: 'x' })).toBe('x x x');
    });

    it('leaves an unknown token exactly as authored', () => {
        // Better a visible {{ token }} than a silent empty gap.
        expect(interpolate('{{ known }} and {{ unknown }}', { known: 'yes' }))
            .toBe('yes and {{ unknown }}');
    });

    it('leaves null and undefined values as authored', () => {
        expect(interpolate('{{ a }}', { a: null })).toBe('{{ a }}');
        expect(interpolate('{{ a }}', { a: undefined })).toBe('{{ a }}');
    });

    it('renders 0 and false rather than treating them as absent', () => {
        expect(interpolate('{{ n }} left', { n: 0 })).toBe('0 left');
        expect(interpolate('{{ b }}', { b: false })).toBe('false');
    });

    it('is a no-op without params or without tokens', () => {
        expect(interpolate('plain text', { a: 1 })).toBe('plain text');
        expect(interpolate('{{ a }}', null)).toBe('{{ a }}');
        expect(interpolate('', { a: 1 })).toBe('');
    });
});

describe('parseParams', () => {
    it('reads a JSON object', () => {
        expect(parseParams('{"count": 5}')).toEqual({ count: 5 });
    });

    it('yields nothing for anything that is not a JSON object', () => {
        // A broken annotation must degrade to the authored English, never
        // abort a publish.
        expect(parseParams('not json')).toBeNull();
        expect(parseParams('[1,2]')).toBeNull();
        expect(parseParams('"a string"')).toBeNull();
        expect(parseParams('null')).toBeNull();
        expect(parseParams('')).toBeNull();
        expect(parseParams(undefined)).toBeNull();
    });
});

describe('agrees with the publish pipeline', () => {
    const cases: Array<[string, Record<string, unknown> | null]> = [
        ['वापस {{ contentType }} पर', { contentType: 'लेख' }],
        ['{{ a }} {{ b }}', { a: 1 }],
        ['no tokens', { a: 1 }],
        ['{{ n }}', { n: 0 }],
    ];

    it.each(cases)('interpolate(%j)', (text, params) => {
        expect(interpolate(text, params)).toBe(interpolateServer(text, params));
    });

    it.each(['{"a":1}', 'broken', ''])('parseParams(%j)', (raw) => {
        expect(parseParams(raw)).toEqual(parseParamsServer(raw));
    });
});
