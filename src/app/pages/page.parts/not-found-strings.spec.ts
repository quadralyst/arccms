import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOT_FOUND_STRINGS, notFoundText } from './not-found-strings';

describe('not-found text on content pages', () => {
    it('is English when the site has no wording for the page\'s language', () => {
        expect(notFoundText({}, 'content_not_found_title')).toBe('Content Not Found');
        expect(notFoundText({ go_home: '  ' }, 'go_home')).toBe('Go Home');
    });

    it('is the site\'s wording when it has one, with the type filled in', () => {
        expect(notFoundText({ type_not_found_body: 'Den Typ "{{ type }}" gibt es nicht.' }, 'type_not_found_body', { type: 'news' }))
            .toBe('Den Typ "news" gibt es nicht.');
        expect(notFoundText({}, 'type_not_found_body', { type: 'news' })).toBe('The content type "news" does not exist.');
    });

    it('is translated in the Hindi strings Arc CMS ships', () => {
        const hi = JSON.parse(readFileSync(resolve(__dirname, '../../../../public/_site/strings/hi.json'), 'utf8'));
        expect(Object.keys(NOT_FOUND_STRINGS).filter((key) => !hi[key])).toEqual([]);
    });
});
