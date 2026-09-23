import { describe, it, expect } from 'vitest';
import { arcDatabaseId, arcHostingOrigin, arcHostingSite, DEFAULT_DATABASE_ID } from '../arc-config.js';

describe('arc-config (functions)', () => {
    describe('defaults: an install with no ARC_* variables behaves as before CO2', () => {
        it('uses the (default) database', () => {
            expect(arcDatabaseId({})).toBe('(default)');
            expect(DEFAULT_DATABASE_ID).toBe('(default)');
        });

        it('uses the project id as the hosting site', () => {
            expect(arcHostingSite({ GCLOUD_PROJECT: 'my-project' })).toBe('my-project');
            expect(arcHostingOrigin({ GCLOUD_PROJECT: 'my-project' })).toBe('https://my-project.web.app');
        });

        it('treats blank values as unset', () => {
            expect(arcDatabaseId({ ARC_DATABASE_ID: '  ' })).toBe('(default)');
            expect(arcHostingSite({ ARC_HOSTING_SITE: '', GCLOUD_PROJECT: 'p' })).toBe('p');
        });
    });

    describe('configured', () => {
        it('reads the database id', () => {
            expect(arcDatabaseId({ ARC_DATABASE_ID: 'arccms' })).toBe('arccms');
        });

        it('prefers ARC_HOSTING_SITE over the project id', () => {
            const env = { ARC_HOSTING_SITE: 'acme-admin', GCLOUD_PROJECT: 'acme' };
            expect(arcHostingSite(env)).toBe('acme-admin');
            expect(arcHostingOrigin(env)).toBe('https://acme-admin.web.app');
        });
    });

    it('reads process.env at call time, not at import', () => {
        const before = process.env.GCLOUD_PROJECT;
        process.env.GCLOUD_PROJECT = 'changed-later';
        try {
            expect(arcHostingSite()).toBe('changed-later');
        } finally {
            process.env.GCLOUD_PROJECT = before;
        }
    });
});
