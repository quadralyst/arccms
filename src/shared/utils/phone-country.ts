/**
 * A number typed beside the country chip (specs/phone-country-spec.md): read in
 * the chip's country, or in its own when it starts with `+` or `00`. Shared by the
 * sign-in box, the profile's number box and the SMS test send; an app with its
 * own number box can use it with `arc-phone-country`.
 */
import { Country, countryByIso, countryForE164, countryName } from '../data/countries';
import { hasCountryCode, nationalNumber, normalizePhone, withoutTrunk } from './identifier.util';

/** The number with its country code (E.164), or null when it is not one. */
export function chipPhone(raw: unknown, country: Country | undefined): string | null {
    if (String(raw ?? '').includes('@')) return null;
    if (hasCountryCode(raw) || !country) return normalizePhone(raw);
    return normalizePhone(withoutTrunk(raw, country.trunk), country.code);
}

/**
 * The box after a paste, an autofill or leaving it: a number with its own code
 * from a country the site takes moves that code to the chip and shows the rest
 * (PC-D10); a number beside the chip shows without a domestic `0`; one from a
 * country the site does not take, or with no list to check (`allowed` null),
 * shows in full. Null when the text is not a number.
 */
export function tidyChipNumber(
    raw: unknown,
    current: Country | undefined,
    allowed: readonly string[] | null,
): { country: Country | undefined; shown: string } | null {
    const phone = chipPhone(raw, current);
    if (!phone) return null;
    const country = !hasCountryCode(raw) ? current
        : allowed ? countryForE164(phone, allowed, current?.iso) ?? undefined : undefined;
    if (!country || !phone.startsWith(`+${country.code}`)) return { country: current, shown: phone };
    return { country, shown: nationalNumber(phone, country.code) };
}

/** The countries a site takes, by name in `lang`: "India, United Kingdom, or United States". */
export function countryListText(isos: readonly string[], lang: string): string {
    const names = isos.map((iso) => countryName(iso, lang));
    try {
        return new Intl.ListFormat(lang, { type: 'disjunction' }).format(names);
    } catch {
        return names.join(', ');
    }
}

const COUNTRY_KEY = 'arc.phoneCountry';

/** The country this device last used for a number (PC-D8); null when storage is off. */
export function rememberedCountry(): string | null {
    try {
        return countryByIso(localStorage.getItem(COUNTRY_KEY))?.iso ?? null;
    } catch {
        return null;
    }
}

export function rememberCountry(iso: string): void {
    try {
        localStorage.setItem(COUNTRY_KEY, iso);
    } catch { /* nothing to remember with */ }
}
