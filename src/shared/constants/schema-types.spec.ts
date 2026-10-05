import { describe, it, expect } from 'vitest';
import { SCHEMA_TYPES as CLIENT, ARTICLE_FAMILY, schemaTypeMeta } from './schema-types';
import { SCHEMA_TYPES as SERVER } from '../../../functions/src/shared/schema-types';

describe('schema type registry (D-D12)', () => {
    it('is identical on the client and the server', () => {
        expect(CLIENT).toEqual(SERVER);
    });

    it('has unique type ids and unique property keys per type', () => {
        expect(new Set(CLIENT.map(t => t.id)).size).toBe(CLIENT.length);
        for (const type of CLIENT) {
            expect(new Set(type.properties.map(p => p.key)).size).toBe(type.properties.length);
        }
    });

    it('the Article family and Web page map nothing, everything else maps something', () => {
        // Web page (SS6) is a plain page: its node needs only the built-in fields.
        const unmapped = [...ARTICLE_FAMILY, 'WebPage'];
        for (const id of unmapped) expect(schemaTypeMeta(id)!.properties).toEqual([]);
        for (const type of CLIENT.filter(t => !unmapped.includes(t.id))) expect(type.properties.length).toBeGreaterThan(0);
        expect(schemaTypeMeta('Nope')).toBeUndefined();
    });
});
