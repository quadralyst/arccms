import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const { mockHttpsCallable } = vi.hoisted(() => ({ mockHttpsCallable: vi.fn(() => 'callable') }));
vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: mockHttpsCallable }));

import { arcCallable, arcFunctionName, ARC_FUNCTION_GROUP } from './arc-functions';

describe('arc-functions', () => {
    it('prefixes every function with the arccms group (CO-D5)', () => {
        expect(ARC_FUNCTION_GROUP).toBe('arccms');
        expect(arcFunctionName('search')).toBe('arccms-search');
    });

    it('arcCallable calls the prefixed function and passes options through', () => {
        const functions = {} as never;
        arcCallable(functions, 'claimFirstAdmin', { timeout: 5000 });
        expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'arccms-claimFirstAdmin', { timeout: 5000 });
    });

    it('matches the functions side', () => {
        const fnSide = readFileSync(join(__dirname, '..', '..', '..', '..', 'functions', 'src', 'function-names.ts'), 'utf8');
        expect(fnSide).toContain(`ARC_FUNCTION_GROUP = '${ARC_FUNCTION_GROUP}'`);
    });

    it('no frontend code calls httpsCallable directly (it would miss the prefix)', () => {
        const root = join(__dirname, '..', '..', '..');
        const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return walk(path);
            return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
        });
        const offenders = walk(root)
            .filter((path) => !path.endsWith(join('core', 'config', 'arc-functions.ts')))
            .filter((path) => /\bhttpsCallable\s*[<(]/.test(readFileSync(path, 'utf8')))
            .map((path) => relative(root, path));
        expect(offenders).toEqual([]);
    });
});
