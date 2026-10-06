import en from '../assets/i18n/en.json';

/**
 * A key's English text, with {{ params }} filled in: for specs that call a component's
 * methods on a stand-in `this`, so they still assert on what a person reads.
 */
export function english(key: string, params: Record<string, unknown> = {}): string {
    const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ''));
}
