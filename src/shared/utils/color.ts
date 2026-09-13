/**
 * Colour handling for the Color custom field.
 *
 * The editor stores a colour as a plain hex string (`#1a73e8`), which drops
 * straight into a template as a CSS value. Everything else — the RGB form,
 * the bare channel values for `rgba(…, 0.5)` — is derived at render time so
 * a stored document never has to change when a new form is wanted.
 *
 * Source of truth; functions/src/shared/color.ts is a mirror for the Cloud
 * Functions build, which cannot import from src/. A parity spec keeps them
 * agreeing, so the published page and the admin preview render alike.
 */

export interface ColorTokens {
    /** Normalised six-digit lowercase hex, e.g. `#1a73e8`. */
    hex: string;
    /** `rgb(26, 115, 232)` */
    rgb: string;
    /** `26, 115, 232` — for `rgba({{ x_rgb_values }}, 0.5)`. */
    rgbValues: string;
    r: number;
    g: number;
    b: number;
}

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parses `#rgb`, `#rrggbb` (the hash optional, any case) into its tokens.
 * Anything else — including the empty string — is null.
 */
export function parseHexColor(value: unknown): ColorTokens | null {
    if (typeof value !== 'string') return null;
    const match = HEX_COLOR.exec(value.trim());
    if (!match) return null;

    let digits = match[1].toLowerCase();
    if (digits.length === 3) {
        digits = digits.split('').map((d) => d + d).join('');
    }

    const r = parseInt(digits.slice(0, 2), 16);
    const g = parseInt(digits.slice(2, 4), 16);
    const b = parseInt(digits.slice(4, 6), 16);

    return {
        hex: `#${digits}`,
        rgb: `rgb(${r}, ${g}, ${b})`,
        rgbValues: `${r}, ${g}, ${b}`,
        r,
        g,
        b,
    };
}

/** True when `value` is something the Color field accepts. */
export function isHexColor(value: unknown): boolean {
    return parseHexColor(value) !== null;
}
