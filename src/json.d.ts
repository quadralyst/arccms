/**
 * JSON imports.
 *
 * `resolveJsonModule` in tsconfig.json covers `tsc`, but the Analog Angular
 * plugin type-checks with its own options and does not pick it up — the dev
 * server fails on `import en from '../../assets/i18n/en.json'` with "Cannot
 * find module". This declaration answers both.
 *
 * Used by the admin translations (M6), which are imported rather than fetched
 * so the server render has the same strings the browser will.
 */
declare module '*.json' {
    const value: Record<string, unknown>;
    export default value;
}
