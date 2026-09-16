import { describe, expect, it } from 'vitest';
import { isHexColor, parseHexColor } from './color';
import { parseHexColor as parseServerSide } from '../../../functions/src/shared/color';

const CASES: [string, string, string | null][] = [
    ['six digits', '#1a73e8', '#1a73e8'],
    ['uppercase', '#1A73E8', '#1a73e8'],
    ['no hash', '1a73e8', '#1a73e8'],
    ['shorthand', '#fff', '#ffffff'],
    ['shorthand mixed', '#F0a', '#ff00aa'],
    ['padded', '  #000000 ', '#000000'],
    ['rgb() is not stored form', 'rgb(1, 2, 3)', null],
    ['named colour', 'red', null],
    ['too short', '#12', null],
    ['not hex', '#ggg', null],
    ['empty', '', null],
];

describe('parseHexColor', () => {
    it.each(CASES)('%s', (_label, input, hex) => {
        expect(parseHexColor(input)?.hex ?? null).toBe(hex);
    });

    it('derives the rgb forms', () => {
        expect(parseHexColor('#1a73e8')).toEqual({
            hex: '#1a73e8',
            rgb: 'rgb(26, 115, 232)',
            rgbValues: '26, 115, 232',
            r: 26,
            g: 115,
            b: 232,
        });
    });

    it('rejects non-strings', () => {
        expect(parseHexColor(null)).toBeNull();
        expect(parseHexColor(0x1a73e8)).toBeNull();
        expect(isHexColor({ hex: '#fff' })).toBe(false);
    });

    describe('parity with the Cloud Functions mirror', () => {
        it.each(CASES)('agrees on %s', (_label, input) => {
            expect(parseServerSide(input)).toEqual(parseHexColor(input));
        });
    });
});
