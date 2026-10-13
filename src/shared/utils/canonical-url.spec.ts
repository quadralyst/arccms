import { describe, expect, it } from 'vitest';
import { authorCanonicalUrl, hostOf } from './canonical-url';
import * as server from '../../../functions/src/shared/canonical-url';

const SITE = ['https://www.example.com'];

const cases: Array<[string, string | null | undefined, string]> = [
  ['empty', '', ''],
  ['missing', undefined, ''],
  ['not a URL', 'example.com/blog/hello', ''],
  ['local admin, own page', 'http://localhost:5173/blog/hello', ''],
  ['local admin, any page', 'http://localhost:4200/other', ''],
  ['127.0.0.1', 'http://127.0.0.1:5173/blog/hello', ''],
  ['*.localhost', 'http://app.localhost:5173/blog/hello', ''],
  ['own page on the site', 'https://www.example.com/blog/hello', ''],
  ['own page, trailing slash', 'https://www.example.com/blog/hello/', ''],
  ['own page without the type (pre-D1 auto-fill)', 'https://www.example.com/hello', ''],
  ['own page on the default hosting domain', 'https://my-site.web.app/blog/hello', ''],
  ['own page under an old slug', 'https://www.example.com/blog/old-slug', 'https://www.example.com/blog/old-slug'],
  ['another page on the site', 'https://www.example.com/blog/original', 'https://www.example.com/blog/original'],
  ['another site', 'https://partner.org/blog/hello', 'https://partner.org/blog/hello'],
];

describe('authorCanonicalUrl', () => {
  for (const [name, stored, expected] of cases) {
    it(`${name} → ${expected || "''"}`, () => {
      expect(authorCanonicalUrl(stored, 'blog', 'hello', SITE)).toBe(expected);
    });

    it(`${name}: the functions copy agrees`, () => {
      expect(server.authorCanonicalUrl(stored, 'blog', 'hello', SITE))
        .toBe(authorCanonicalUrl(stored, 'blog', 'hello', SITE));
    });
  }

  it('keeps a same-path canonical on a host it does not know', () => {
    expect(authorCanonicalUrl('https://mirror.org/blog/hello', 'blog', 'hello', SITE))
      .toBe('https://mirror.org/blog/hello');
  });
});

describe('hostOf', () => {
  it('reads URLs and bare hosts', () => {
    expect(hostOf('https://WWW.Example.com/x')).toBe('www.example.com');
    expect(hostOf('example.com')).toBe('example.com');
    expect(hostOf('')).toBe('');
    expect(server.hostOf('https://www.example.com:8080')).toBe('www.example.com');
  });
});
