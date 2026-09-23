/**
 * The group every ArcCMS function is exported under (see index.ts). A function
 * `name` deploys as `${ARC_FUNCTION_GROUP}-${name}`.
 *
 * Keep in step with src/app/core/config/arc-functions.ts (the frontend's copy).
 */
export const ARC_FUNCTION_GROUP = 'arccms';

/** The deployed name of an ArcCMS function, for URLs and callable names. */
export function arcFunctionName(name: string): string {
    return `${ARC_FUNCTION_GROUP}-${name}`;
}
