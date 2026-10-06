/**
 * A translated sentence split around one value, so the template can style the value
 * (`You are logging in as <strong>{{ email }}</strong>`) while each language keeps its
 * own word order (specs/app-member-language-spec.md, L-D15). The key holds `{{ value }}`
 * where the value goes; the value itself is never put into translated HTML.
 */
const MARK = '\u0001';

export function sentenceParts(
    translate: (key: string, params?: Record<string, unknown>) => string,
    key: string,
    params: Record<string, unknown> = {},
): [string, string] {
    const text = translate(key, { ...params, value: MARK });
    const at = text.indexOf(MARK);
    return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + MARK.length)];
}
