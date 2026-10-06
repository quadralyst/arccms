/**
 * One gate (docs/features/analytics.html): nothing reaches Google Analytics except
 * through AnalyticsService, so no page can track a visitor who has not consented.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../..');

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
    });
}

describe('analytics gate', () => {
    it('only core/analytics imports Firebase Analytics', () => {
        const offenders = sources(SRC)
            .map((file) => relative(SRC, file))
            .filter((file) => !file.startsWith('app/core/analytics/'))
            .filter((file) => /from ['"](@angular\/fire\/analytics|firebase\/analytics)['"]|import\(['"](@angular\/fire\/analytics|firebase\/analytics)['"]\)/
                .test(readFileSync(join(SRC, file), 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('never imports Firebase Analytics statically, so it stays out of the main bundle', () => {
        // A static import anywhere (AngularFire's providers included) would put the SDK in the
        // code every visitor downloads. Only the dynamic import in analytics.service.ts loads it.
        const statics = sources(SRC)
            .filter((file) => /^\s*import\s[^;]*?from\s+['"](@angular\/fire\/analytics|firebase\/analytics)['"]/m
                .test(readFileSync(file, 'utf8').replace(/^\s*import\s+type\s[^;]*;/gm, '')))
            .map((file) => relative(SRC, file));
        expect(statics).toEqual([]);
        const service = readFileSync(join(SRC, 'app/core/analytics/analytics.service.ts'), 'utf8');
        expect(service).toContain("import('firebase/analytics')");
    });

    it('starts AnalyticsService before the first navigation', () => {
        const config = readFileSync(join(SRC, 'app/app.config.ts'), 'utf8');
        expect(config).toContain('inject(AnalyticsService)');
        expect(config).not.toMatch(/provideAnalytics|ScreenTrackingService|UserTrackingService/);
    });
});
