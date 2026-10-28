/**
 * The shape of an AI answer (specs/ai-spec.md, AI-D10). A purpose's output schema is the
 * part of JSON schema that models accept; Arc checks every answer against it itself,
 * since a model that promises only JSON, or even one that promises the schema, can still
 * answer another shape. Other keywords (`description`, `format`, ...) are passed on to the
 * model and not checked.
 */

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface JsonSchema {
    type?: JsonType | JsonType[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: unknown[];
    minItems?: number;
    maxItems?: number;
    description?: string;
    [keyword: string]: unknown;
}

const TYPES: readonly JsonType[] = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

function typesOf(schema: JsonSchema): JsonType[] {
    if (schema.type === undefined) return [];
    return Array.isArray(schema.type) ? schema.type : [schema.type];
}

/**
 * What is wrong with a schema itself, or [] when it is one Arc can check. Run on every
 * purpose when the functions load, so a mistake shows before the first call.
 */
export function schemaProblems(schema: unknown, path = 'schema'): string[] {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return [`${path} must be an object`];
    const s = schema as JsonSchema;
    const problems: string[] = [];
    const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
    if (s.type === undefined && s.enum === undefined) problems.push(`${path} needs a type or an enum`);
    for (const t of types) if (!TYPES.includes(t)) problems.push(`${path}.type "${String(t)}" is not one of ${TYPES.join(', ')}`);
    if (s.properties !== undefined) {
        if (typeof s.properties !== 'object' || s.properties === null || Array.isArray(s.properties)) problems.push(`${path}.properties must be an object`);
        else for (const [key, sub] of Object.entries(s.properties)) problems.push(...schemaProblems(sub, `${path}.properties.${key}`));
    }
    if (s.required !== undefined) {
        if (!Array.isArray(s.required) || s.required.some((k) => typeof k !== 'string')) problems.push(`${path}.required must be a list of property names`);
        else for (const k of s.required) if (!s.properties || !(k in s.properties)) problems.push(`${path}.required names "${k}", which is not in properties`);
    }
    if (s.items !== undefined) problems.push(...schemaProblems(s.items, `${path}.items`));
    if (types.includes('array') && s.items === undefined) problems.push(`${path} is an array without items`);
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) problems.push(`${path}.enum must be a list of values`);
    for (const k of ['minItems', 'maxItems'] as const) {
        if (s[k] !== undefined && (!Number.isInteger(s[k]) || (s[k] as number) < 0)) problems.push(`${path}.${k} must be a whole number`);
    }
    return problems;
}

function typeMatches(value: unknown, type: JsonType): boolean {
    switch (type) {
        case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
        case 'array': return Array.isArray(value);
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'integer': return Number.isInteger(value);
        case 'boolean': return typeof value === 'boolean';
        case 'null': return value === null;
    }
}

/** Where an answer differs from the schema, at most `max` places; [] when it fits. */
export function answerProblems(value: unknown, schema: JsonSchema, path = 'answer', max = 5): string[] {
    const problems: string[] = [];
    const add = (p: string) => { if (problems.length < max) problems.push(p); };
    const walk = (v: unknown, s: JsonSchema, at: string): void => {
        if (problems.length >= max) return;
        const types = typesOf(s);
        if (types.length && !types.some((t) => typeMatches(v, t))) {
            add(`${at} should be ${types.join(' or ')}`);
            return;
        }
        if (s.enum && !s.enum.some((e) => e === v)) {
            add(`${at} should be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);
            return;
        }
        if (typeMatches(v, 'object')) {
            const obj = v as Record<string, unknown>;
            // Own keys only: `toString` or `constructor` must not count as present or as a property's schema.
            for (const k of s.required ?? []) if (!Object.hasOwn(obj, k)) add(`${at}.${k} is missing`);
            for (const [k, sub] of Object.entries(obj)) {
                const subSchema = s.properties && Object.hasOwn(s.properties, k) ? s.properties[k] : undefined;
                if (subSchema) walk(sub, subSchema, `${at}.${k}`);
                else if (s.additionalProperties === false) add(`${at}.${k} is not expected`);
            }
        }
        if (Array.isArray(v)) {
            if (s.minItems !== undefined && v.length < s.minItems) add(`${at} should have at least ${s.minItems} items`);
            if (s.maxItems !== undefined && v.length > s.maxItems) add(`${at} should have at most ${s.maxItems} items`);
            if (s.items) v.forEach((item, i) => walk(item, s.items as JsonSchema, `${at}[${i}]`));
        }
    };
    walk(value, schema, path);
    return problems;
}

/**
 * The simplest answer that fits a schema: empty texts, zeros, false, empty lists (or as
 * many empty items as minItems asks), every required property. Test mode answers with it
 * when the purpose gives no test answer (AI-D16).
 */
export function emptyAnswer(schema: JsonSchema): unknown {
    if (schema.enum?.length) return schema.enum[0];
    const types = typesOf(schema);
    const type = types.find((t) => t !== 'null') ?? types[0];
    switch (type) {
        case 'object': {
            const out: Record<string, unknown> = {};
            for (const k of schema.required ?? []) {
                const sub = schema.properties?.[k];
                out[k] = sub ? emptyAnswer(sub) : null;
            }
            return out;
        }
        case 'array': return Array.from({ length: schema.minItems ?? 0 }, () => (schema.items ? emptyAnswer(schema.items) : null));
        case 'string': return '';
        case 'number':
        case 'integer': return 0;
        case 'boolean': return false;
        default: return null;
    }
}

/**
 * The JSON in a model's answer. Models that promise only JSON sometimes wrap it in a
 * ```json fence or a sentence; the first complete object or list is taken. Undefined when
 * there is none.
 */
export function parseJsonAnswer(text: string): unknown {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        // Fall through to the fenced or embedded JSON.
    }
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch {
            // Fall through.
        }
    }
    const start = trimmed.search(/[[{]/);
    if (start < 0) return undefined;
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end <= start) return undefined;
    try {
        return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
        return undefined;
    }
}

/**
 * The schema in the form OpenAI's strict mode takes: every object closed and every property
 * required, the ones the purpose leaves optional allowed to be null. readStrictAnswer() takes
 * those nulls out again, so the answer is checked against the purpose's own schema.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
    const out: JsonSchema = { ...schema };
    if (schema.properties) {
        const required = new Set(schema.required ?? []);
        out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, sub]) => {
            const strict = strictSchema(sub);
            if (required.has(k)) return [k, strict];
            const types = strict.type === undefined ? [] : Array.isArray(strict.type) ? strict.type : [strict.type];
            if (!types.length || types.includes('null')) return [k, strict];
            return [k, { ...strict, type: [...types, 'null'] as JsonType[] }];
        }));
        out.required = Object.keys(schema.properties);
        out.additionalProperties = false;
    }
    if (schema.items) out.items = strictSchema(schema.items);
    return out;
}

/** An answer to strictSchema() as the purpose's schema has it: the nulls strict mode added are left out. */
export function withoutAddedNulls(value: unknown, schema: JsonSchema): unknown {
    if (Array.isArray(value)) return schema.items ? value.map((v) => withoutAddedNulls(v, schema.items as JsonSchema)) : value;
    if (typeof value !== 'object' || value === null || !schema.properties) return value;
    const required = new Set(schema.required ?? []);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const sub = Object.hasOwn(schema.properties, k) ? schema.properties[k] : undefined;
        if (!sub) {
            out[k] = v;
            continue;
        }
        const types = sub.type === undefined ? [] : Array.isArray(sub.type) ? sub.type : [sub.type];
        if (v === null && !required.has(k) && !types.includes('null')) continue;
        out[k] = withoutAddedNulls(v, sub);
    }
    return out;
}
