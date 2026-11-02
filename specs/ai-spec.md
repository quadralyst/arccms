# AI: Build Spec (AI, brief F38)

**Status:** agreed with Gunjan 2026-10-28; building on `feat/ai` (worktree `../arccms-ai`).
**Brief:** F38, "A general AI capability in Arc CMS". Written for every app on Arc CMS: an
app's own Cloud Functions ask a language model a question (text, pictures, documents in;
text or checked data out) through one helper, with the models, keys, limits, costs and logs
in the admin area. Arc itself has no AI feature of its own: every use is the app's.

**Scope:**
1. `askAi`, a documented function in the app kit, never a public callable.
2. Purposes the app declares in a new starter file, `functions/src/custom/ai.ts`.
3. Connections to providers set up in the admin area: an OpenAI-style connector (Alibaba
   Cloud Model Studio, OpenRouter, Hugging Face, OpenAI, DeepSeek, any compatible address)
   and Google Vertex for Gemini.
4. Keys set and rotated in the admin area, never readable from a browser.
5. Three tiers, a fallback list per tier, a model per purpose.
6. A record of every call, kept 60 days, with tokens and cost; the question and answer only
   when the purpose's switch is on.
7. Per-key daily allowances, a monthly budget with alerts, monthly totals kept 24 months.
8. Test mode, on by default, that spends nothing; a capture helper for unit tests.
9. A feature, `ai`, on by default (changed 2026-11-01, see AI-D18).
10. Settings, AI in the admin; docs page `docs/app/ai.html`.

**Out of scope (later briefs):** streaming answers; conversations with history; tools the
model may call; embeddings; the browser route (Firebase AI Logic) and App Check; editable
prompts in the admin; reading a PDF with a model that reads only pictures (turning pages
into pictures); Claude and open models through Vertex; any AI use of Arc's own.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| AI-D1 | Where the code runs | A server helper only, `askAi`, in `functions/src/ai/`, exported from the app kit. The app's own function checks who is asking, decides what to keep, and calls `askAi`. No callable of its own: nothing a browser can call to spend money. |
| AI-D2 | Where purposes are defined | Two layers. The app's code declares what a purpose is (`functions/src/custom/ai.ts`): label, description, the input it takes and its limits, the instruction, the output (text, or a JSON schema), a suggested tier, a default per-key daily allowance, a test answer. The admin decides how it runs (Settings, AI): on or off, which models (else the tier's), the per-key allowance, keep content or not. A calling function passes only the purpose and the input. A mistake in the file (a bad id, a bad schema, an input with no limits) stops the functions from loading, with a message naming the file. |
| AI-D3 | The first version | One question, one answer. Text, pictures (JPEG, PNG, WebP) and PDFs in; text or schema-checked data out. |
| AI-D4 | Tiers | `cheap`, `fast` (the default), `thorough`. Each is an ordered list of models (connection and model id). A purpose's own list, when the admin sets one, replaces its tier's. |
| AI-D5 | Fallbacks | The next model in the list answers only when the one before is busy or down, refuses the key, times out on its share, or no longer exists. Never after a safety block, a too-large input or an answer that does not fit the schema. A model that cannot read the input (a picture to a text-only model) is skipped. |
| AI-D6 | Connectors | (a) OpenAI-style Chat Completions over plain HTTPS (`fetch`), no provider SDK, so a cold start stays small. Presets fix the address: Alibaba Cloud Model Studio Frankfurt (EU), OpenRouter, Hugging Face, OpenAI, OpenAI EU, DeepSeek; "Other" takes any `https` address. (b) Google Vertex for Gemini, REST through `google-auth-library` (already a dependency) with the functions' own service account: no key. The unused `@google-cloud/vertexai` dependency is removed. |
| AI-D7 | Where it processes | Each connection shows where its provider processes data (from the preset, or what the admin types for Other). The admin chooses; Arc informs and never blocks. Vertex's location defaults to the multi-region of the functions region (`europe-*` to `eu`, `us-*` to `us`, else the functions region), never `global` unless the admin types it. |
| AI-D8 | Keys | Set, replaced and removed in Settings, AI through admin-only callables. Stored in `AiKeys/{connectionId}`, which no browser can read or write, not even an admin's. The page shows a preview, `••••` and the last 4 characters, who set it and when, when it last worked, and the last error. A key is stored with the address it was set for: when a connection's address changes, its key stops being sent (`off`, "set the key again"), so an address change cannot carry a key to another server. Functions read keys when calling and keep them in memory for 60 seconds, so a new key works within a minute, with no deploy. |
| AI-D9 | Answers and reasons | `{ ok: true, text }` or `{ ok: true, data }`, with `usage` and `recordId`. Failures: `unreadable` (no usable answer, or not the schema's shape), `blocked` (a safety block; `detail` says whether the question or the answer), `too-large`, `limit` (`scope: 'key'` or `'budget'`, with `wait` in seconds), `unavailable` (busy, down or key refused, with `wait` when known), `timeout`, `off` (the feature, the purpose or nothing set up; `detail` says which). A developer's mistake (an unknown purpose, an input kind the purpose does not take, a wrong type) throws. |
| AI-D10 | Checking the answer | Arc parses the JSON and checks it against the schema itself, for every provider. The checker covers the part of JSON schema models accept: `type` (one or a list), `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `minItems`, `maxItems`; other keywords such as `description` are passed on and not checked. A model that promises only JSON gets the schema in its instruction. |
| AI-D11 | Records | `AiCalls/{id}`, one per `askAi` call, with every attempt in it: time, purpose, tier, the app's `ref` and `limitKey`, input size (characters, files, bytes), each attempt's connection, model, outcome and milliseconds, tokens in, out and thinking, cost in USD and where it came from (`provider` or `price-list`), outcome and reason, test or live. The question and answer (`content`) only when the purpose's switch is on: the instruction, the text, the answer, and each file as a copy in Storage at `{storagePrefix}ai-calls/{id}/{n}-{name}`, and the rest in `AiCalls/{id}/content/main`, read only when a call is opened. `costFrom` is `provider`, `price-list` or `none` (no price: counted as 0). Admins read; no browser writes. |
| AI-D12 | Keeping | A daily job deletes records older than 60 days with their files, monthly totals older than 24 months and spent allowance counters. |
| AI-D13 | Prices and cost | Arc ships a price list for its preset models (USD per million tokens in and out, with the date checked). The admin can change a price or add one for any model. A call's cost is the provider's own figure when it gives one (OpenRouter), else tokens times the price list. A model with no price costs 0, so the budget cannot count it: the checklist and Advanced warn about each one in use, and a Test says its cost is not counted. Arc ships only prices checked on the provider's own page. |
| AI-D14 | Allowances and budget | A per-key daily allowance: a call with `limitKey` uses `units` (default 1) of that key's allowance for the purpose, counted per day in the site's time zone (ArcClock). A monthly budget in USD (default 20) across all purposes: admins get a notification and an email at 80% and at 100%, once each a month; at 100% calls answer `limit` with `scope: 'budget'` until the month turns or the admin raises it. Test mode counts allowances (so an app can test its limit screen) and costs nothing. A failure gives its units back only when nothing was billed. The admin's allowance applies only to a purpose that has one in the code (its calls carry a key). A call may pass its key's own `perDay` (0 or more, such as from the key's plan), which comes before the admin's and the purpose's (Gunjan, 2026-11-02). A purpose may name its keys with `limitKeyLabel` (such as `merchant`) for Settings, AI; default "user or business". A budget of 0 stops every live call. |
| AI-D15 | Totals | `AiUsage/{yyyy-mm}`: calls, failures, tokens and cost for the month, by day, purpose and model. `AiUsage/{yyyy-mm}/keys/{purpose}__{key}` per key. The app kit's `aiUsage({ limitKey, purpose?, month? })` reads a key's totals, for example to show or pass on a business's cost. |
| AI-D16 | Test mode | Settings, AI, Mode: Test (the default for a fresh install) or Live. In test mode nothing is sent to a provider: the answer is the purpose's `testAnswer` (a value, a function of the input, or `aiTestFailure(reason)`), else built from the schema (empty texts, zeros, empty lists), else "Test answer for {label}". Records are written, marked test. The admin's provider Test is a live call even in test mode, and is billed. `captureAiAsks()` in the app kit does the same for unit tests without touching Firestore or Storage. |
| AI-D17 | Safety | Each provider's own defaults; a provider's block comes back as `blocked`. No admin setting. |
| AI-D18 | The feature | `ai`, on by default (Gunjan, 2026-11-01; first built off by default like `pwa`); off with `off: ['ai']` in `src/custom/features.ts`. Off: the AI functions are not deployed, Settings, AI and its card are hidden, and `askAi` answers `off` without throwing, so the same app code runs in a project with AI and one without. |
| AI-D19 | Security | `AiKeys`: no browser access. `AiCalls`, `AiUsage`: admins read, nobody writes from a browser. Storage `ai-calls/`: admins read, nobody writes. `askAi` reads Storage paths with admin rights, so it takes paths only in the install's bucket, never `..` or another bucket; the app checks the caller may read what it passes (docs). Other addresses must be `https` with a host name, not an address literal, a local name or a trailing dot; names are not resolved (only admins set them, and redirects are refused). No tools, so a picture's hidden instructions can only change the answer, which the schema check bounds. |

---

## 2. What is true before this (Arc `dev` at 59a1abda)

- No AI call anywhere in `functions/src` and no AI setting. `@google-cloud/vertexai` is in
  `functions/package.json` but unused; its generative part was shut down on 2026-06-24.
- `sendAppEmail` (app kit) shows the pattern: a developer mistake throws, outcomes are
  returned, `captureAppEmails` for unit tests, a starter file for the app's own templates.
- Features: `FEATURE_INFO` in `src/app/core/features/feature-registry.ts` with `defaultOn`;
  `functions/src/features/<id>.ts` exported only when on.
- `Settings/{doc}`: admins read and write every document (the catch-all rule), so a secret
  cannot live there.

## 3. The API

```ts
// functions/src/custom/ai.ts (the app's)
import type { AiPurposes } from '../app-kit/index.js';

export const AI_PURPOSES: AiPurposes = {
  'menu-scan': {
    label: 'Menu scan',
    description: 'Reads a photographed menu into sections, items, sizes and prices.',
    input: { text: { maxChars: 2000 }, pictures: { max: 5, maxMb: 10 } },
    instruction: 'Read this menu. ...',
    output: { schema: MENU_SCHEMA },
    tier: 'thorough',
    perKeyPerDay: 20,
    testAnswer: SAMPLE_MENU,
  },
};

// an app function
import { askAi } from '../app-kit/index.js';
const r = await askAi({
  purpose: 'menu-scan',
  input: [{ storagePath: 'app/menus/b1/p1.jpg' }, 'The menu is in German.'],
  limitKey: businessId,
  units: 1,
  ref: `businesses/${businessId}/scans/${scanId}`,
});
if (r.ok) use(r.data); else show(r.reason);
```

Input parts: a string; `{ text }`; `{ storagePath, mimeType? }`; `{ bytes: Buffer, mimeType, name? }`.

## 4. Phases

| Phase | What | Done when |
|-------|------|-----------|
| AI1 | Feature `ai`; starter file and its checks; types; input preparation; schema checker; test mode; records with the content switch; `captureAiAsks`; rules for the new collections and Storage folder; app kit exports | Unit tests for every reason that test mode can produce, the checker, the starter file's checks; rules tests |
| AI2 | OpenAI-style connector and presets; model abilities; fallback list; keys (`AiKeys`, `setAiKey`, `removeAiKey`, `testAiConnection`); `aiSetupInfo` (purposes and providers for the page) | Connector tests against a fake server for each reason; key preview and address guard tests |
| AI3 | Allowances, prices, cost, `AiUsage` totals, budget stop and alerts, `aiUsage`, the daily cleanup job | Tests for each limit, totals, cleanup |
| AI4 | Settings, AI: Setup (Get started checklist, mode, providers connected step by step with each provider's own instructions, recommended models, tiers, prices, budget), Purposes, Usage (month, by purpose, model, key; CSV), Calls (recent calls, details) | Page specs; browser check on xlm after Gunjan's deploy |
| AI5 | Vertex connector for Gemini; remove `@google-cloud/vertexai` | Connector tests; one live call on xlm |
| AI6 | `docs/app/ai.html`, app kit page, features page, screenshots; full suite; final review | `npm run test`, `npm run test:rules`, `npm run check:docs`, `npm run check:core` |

Each phase ends with a critical review of that phase's work.
