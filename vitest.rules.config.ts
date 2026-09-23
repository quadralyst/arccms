/**
 * Security rules tests, run against the Firestore and Storage emulators:
 *
 *   npm run test:rules
 *
 * Kept out of the default `npm run test` run because they need the emulators
 * (Java plus the Firebase CLI). The default run still guards the same holes at
 * the source level in functions/src/__tests__/securityRulesRoles.spec.ts.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/rules/**/*.spec.ts'],
        fileParallelism: false,
        testTimeout: 20000,
        hookTimeout: 30000,
    },
});
