/**
 * Calling ArcCMS Cloud Functions (specs/coexistence-spec.md, CO-D5).
 *
 * Every ArcCMS function is deployed inside one export group, so its deployed
 * name is `arccms-<name>`. Call sites keep using the plain name and go through
 * `arcCallable()`, the only place that knows the prefix.
 *
 * Keep ARC_FUNCTION_GROUP in step with functions/src/function-names.ts.
 */
import { Functions, httpsCallable, type HttpsCallable, type HttpsCallableOptions } from '@angular/fire/functions';

export const ARC_FUNCTION_GROUP = 'arccms';

/** The deployed name of an ArcCMS function. */
export function arcFunctionName(name: string): string {
    return `${ARC_FUNCTION_GROUP}-${name}`;
}

/** `httpsCallable` for an ArcCMS function, by its plain name. */
export function arcCallable<RequestData = unknown, ResponseData = unknown>(
    functions: Functions,
    name: string,
    options?: HttpsCallableOptions,
): HttpsCallable<RequestData, ResponseData> {
    const deployedName = arcFunctionName(name);
    return options
        ? httpsCallable<RequestData, ResponseData>(functions, deployedName, options)
        : httpsCallable<RequestData, ResponseData>(functions, deployedName);
}
