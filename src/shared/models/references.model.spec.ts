import { describe, it, expect } from 'vitest';
import { cleanReferences } from './references.model';

describe('cleanReferences (D-D11)', () => {
    it('keeps http(s) URLs only, trims, de-duplicates, tolerates junk', () => {
        expect(cleanReferences([
            { title: ' Spec ', url: ' https://a.com/x ' },
            { title: 'Dup', url: 'https://a.com/x' },
            { url: 'ftp://no' },
            { title: 'No url' },
            null,
            { url: 'http://b.com' },
        ])).toEqual([{ title: 'Spec', url: 'https://a.com/x' }, { title: '', url: 'http://b.com' }]);
        expect(cleanReferences(undefined)).toEqual([]);
        expect(cleanReferences('x')).toEqual([]);
    });
});
