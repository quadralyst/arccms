import { describe, it, expect } from 'vitest';
import * as client from './powered-by';
import * as server from '../../../functions/src/shared/html-document';

describe('powered-by line', () => {
    it('is the same in the app and in publishing', () => {
        expect(client.POWERED_BY_DEFAULTS).toEqual(server.POWERED_BY_DEFAULTS);
        expect(client.POWERED_BY_URL).toBe(server.POWERED_BY_URL);
        expect(client.POWERED_BY_NAME).toBe(server.POWERED_BY_NAME);
        for (const strings of [{}, { powered_by: '{link} से बना', powered_by_title: 'शीर्षक' }, { powered_by: 'no link' }, { powered_by_title: '  ' }]) {
            expect(client.poweredByWords(strings)).toEqual(server.poweredByWords(strings));
        }
    });

    it('reads "Built with Arc CMS · your site, your code, your data" in English', () => {
        const { before, after, title } = client.poweredByWords();
        expect(`${before}${client.POWERED_BY_NAME}${after}`).toBe('Built with Arc CMS · your site, your code, your data');
        expect(title).toBe('Arc CMS: the open-source foundation for websites and apps you own');
    });

    it('takes a translation, and keeps the English for one without {link} or left blank', () => {
        expect(client.poweredByWords({ powered_by: '{link} से बना' })).toMatchObject({ before: '', after: ' से बना' });
        expect(client.poweredByWords({ powered_by: 'बिना लिंक' }).before).toBe('Built with ');
        expect(client.poweredByWords({ powered_by_title: ' ' }).title).toBe(client.POWERED_BY_DEFAULTS.powered_by_title);
    });

    it('is translated in the Hindi strings Arc CMS ships', async () => {
        const { readFileSync } = await import('node:fs');
        const hi = JSON.parse(readFileSync('public/_site/strings/hi.json', 'utf8'));
        expect(hi.powered_by).toContain('{link}');
        expect(hi.powered_by_title).toBeTruthy();
    });
});

describe('poweredByHtml (published pages)', () => {
    it('links only the name, with noopener and no dofollow, and no emoji', () => {
        const html = server.poweredByHtml();
        expect(html).toContain('Built with <a href="https://arccms.com" target="_blank" rel="noopener" title="Arc CMS: the open-source foundation for websites and apps you own"');
        expect(html).toContain('>Arc CMS</a> · your site, your code, your data</div>');
        expect(html).not.toContain('dofollow');
        expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it('writes the page\'s own words, escaped', () => {
        const html = server.poweredByHtml({ powered_by: '<b>{link}</b> से बना', powered_by_title: 'a "b"' });
        expect(html).toContain('&lt;b&gt;<a ');
        expect(html).toContain('</a>&lt;/b&gt; से बना');
        expect(html).toContain('title="a &quot;b&quot;"');
    });
});
