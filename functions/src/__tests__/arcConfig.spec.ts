import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arcDatabaseId, arcDatabaseParam, arcDocument, arcHostingOrigin, arcHostingSite, DEFAULT_DATABASE_ID } from '../arc-config.js';

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

    describe('arcDocument (CO3)', () => {
        it('binds through the ARC_DATABASE_ID param, which the CLI resolves from functions/.env at deploy', () => {
            const options = arcDocument('users/{docId}');
            expect(options.document).toBe('users/{docId}');
            expect(options.database).toBe(arcDatabaseParam);
            expect(arcDatabaseParam.name).toBe('ARC_DATABASE_ID');
        });

        it('defaults the param to (default), which is Firebase\'s own default', () => {
            expect(arcDatabaseParam.options?.default).toBe('(default)');
        });

        it('is not a plain process.env read: that is empty when the CLI loads triggers', () => {
            const code = readFileSync(join(__dirname, '..', 'arc-config.ts'), 'utf8');
            const body = code.slice(code.indexOf('export function arcDocument'));
            expect(body).not.toMatch(/process\.env|arcDatabaseId\(/);
        });
    });
});
