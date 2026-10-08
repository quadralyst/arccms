/**
 * Countries and their calling codes, for the phone country chip and the admin's
 * country picker (specs/phone-country-spec.md).
 *
 * Only the ISO 3166 id and the calling code are stored; names come from the
 * browser in the reader's language (`countryName`), flags from
 * `public/flags/4x3/{iso}.svg` (flag-icons, MIT). Several countries share a
 * code (`+1`, `+7`, `+44`...): `primary` marks the one an old install's code
 * stands for. Caribbean `+1` countries keep their area code in the number, as
 * people type it. `trunk` is the domestic prefix people type before a number
 * when it is not `0`, such as `8` in Russia.
 */
export interface Country {
    iso: string;
    code: string;
    primary?: true;
    trunk?: string;
}

export const COUNTRIES: readonly Country[] = [
    { iso: 'AD', code: '376' }, { iso: 'AE', code: '971' }, { iso: 'AF', code: '93' }, { iso: 'AG', code: '1' },
    { iso: 'AI', code: '1' }, { iso: 'AL', code: '355' }, { iso: 'AM', code: '374' }, { iso: 'AO', code: '244' },
    { iso: 'AR', code: '54' }, { iso: 'AS', code: '1' }, { iso: 'AT', code: '43' }, { iso: 'AU', code: '61', primary: true },
    { iso: 'AW', code: '297' }, { iso: 'AX', code: '358' }, { iso: 'AZ', code: '994' }, { iso: 'BA', code: '387' },
    { iso: 'BB', code: '1' }, { iso: 'BD', code: '880' }, { iso: 'BE', code: '32' }, { iso: 'BF', code: '226' },
    { iso: 'BG', code: '359' }, { iso: 'BH', code: '973' }, { iso: 'BI', code: '257' }, { iso: 'BJ', code: '229' },
    { iso: 'BL', code: '590' }, { iso: 'BM', code: '1' }, { iso: 'BN', code: '673' }, { iso: 'BO', code: '591' },
    { iso: 'BQ', code: '599' }, { iso: 'BR', code: '55' }, { iso: 'BS', code: '1' }, { iso: 'BT', code: '975' },
    { iso: 'BW', code: '267' }, { iso: 'BY', code: '375', trunk: '8' }, { iso: 'BZ', code: '501' }, { iso: 'CA', code: '1' },
    { iso: 'CC', code: '61' }, { iso: 'CD', code: '243' }, { iso: 'CF', code: '236' }, { iso: 'CG', code: '242' },
    { iso: 'CH', code: '41' }, { iso: 'CI', code: '225' }, { iso: 'CK', code: '682' }, { iso: 'CL', code: '56' },
    { iso: 'CM', code: '237' }, { iso: 'CN', code: '86' }, { iso: 'CO', code: '57' }, { iso: 'CR', code: '506' },
    { iso: 'CU', code: '53' }, { iso: 'CV', code: '238' }, { iso: 'CW', code: '599', primary: true }, { iso: 'CX', code: '61' },
    { iso: 'CY', code: '357' }, { iso: 'CZ', code: '420' }, { iso: 'DE', code: '49' }, { iso: 'DJ', code: '253' },
    { iso: 'DK', code: '45' }, { iso: 'DM', code: '1' }, { iso: 'DO', code: '1' }, { iso: 'DZ', code: '213' },
    { iso: 'EC', code: '593' }, { iso: 'EE', code: '372' }, { iso: 'EG', code: '20' }, { iso: 'EH', code: '212' },
    { iso: 'ER', code: '291' }, { iso: 'ES', code: '34' }, { iso: 'ET', code: '251' }, { iso: 'FI', code: '358', primary: true },
    { iso: 'FJ', code: '679' }, { iso: 'FK', code: '500' }, { iso: 'FM', code: '691' }, { iso: 'FO', code: '298' },
    { iso: 'FR', code: '33' }, { iso: 'GA', code: '241' }, { iso: 'GB', code: '44', primary: true }, { iso: 'GD', code: '1' },
    { iso: 'GE', code: '995' }, { iso: 'GF', code: '594' }, { iso: 'GG', code: '44' }, { iso: 'GH', code: '233' },
    { iso: 'GI', code: '350' }, { iso: 'GL', code: '299' }, { iso: 'GM', code: '220' }, { iso: 'GN', code: '224' },
    { iso: 'GP', code: '590', primary: true }, { iso: 'GQ', code: '240' }, { iso: 'GR', code: '30' }, { iso: 'GT', code: '502' },
    { iso: 'GU', code: '1' }, { iso: 'GW', code: '245' }, { iso: 'GY', code: '592' }, { iso: 'HK', code: '852' },
    { iso: 'HN', code: '504' }, { iso: 'HR', code: '385' }, { iso: 'HT', code: '509' }, { iso: 'HU', code: '36' },
    { iso: 'ID', code: '62' }, { iso: 'IE', code: '353' }, { iso: 'IL', code: '972' }, { iso: 'IM', code: '44' },
    { iso: 'IN', code: '91' }, { iso: 'IO', code: '246' }, { iso: 'IQ', code: '964' }, { iso: 'IR', code: '98' },
    { iso: 'IS', code: '354' }, { iso: 'IT', code: '39', primary: true }, { iso: 'JE', code: '44' }, { iso: 'JM', code: '1' },
    { iso: 'JO', code: '962' }, { iso: 'JP', code: '81' }, { iso: 'KE', code: '254' }, { iso: 'KG', code: '996' },
    { iso: 'KH', code: '855' }, { iso: 'KI', code: '686' }, { iso: 'KM', code: '269' }, { iso: 'KN', code: '1' },
    { iso: 'KP', code: '850' }, { iso: 'KR', code: '82' }, { iso: 'KW', code: '965' }, { iso: 'KY', code: '1' },
    { iso: 'KZ', code: '7', trunk: '8' }, { iso: 'LA', code: '856' }, { iso: 'LB', code: '961' }, { iso: 'LC', code: '1' },
    { iso: 'LI', code: '423' }, { iso: 'LK', code: '94' }, { iso: 'LR', code: '231' }, { iso: 'LS', code: '266' },
    { iso: 'LT', code: '370' }, { iso: 'LU', code: '352' }, { iso: 'LV', code: '371' }, { iso: 'LY', code: '218' },
    { iso: 'MA', code: '212', primary: true }, { iso: 'MC', code: '377' }, { iso: 'MD', code: '373' }, { iso: 'ME', code: '382' },
    { iso: 'MF', code: '590' }, { iso: 'MG', code: '261' }, { iso: 'MH', code: '692' }, { iso: 'MK', code: '389' },
    { iso: 'ML', code: '223' }, { iso: 'MM', code: '95' }, { iso: 'MN', code: '976' }, { iso: 'MO', code: '853' },
    { iso: 'MP', code: '1' }, { iso: 'MQ', code: '596' }, { iso: 'MR', code: '222' }, { iso: 'MS', code: '1' },
    { iso: 'MT', code: '356' }, { iso: 'MU', code: '230' }, { iso: 'MV', code: '960' }, { iso: 'MW', code: '265' },
    { iso: 'MX', code: '52' }, { iso: 'MY', code: '60' }, { iso: 'MZ', code: '258' }, { iso: 'NA', code: '264' },
    { iso: 'NC', code: '687' }, { iso: 'NE', code: '227' }, { iso: 'NF', code: '672' }, { iso: 'NG', code: '234' },
    { iso: 'NI', code: '505' }, { iso: 'NL', code: '31' }, { iso: 'NO', code: '47', primary: true }, { iso: 'NP', code: '977' },
    { iso: 'NR', code: '674' }, { iso: 'NU', code: '683' }, { iso: 'NZ', code: '64', primary: true }, { iso: 'OM', code: '968' },
    { iso: 'PA', code: '507' }, { iso: 'PE', code: '51' }, { iso: 'PF', code: '689' }, { iso: 'PG', code: '675' },
    { iso: 'PH', code: '63' }, { iso: 'PK', code: '92' }, { iso: 'PL', code: '48' }, { iso: 'PM', code: '508' },
    { iso: 'PN', code: '64' }, { iso: 'PR', code: '1' }, { iso: 'PS', code: '970' }, { iso: 'PT', code: '351' },
    { iso: 'PW', code: '680' }, { iso: 'PY', code: '595' }, { iso: 'QA', code: '974' }, { iso: 'RE', code: '262', primary: true },
    { iso: 'RO', code: '40' }, { iso: 'RS', code: '381' }, { iso: 'RU', code: '7', primary: true, trunk: '8' }, { iso: 'RW', code: '250' },
    { iso: 'SA', code: '966' }, { iso: 'SB', code: '677' }, { iso: 'SC', code: '248' }, { iso: 'SD', code: '249' },
    { iso: 'SE', code: '46' }, { iso: 'SG', code: '65' }, { iso: 'SH', code: '290' }, { iso: 'SI', code: '386' },
    { iso: 'SJ', code: '47' }, { iso: 'SK', code: '421' }, { iso: 'SL', code: '232' }, { iso: 'SM', code: '378' },
    { iso: 'SN', code: '221' }, { iso: 'SO', code: '252' }, { iso: 'SR', code: '597' }, { iso: 'SS', code: '211' },
    { iso: 'ST', code: '239' }, { iso: 'SV', code: '503' }, { iso: 'SX', code: '1' }, { iso: 'SY', code: '963' },
    { iso: 'SZ', code: '268' }, { iso: 'TC', code: '1' }, { iso: 'TD', code: '235' }, { iso: 'TG', code: '228' },
    { iso: 'TH', code: '66' }, { iso: 'TJ', code: '992' }, { iso: 'TK', code: '690' }, { iso: 'TL', code: '670' },
    { iso: 'TM', code: '993' }, { iso: 'TN', code: '216' }, { iso: 'TO', code: '676' }, { iso: 'TR', code: '90' },
    { iso: 'TT', code: '1' }, { iso: 'TV', code: '688' }, { iso: 'TW', code: '886' }, { iso: 'TZ', code: '255' },
    { iso: 'UA', code: '380' }, { iso: 'UG', code: '256' }, { iso: 'US', code: '1', primary: true }, { iso: 'UY', code: '598' },
    { iso: 'UZ', code: '998' }, { iso: 'VA', code: '39' }, { iso: 'VC', code: '1' }, { iso: 'VE', code: '58' },
    { iso: 'VG', code: '1' }, { iso: 'VI', code: '1' }, { iso: 'VN', code: '84' }, { iso: 'VU', code: '678' },
    { iso: 'WF', code: '681' }, { iso: 'WS', code: '685' }, { iso: 'XK', code: '383' }, { iso: 'YE', code: '967' },
    { iso: 'YT', code: '262' }, { iso: 'ZA', code: '27' }, { iso: 'ZM', code: '260' }, { iso: 'ZW', code: '263' },
];

/** The country an install starts with, and every install made before countries were stored. */
export const DEFAULT_COUNTRY = 'IN';

const BY_ISO = new Map(COUNTRIES.map((country) => [country.iso, country]));

export function countryByIso(iso: unknown): Country | undefined {
    return BY_ISO.get(String(iso ?? '').trim().toUpperCase());
}

/** The countries that use a calling code, the main one first. */
export function countriesForCode(code: unknown): Country[] {
    const digits = String(code ?? '').replace(/\D/g, '');
    return COUNTRIES.filter((country) => country.code === digits)
        .sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
}

/** Known ISO ids from a stored list, upper case, without repeats, in the list's order. */
export function cleanCountryList(list: unknown): string[] {
    if (!Array.isArray(list)) return [];
    const ids = list.map((iso) => countryByIso(iso)?.iso).filter((iso): iso is string => !!iso);
    return [...new Set(ids)];
}

/**
 * Countries for calling codes stored before countries were (`['91', '44']` gives
 * `['IN', 'GB']`): each code's main country. A code no country uses is dropped.
 */
export function countriesFromCodes(codes: readonly unknown[]): string[] {
    return [...new Set(codes.map((code) => countriesForCode(code)[0]?.iso).filter((iso): iso is string => !!iso))];
}

/** The calling codes of a list of countries, without repeats (`['US', 'CA']` gives `['1']`). */
export function codesOf(isos: readonly string[]): string[] {
    return [...new Set(isos.map((iso) => countryByIso(iso)?.code).filter((code): code is string => !!code))];
}

/**
 * The default and allowed countries from stored settings: the countries when
 * stored, else the main country of each stored code (an install saved before
 * countries were, PC-D7), else India. The default is always one of the allowed
 * countries; when it is not, the first allowed one is, so a stored mismatch
 * never opens a country the admin did not list.
 */
export function resolveCountrySettings(stored: { countries?: unknown; codes?: unknown; country?: unknown; code?: unknown }): { country: string; countries: string[] } {
    let countries = cleanCountryList(stored.countries);
    if (!countries.length && Array.isArray(stored.codes)) countries = countriesFromCodes(stored.codes);
    const named = countryByIso(stored.country)?.iso
        ?? countriesForCode(stored.code)[0]?.iso
        ?? (countries.length ? countries[0] : DEFAULT_COUNTRY);
    if (!countries.length) countries = [named];
    return { country: countries.includes(named) ? named : countries[0], countries };
}

/**
 * The allowed country an E.164 number belongs to: the longest matching code;
 * among countries that share it, `current` when it is one, else the main one.
 */
export function countryForE164(e164: string, allowed: readonly string[], current?: string): Country | null {
    const matches = allowed
        .map((iso) => countryByIso(iso))
        .filter((country): country is Country => !!country && e164.startsWith(`+${country.code}`));
    if (!matches.length) return null;
    const longest = Math.max(...matches.map((country) => country.code.length));
    const best = matches.filter((country) => country.code.length === longest);
    return best.find((country) => country.iso === current)
        ?? best.find((country) => country.primary)
        ?? best[0];
}

/** The country's name in `lang` (the browser's own names), or its ISO id when the browser has none. */
export function countryName(iso: string, lang = 'en'): string {
    try {
        return displayNames(lang)?.of(iso) ?? iso;
    } catch {
        return iso;
    }
}

const NAMES = new Map<string, Intl.DisplayNames | null>();

/** One `Intl.DisplayNames` per language: a search ranks every country on each keystroke. */
function displayNames(lang: string): Intl.DisplayNames | null {
    if (!NAMES.has(lang)) {
        try {
            NAMES.set(lang, new Intl.DisplayNames([lang, 'en'], { type: 'region' }));
        } catch {
            NAMES.set(lang, null);
        }
    }
    return NAMES.get(lang) ?? null;
}

/** The flag image for a country (vendored from flag-icons, MIT). */
export function flagUrl(iso: string): string {
    return `/flags/4x3/${iso.toLowerCase()}.svg`;
}
