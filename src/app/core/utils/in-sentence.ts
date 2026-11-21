/**
 * A label inside a sentence ("Add download label"): each word written with a capital
 * only because the label is in title case gets a small first letter; an acronym (URL,
 * FAQ) or a name with capitals inside it (YouTube) is left alone.
 */
export function inSentence(label: string): string {
    return label.replace(/(^|\s)(\p{Lu})(\p{Ll}*)(?=\s|$)/gu, (_, space: string, first: string, rest: string) => `${space}${first.toLowerCase()}${rest}`);
}
