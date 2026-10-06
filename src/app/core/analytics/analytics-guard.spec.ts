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
    it('only core/analytics and app.config.ts import Firebase Analytics', () => {
        const allowed = new Set(['app/app.config.ts']);
        const offenders = sources(SRC)
            .map((file) => relative(SRC, file))
            .filter((file) => !file.startsWith('app/core/analytics/') && !allowed.has(file))
            .filter((file) => /from ['"](@angular\/fire\/analytics|firebase\/analytics)['"]|import\(['"](@angular\/fire\/analytics|firebase\/analytics)['"]\)/
                .test(readFileSync(join(SRC, file), 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('starts AngularFire\'s Analytics only with the feature on, in always mode, in the browser', () => {
        const config = readFileSync(join(SRC, 'app/app.config.ts'), 'utf8');
        expect(config).toMatch(/typeof window !== 'undefined'\s*&& isOn\('analytics'\) && arcConfig\.analyticsConsent === 'always'/);
        expect(config).toContain('provideAnalytics(() => getAnalytics())');
        expect(config).toContain('ScreenTrackingService');
        expect(config).toContain('UserTrackingService');
        expect(config).toContain('inject(AnalyticsService)');
    });
});
