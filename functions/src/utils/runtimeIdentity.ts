/**
 * Who the functions run as, from the metadata server every Cloud Function runs next to:
 * the project's id and number, and the runtime service account's email.
 *
 * Each value is fetched once per instance and cached. A failed lookup is not cached, so
 * the next call asks again.
 */
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/';

const cache = new Map<string, Promise<string>>();

/** One metadata value, such as `project/project-id`. Rejects when the server cannot answer. */
export function metadataValue(path: string): Promise<string> {
    let value = cache.get(path);
    if (!value) {
        value = (async () => {
            const response = await fetch(METADATA + path, {
                headers: { 'Metadata-Flavor': 'Google' },
                signal: AbortSignal.timeout(3000),
            });
            if (!response.ok) throw new Error(`metadata ${path}: HTTP ${response.status}`);
            return (await response.text()).trim();
        })();
        cache.set(path, value);
        value.catch(() => cache.delete(path));
    }
    return value;
}

/** This project's id and number, lower case, or none when the metadata server cannot say. */
export async function thisProjectKeys(): Promise<string[]> {
    try {
        const keys = await Promise.all([metadataValue('project/project-id'), metadataValue('project/numeric-project-id')]);
        return keys.map((key) => key.toLowerCase());
    } catch (error) {
        console.warn('Could not read this project\'s id and number from the metadata server:', error);
        return [];
    }
}

/**
 * The email of the service account these functions run as: for 2nd gen functions with no
 * account of their own, the default compute account. Empty when the metadata server cannot say.
 */
export async function runtimeServiceAccount(): Promise<string> {
    try {
        return await metadataValue('instance/service-accounts/default/email');
    } catch {
        return '';
    }
}

/** For tests: forget every cached value. */
export function resetRuntimeIdentityForTests(): void {
    cache.clear();
}
