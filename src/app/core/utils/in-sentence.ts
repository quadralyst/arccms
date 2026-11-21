/**
 * A label inside a sentence ("Add cover image"): its first word gets a small first
 * letter when that word is an ordinary one (not an acronym such as URL, not a name
 * with capitals inside it such as YouTube).
 *
 * A label written in title case ("London Office", "Download Label") is left as it is:
 * there is no telling a name from an ordinary word there, and a name written small
 * ("london office") reads as a mistake, while capitals read as the label.
 */
export function inSentence(label: string): string {
    const words = label.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
    if (words.length > 1 && words.every((w) => /^\P{L}*\p{Lu}/u.test(w))) return label;
    return label.replace(/^(\s*)(\p{Lu})(\p{Ll}*)(?=\s|$)/u, (_, space: string, first: string, rest: string) => `${space}${first.toLowerCase()}${rest}`);
}
