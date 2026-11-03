# AI for every kind of output: Build Spec (AM, follows F38)

**Status:** AM1 built on `feat/ai-media-am1` (worktree `../arccms-ai-media`), 2026-11-02, not merged; AM2 built on `feat/ai-media-am2` (from AM1), 2026-11-02, not merged; AM3 built on `feat/ai-media-am3` (from AM2), 2026-11-02, not merged; AM4 built on `feat/ai-media-am4` (from AM3), 2026-11-03, not merged; AM5 built on `feat/ai-media-am5` (from AM4), 2026-11-03, not merged. All five are combined, with `dev` at e13d2c43 merged in, on `feat/ai-media` (2026-11-03): full suite and rules tests green, deployed to xlm and browser-checked in test mode; not merged into `dev`. Spec drafted 2026-11-02; updated the same day with Gunjan's answers, and the remaining questions settled as assumptions (section 8). Nothing built. No provider is called live during the build: every new connector is written from the provider's docs, tested against a fake server, and marked "not tested live" until its first real use (AM-D34). Builds on the F38 AI
feature (`specs/ai-spec.md`, decisions AI-D1 to AI-D19), on `dev` at eb1e2bca.
**Brief:** Arc CMS becomes the one place an app makes every AI call: text, data, pictures,
speech, other audio and video, from all the popular providers, so the keys, logs, costs,
allowances and budget of every call are kept the same way. Written for every app on Arc CMS;
nothing here is specific to one app.

**Scope:**
1. One call, `askAi`, for every kind of output. A purpose says what it makes: `text`,
   `data`, `image`, `speech`, `audio` or `video`. Purposes, connections, keys, test mode,
   per-key daily allowances (`limitKey`, `perDay`, `limitKeyLabel`), the monthly budget,
   call records and Usage stay one system for every kind.
2. Cost by the unit each model bills: tokens, pictures (by size and quality), characters,
   seconds. Budget and Usage total in USD.
3. Files out: what a model makes is saved to Cloud Storage; the answer gives its path, type
   and size; the call record links it. Test mode returns a small stand-in file.
4. Long-running jobs (video, some music): the call answers `pending` with a job id; Arc
   finishes it in the background and writes the outcome to a job record.
5. Pacing per connection: a per-minute limit and an at-once limit queue calls instead of
   failing them.
6. A key header per provider (`api-subscription-key`, `xi-api-key`, `x-api-key`,
   `x-goog-api-key`, or `Authorization: Bearer`).
7. An opt-in cache per purpose: the same input gives the same file, with no new charge.
8. Voices: a speech purpose names its voices; Settings, AI lists each provider's voices and
   plays a sample.
9. New providers, first wave (section 6), including MiniMax, Alibaba Qwen-Image, Kling and
   HeyGen.
10. An AI tab in the Media Manager, on the Media page and in the picker, through Arc's own
    purpose "Media image".
11. Cached input priced as each provider bills it: cache reads, cache writes, and the higher
    price some models charge above a prompt size.
12. The remaining balance of each connection whose own key can read it, with a low-balance
    alert, and an alert when a provider says the account is out of credit.

**Out of scope (later briefs):** speech to text; audio and video in the Media Manager;
Google Veo on Vertex, Runway, ByteDance Seedance, Alibaba Wan, Vidu, Luma and other video
providers; ByteDance Seedream, Z.ai, Tencent Hunyuan, Kling and other picture providers;
StepFun and other speech providers (all in the backlog, `specs/_todo.md` item 7); OpenAI
speech (Gunjan, 2026-11-02: OpenAI retires it on 2027-01-06); Stability and Midjourney;
streaming audio to a browser; voice cloning and voice design; editors using the Media
Manager AI tab (admins only at first); splitting a long text across several speech
requests (section 8); reading balances or spend with an admin or management key (AM-D32); data
residency choices beyond what Settings, AI shows today (Gunjan, 2026-11-02: not now);
provider callbacks for finished jobs (AM-D12); every F38 out-of-scope item not named here.

**Changes to F38:** the out-of-scope line "any AI use of Arc's own" goes: Arc gets one
purpose of its own, `arc-media-image` (AM-D20). Tiers stay for text and data only (AM-D4).
The Vertex preset is renamed "Google Cloud (Vertex AI)", since it now also makes pictures
and speech with the same service account (AM-D7). F38's cost counts every input token at
the full price; it now prices cached input as each provider bills it (AM-D31).

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| AM-D1 | One call | `askAi` makes every kind. A purpose's new field `makes` says which: `text` (the default), `data` (the default when `output` has a schema, as today), `image`, `speech`, `audio`, `video`. A call's answer has the shape of its kind (section 3). An F38 purpose works unchanged. A purpose that makes a file declares what its calls may pass (`input`) and its defaults (`image`, `speech`, `audio`, `video` blocks); the call may change only what the purpose lets it. |
| AM-D2 | What is shared | Everything in F38 applies to every kind: purposes in `functions/src/custom/ai.ts` checked at load, the admin's on or off, models, allowance and keep-content per purpose, connections and keys, test mode, the per-key daily allowance with `limitKey`, `units`, `perDay` and `limitKeyLabel`, the monthly budget and its alerts, `AiCalls`, `AiUsage`, `aiUsage()`, `captureAiAsks()`, the daily cleanup, the `ai` feature switch. |
| AM-D3 | Models know what they make | Each model Arc knows says what it makes (one kind; a provider model that does two, such as a Gemini model that writes and draws, is two entries), the unit it bills, its prices, and what it supports for its kind (section 4.2). An admin can add any other model of a connection and say the same. A model is offered for a purpose only when it makes that purpose's kind. |
| AM-D4 | Which model answers | Text and data keep the three tiers. Each other kind has one default list in Settings, AI ("Picture models", "Speech models", "Audio models", "Video models"), up to 5, in order; a purpose's own list replaces it, as today. Fallback follows AI-D5: the next model tries only after busy, down, key refused, timed out or gone. A model that cannot do what the call asks (a seed, an edit, the purpose's voice) is skipped, like a text model given a picture. A purpose may set `fallback: false` so only the first model answers, for an app that wants one voice throughout. |
| AM-D5 | Units and prices | Each model bills one unit: `tokens` (USD per million in and out, as today; also image and audio tokens where the provider counts them so), `pictures` (USD per picture, by quality and size), `characters` (USD per 1,000 characters sent), `seconds` (USD per second made, for audio and video, optionally by resolution and with or without sound). Arc ships the prices it checked on the provider's own page, with the date (`PRICES_CHECKED_ON` per preset, no longer one date). A provider that prices in another currency (Sarvam: INR only) ships its prices in that currency; the admin sets the USD value of one unit of it in Settings, AI, and until then the model counts 0 with the F38 warning, since Arc ships no exchange rate. The admin changes a price, or sets one for a model Arc does not know, in the same place as today. A model with no price counts 0, with the F38 warnings. |
| AM-D6 | Cost of a call | The provider's own figure when it reports one (OpenRouter today; Kling reports what each task billed; ElevenLabs reports characters or credits used in a header, which Arc converts at the admin's price, since credits cost what the plan costs). Else the measured amount times the price: tokens from the answer's usage; pictures returned; characters of the text sent (the provider's count when it gives one); seconds of the file made (from the request, checked against the file's length when it can be read). The record keeps the amount and unit, the cost and where it came from. A model that makes a file but bills tokens (OpenAI's `gpt-image-2.5` models publish only token prices; Gemini TTS bills audio tokens) is priced from the tokens its answer reports; for the estimate before a call (AM-D21), its entry carries a typical figure (tokens per picture by quality and size, tokens per second of audio), and the estimate says "about". |
| AM-D7 | Connector kinds | Plain HTTPS `fetch`, no provider SDK, as AI-D6. Kinds: `openai` (Chat Completions, as today; plus OpenAI's own images endpoints, only on the OpenAI and OpenAI EU presets), `anthropic` (Messages API), `gemini` (the Gemini API with a key: text through `generateContent`; pictures and video through the Interactions API, `/v1beta/interactions`, which Google's docs now show for them), `vertex` (Google Cloud with the functions' service account: Gemini text and Gemini image through `generateContent`, and Cloud Text-to-Speech, Chirp 3 HD and Gemini TTS voices, at its own address, `texttospeech.googleapis.com` or `eu-texttospeech.googleapis.com`), `elevenlabs` (speech, sound effects, music, voices), `sarvam` (speech; its chat models through the `openai` kind with Sarvam's header), `minimax` (speech, voices, pictures and video, `api.minimax.io`), `dashscope` (Alibaba's own picture address on the Alibaba EU connection, with the same workspace and key as its chat models), `kling` (video), `heygen` (presenter videos, AM-D33). Mistral, Groq and xAI are `openai`-kind presets. Not offered: Imagen (Google shut it down on the Gemini API on 2026-08-17 and marks it discontinued on Vertex; Gemini image models replace it), OpenAI speech (Gunjan, 2026-11-02: OpenAI retires `/v1/audio/speech` on 2027-01-06), OpenAI video (Sora's API was shut down on 2026-09-24) and Veo on Vertex (Gunjan chose Gemini Omni Flash, 2026-11-02; Veo on Vertex runs only in us-central1 and, by Google's page, only on Provisioned Throughput). A connector exposes one function per kind it makes (`text`, `image`, `speech`, `audio`, `videoStart` and `videoCheck`, `voices`), each returning the F38 attempt failures. |
| AM-D8 | Key header | A preset says how its key is sent: the header name and an optional prefix (`Authorization` with `Bearer `, `x-api-key`, `xi-api-key`, `api-subscription-key`, `x-goog-api-key`). "Other" lets the admin choose the header from a short list (`Authorization: Bearer`, `api-key`, `x-api-key`, or a custom name of letters, digits and `-`, never `host`, `cookie`, `content-*` or a `x-forwarded-*` header). Keys are still tied to the address (AI-D8): the header is part of what a key was set for, so changing it also needs the key set again. |
| AM-D9 | Files out | A file a model makes is saved to the install's bucket and never returned as bytes. Default place: `{storagePrefix}ai-files/{purpose}/{yyyy-mm}/{recordId}-{n}.{ext}`, which only admins read and only the functions write (a new excluded folder in `storage.rules`, like `ai-calls/`). A purpose may set `saveTo` (a folder in the bucket, not `ai-files`, `ai-calls`, `users`, `email-logs`, `mediaFiles`) and a call may pass `saveAs` (a full path inside that folder), so the app puts the file where its own rules serve it; the app checks the caller may write there, as with `storagePath` today. The answer gives each file's `path`, `mimeType`, `bytes`, and `width` and `height` or `seconds`. The record links the files. |
| AM-D10 | Keeping files | Arc never deletes a file the app saved with `saveTo`. Files in `ai-files/` stay until the app moves or deletes them, unless the purpose (or the admin, per purpose) sets `deleteAfterDays`: then the daily cleanup deletes them that many days after they were made. `moveAiFile(from, to)` in the app kit moves a file a call made (in `ai-files/`, or named by a call's record; never a test file or the cache's copy) to a path that is not in Arc's own folders and not already taken, and updates its records' links, so the Calls tab still finds it. The record's link shows "moved or deleted" when the file is gone. |
| AM-D11 | Test mode | Nothing is sent and nothing is spent, as AI-D16. A purpose that makes a file gets a stand-in: a grey picture of the asked size (PNG, made in code, a few KB), a second of silence per 15 characters of speech up to 10 seconds (WAV), the asked length of silence for audio up to 10 seconds, and a 2-second grey video shipped with Arc (MP4, under 50 KB). Stand-ins are saved like real files, marked `test: true` on the record, and always in `ai-files/` with `deleteAfterDays: 1`, even when the purpose has `saveTo`, so test files never land among real ones. `testAnswer` may give the stand-in's path, or `aiTestFailure(reason)`. A video or a job in test mode answers `pending` and finishes on the next background check, so the app can test both screens. `captureAiAsks()` records file calls and answers with a stand-in path without writing anything. |
| AM-D12 | Long jobs | A model that takes longer than a call can wait (every video model; music when the provider makes it a job) answers `{ ok: 'pending', jobId, recordId }`. Arc keeps `AiJobs/{jobId}`: purpose, status (`pending`, `done`, `failed`), the provider's operation id, `ref`, `limitKey`, when it started, the outcome with files or a reason, and the cost when done. A scheduled function, `checkAiJobs`, runs every minute while any job is pending (it reads one query and stops when there are none), asks each provider how its job is doing, and on success puts the file in Storage and writes the outcome. Every first-wave video provider gives a download address (Gemini API Files, Kling, MiniMax, HeyGen); the check streams it to Storage, never held in memory, at once, since each provider keeps its copy only for a while (the Gemini API about 2 days, MiniMax's task 7 days, Kling 30 days, HeyGen not stated). Kling and HeyGen can also call back when a job ends; this brief polls every provider (HeyGen sends its callback only once, so polling is needed anyway) and leaves callbacks for later. A job not done after the purpose's `jobTimeoutMinutes` (default 30, at most 120) fails with `timeout`. |
| AM-D13 | Hearing that a job finished | Two ways, both optional. (a) The purpose's `onJobDone(result, job)` in `functions/src/custom/ai.ts`, run by `checkAiJobs` when the job ends, so the app writes the outcome to its own documents. A throw there is logged and retried on the next check, at most 3 times. (b) A browser listens to `AiJobs/{jobId}`: admins read every job, and a call may pass `readers` (up to 10 `arccms_uid` values) who may read that one job. Nobody writes jobs from a browser. `aiJob(jobId)` in the app kit reads one from a function. |
| AM-D14 | Jobs, allowance and budget | The allowance units are counted when the job starts and given back if it fails before the provider bills it (AI-D14's rule). The budget is checked when the job starts. The cost is added to the month's totals when the job ends, in the month it started, since that is what the provider bills. Jobs running at the same time can pass the budget by about one job each, as calls can today; the docs say so. |
| AM-D15 | Pacing | A connection may have `perMinute`, the most requests it sends in a minute, and `atOnce`, the most it has running at the same moment, both across every function instance. Presets fill them where the provider publishes a number for its entry plan (Sarvam: 60 a minute on pay as you go, per account; ElevenLabs: no per-minute limit, 3 at once on Starter; MiniMax: 60 a minute for speech, 10 for pictures; HeyGen: 10 at once); the admin changes them to the plan bought, or sets 0 for no limit at all. A connector may have one limit per kind where the provider sets them so (MiniMax). Arc counts in `AiPacing/{connection}`: requests this minute, and the running requests as leases that end when the request ends or its time runs out, so a crashed instance cannot hold a place. One transaction a request, only for connections with a limit. A call over a limit waits for a place while its purpose's time allows, checking again after 1, 2, then 4 seconds, else answers `unavailable` with `wait`. One document a connection suits the limits providers publish (tens to a few hundred a minute); for a plan above that, the admin leaves the limits empty and Arc relies on the provider's 429. A provider's own 429 (with its retry time when it gives one) is retried once on the same model when the time allows, then falls back. `checkAiJobs` is paced by the same counts. |
| AM-D16 | Cache | Opt in per purpose with `cache: true` (or `cache: { days }`, default 365); the admin can switch it off. The key is a hash of the purpose, the model, its voice, every setting that changes the output, and the input text (and input files' hashes). A call looks in the cache for each model of its list in order and takes the first hit, before any provider is asked. A hit within the days answers with the same file and counts against nothing (Gunjan, 2026-11-02: usage counts only when a provider is called): no provider call, no budget, no allowance units, no call, tokens or cost in Usage. The hit still leaves a call record, marked `cached`, with cost 0 and the record id of the call that made the file, and Usage shows a separate "served from cache" count beside the calls, never added to them. The cache keeps its own copy of each file in `ai-files/_cache/{purpose}/` (changed in the AM1 review: a copy apart from where any call put it, so one call moving or deleting its file never takes it from the next); a hit copies it to where that call wants it (its `saveAs`, its `saveTo`, or `ai-files/`). A hit whose copy is gone is a miss: Arc makes it again and stores the new file. `AiCache/{hash}`: the copies' paths, what each file is, the record id, the model, when made, no browser access. A purpose with `fallback: false` looks only for its first model's files. The cleanup deletes entries past their days with their copies. Test mode never reads or writes the cache. Text and data are not cached in this brief. |
| AM-D17 | Voices | A speech purpose declares named voices: `voices: { narrator: { elevenlabs: '<voice id>', sarvam: 'priya', vertex: 'en-US-Chirp3-HD-Kore' } }`, keyed by preset id (`vertex` for Google Cloud Text-to-Speech), first one the default. The admin can change each mapping in Settings, AI, Purposes, choosing from the provider's voice list. A call passes `voice: 'narrator'`, never a provider's voice id, so the app's code stays the same across providers. A model whose preset has no voice for the asked name is skipped (AM-D4). The voice id is part of the record and the cache key. |
| AM-D18 | Voice lists and samples | Settings, AI shows each speech connection's voices (name, language, accent or labels, gender where given), from the provider's own list (ElevenLabs, Google Cloud and MiniMax have a list call; Sarvam has documented fixed lists that Arc ships). Play uses the provider's sample file when it has one (ElevenLabs `preview_url`). Otherwise Play makes a short sample live, one sentence in the voice's language, billed as purpose `arc-voice-sample` (a few characters), cached for a year so each voice is paid for once. An admin-only callable `aiVoices({ connection })` fetches the list, kept in memory 10 minutes. |
| AM-D19 | Image, speech, audio and video settings | One set of words for every provider; each connector maps them, and a model's entry says what it supports so the rest is not sent. Image: `aspect` (`1:1`, `4:3`, `3:4`, `3:2`, `2:3`, `16:9`, `9:16`), `resolution` (`standard` about 1 MP, `high` about 4 MP), `quality` (`low`, `medium`, `high`), `count` 1 to 4, `seed`, `negativePrompt`, `format` (`png`, `jpeg`, `webp`), input pictures to edit. The nearest supported aspect is used and recorded. Of the first-wave picture models, only OpenAI's take a quality (Gemini image models ignore it, so the control is hidden for them), and none take a seed or a negative prompt: those controls exist for later providers and stay hidden until a model has them. `high` resolution needs a model that makes it (`gpt-image-2` by custom size, Gemini image models at 2K); others offer `standard` only. Speech: `voice`, `language` (BCP 47), `speed` (0.5 to 2), `format` (`mp3` default, `wav`, `opus`), `style` (an instruction for models that take one). Audio: `seconds`, `loop` where supported, `format`. Video: `seconds`, `aspect` (adds `21:9`), `resolution` (`480p`, `720p`, `1080p`, `4k`; the nearest the model makes), `sound` (on or off), `negativePrompt`, `seed`, a first-frame picture. `providerOptions: { [preset]: {...} }` on the purpose passes extra fields to one provider, never overriding the model, the text, the voice or the output. |
| AM-D20 | Arc's own purpose | `arc-media-image`, "Media image", built into Arc and shown in Settings, AI, Purposes with an "Arc CMS" mark. It makes pictures for the Media Manager (AM-D21). The admin can switch it off, give it models, and change its allowance (default 20 pictures per admin a day, counted in pictures, AM-D23) and `deleteAfterDays` (default 7, for pictures that were never saved to the library). Its `limitKey` is the admin's `arccms_uid`. App purposes keep their rule: ids may not start with `arc-`. |
| AM-D21 | Media Manager AI tab | A tab "Create with AI" on the Media page and in image pickers, shown only when the `ai` feature is on and the image list (or `arc-media-image`'s own list) has a model. Controls: prompt; negative prompt, seed and quality only when the chosen model supports them; model (picture models only); aspect and resolution, starting from the picker's `cropRatio` and `size`; count 1 to 4. Below them, before Generate: the estimated cost, the admin's pictures left today and the month's budget left. Results come in a grid; the chosen picture goes through the existing crop and size steps and is saved to the library like an upload, with a "Made with AI" note. Generate again keeps the settings. In test mode the tab says so and makes grey pictures. Section 5. |
| AM-D22 | How the tab generates | An admin-only callable, `generateMediaImages`, runs `askAi` with `arc-media-image`, or with an app purpose that sets `mediaManager: true` (AM-D24), never any other purpose. It answers paths in `ai-files/`; the page loads each picture through an admin-only `readAiFile({ path })` (base64, as `readMediaImage` does, so the bucket's CORS setup does not matter). A callable answers at most about 10 MB, so the tab asks for WebP or JPEG where the model offers it and at most `high` (about 4 MP); `readAiFile` refuses a file over 7 MB with a message rather than failing. Saving to the library reuses the crop step's upload, so the library entry is an ordinary set of sizes in `mediaImages/`. Its timeout is 300 seconds. |
| AM-D23 | Allowance units by kind | A purpose may count its allowance in its billed amount: `allowanceIn: 'calls'` (the default: `units` per call, as today), `'pictures'`, `'characters'` or `'seconds'`. So "20 pictures a day" or "50,000 characters a day" needs no counting by the app. `perDay` and the admin's number are in the same unit, and Settings, AI shows it. |
| AM-D24 | App settings for the AI tab | `MediaDialogData` gets `ai?: { purpose?, prompt?, negativePrompt?, model?, quality?, count?, aspect?, resolution?, seed? }`, all optional, and `initialTab: 'ai'`. The admin can change every one before Generate. `purpose` names an app purpose with `makes: 'image'` and `mediaManager: true`; its `instruction` is the house style, added after the admin's prompt; its own allowance and models apply, but not its `saveTo`: pictures made in the tab always go to `ai-files/` until one is saved to the library. Without one, `arc-media-image` answers with no house style. |
| AM-D25 | The "Made with AI" note | A library entry made in the tab gets `ai: { prompt, negativePrompt?, model, connection, settings, costUsd, createdAt, createdBy, recordId, purpose }` on its `media` document. Media details show it under the picture, with Generate again (opens the tab with those settings). The title defaults to the first words of the prompt; alt text is left for the admin, with a hint. |
| AM-D26 | Editing a picture | The second step of the images phase: "Edit with AI" on a library picture, for models that edit (`edit: true`): prompt and count, no mask in this brief. The result is a new library entry with the original's id in its note; the original stays, as cropping works today. |
| AM-D27 | Records and Usage | `AiCalls` gains `kind`, `amount` and `unit` (such as `1,240 characters`), `files` (path, type, bytes, size or seconds), `cached`, `jobId`, and the voice. `AiUsage` gains `byKind`, each model's amount in its unit, cached input and cache-write tokens, and `cacheHits` (AM-D16), kept apart from `calls`. Settings, AI, Usage shows a Kind column and filter, a model's amount in its unit, and "served from cache"; Calls plays audio and video and shows pictures inline from the record's files (admin reads, through `readAiFile`). The CSV gets kind, amount, unit, cached. |
| AM-D28 | Security | Everything in AI-D19 holds. New collections `AiJobs` (admins read, `readers` read their own job), `AiCache`, `AiPacing` (no browser access). New Storage folder `ai-files/` excluded from public reads (both levels, as `ai-calls/`), admins read, nobody writes from a browser. `saveTo` and `saveAs` take only paths inside the install's bucket, without `..`, outside Arc's private folders. A file address in a provider's answer (Gemini API Files, Kling, MiniMax, HeyGen, Alibaba) is fetched only when it is `https`, passes the F38 address guard, and its host is one the preset lists for that provider's downloads; the key is sent only to the provider's own API host, never to a download host. `generateMediaImages` and `readAiFile` check the admin claim; `readAiFile` reads only `ai-files/` and `ai-calls/`. |
| AM-D29 | Safety and people | Each provider's defaults, as AI-D17; a block comes back as `blocked`. Provider-specific rules about real people, children and voices are the provider's; the docs point to them. Arc adds no watermark of its own; providers that add one (Google SynthID, OpenAI C2PA) keep it. |
| AM-D30 | Feature and cold start | Still the one `ai` feature. New functions: `checkAiJobs` (every minute), `generateMediaImages`, `readAiFile`, `aiVoices`, `aiAvatars`, all off with the feature; the balance check runs inside the daily `cleanUpAi`. Connectors are loaded only when a call needs them (dynamic import), so an app function that asks only text pays no cold-start cost for the media code. |
| AM-D31 | Cached input prices | Every first-wave text provider bills cached input for less, each at its own rate, and some bill cache writes for more, so a token model's price has up to four parts: input, output, cached input, cache write (Gunjan, 2026-11-02). Arc ships each from the provider's page, such as Anthropic reads at 0.1 times input on most models, 0.05 on `claude-opus-5-5` and `claude-sonnet-5-5`, writes at 1.25 times for 5 minutes and 2 times for an hour; OpenAI reads at 0.1 (0.05 on its newest models) and writes at 1.25 or 2.5 on models that report them; Gemini about 0.1; Mistral 0.1; Groq 0.5 on `gpt-oss` only; Qwen hits 0.1 to 0.2 and writes 1.25. Each connector reads its provider's own fields (`cache_read_input_tokens` and `cache_creation_input_tokens`; `prompt_tokens_details.cached_tokens` and `cache_write_tokens`; `cachedContentTokenCount`; `prompt_cache_hit_tokens`), and counts cached tokens only once (most providers include them in the input count). A model may also have a higher price above a prompt size (`claude-haiku-5-5` above 100K tokens, xAI from 200K). A price that changes by the hour (DeepSeek's off-peak price) is counted at the higher one, so the budget never counts too little. A missing cached price falls back to the input price, which overstates, never understates. A provider's own cost figure still comes first (OpenRouter). Arc does not set up caching itself in this brief; it prices what the provider reports. |
| AM-D32 | Balances | A connection whose own key can read its account shows the balance in Settings, AI, Setup, checked once a day by `cleanUpAi` and on the admin's Refresh: DeepSeek (`GET /user/balance`), ElevenLabs (`GET /v1/user/subscription`: characters used, the plan's limit, the next reset), HeyGen (`GET /v3/users/me`: wallet balance), Kling (`GET /account/costs`: units left per pack, up to 12 hours late) and OpenRouter (`GET /key`: what is left of that key's own limit, labelled so, since it is not the account's balance). The admin may set a low mark per connection: below it, admins get a notification and an email, once until the balance rises again. Every other connection shows a link to its provider's billing page. A provider's out-of-credit answer (Sarvam 402, ElevenLabs quota, and the like) tells admins at once, once a day per connection, and the call falls back to the next model, as after a refused key. Balances and spend that need an admin or management key (OpenAI, Anthropic, Mistral, OpenRouter's account, xAI, Alibaba) are not read: such a key can do far more than call a model, so Arc does not store one in this brief. The balance is stored on the connection in `Settings/ai` (`balance`, `balanceUnit`, `balanceAt`), written by the functions; admins can write that document, as today, but the figure only informs and decides nothing. |
| AM-D33 | Presenter videos | The second step of the video phase: `video: { presenter: true }` on a purpose makes a video of an avatar speaking, through HeyGen (`POST /v3/videos`). Like voices (AM-D17), the purpose names its avatars, `avatars: { host: { heygen: '<avatar id>' } }`, with each avatar's voice from HeyGen's list, and the call passes `avatar: 'host'` with the script as text, or `{ storagePath }` of an audio file the avatar speaks to, such as one Arc's speech made. Settings, AI lists the avatars (`GET /v3/avatars/looks`, through an admin-only `aiAvatars`) with their pictures. HeyGen bills from a prepaid USD wallet by the minute of video; its own pages disagree on the rate, so Arc ships the higher figure, marked not tested live (AM-D34). It runs as a job (AM-D12). |
| AM-D34 | Untested connectors | No live calls to providers are made while this brief is built (Gunjan, 2026-11-02). Each new connector is written from its provider's docs as read on 2026-11-02 and tested against a fake server that answers as the docs say, success and every failure. Each preset and model entry carries `testedLive: false` and the date its docs were read. Settings, AI shows "Not tested live yet" on such a connection and in its model picker, and `docs/app/ai.html` and `docs/features/ai.html` list which providers and kinds are not yet tested live. The first project that uses one runs it for real, fixes what differs from the docs, sets `testedLive: true` with the date, and confirms its prices, as part of that project. Prices ship as the provider's page gives them; where its pages disagree, the higher figure, so the budget counts too much rather than too little; where a page gives only token prices, the cost comes from the tokens the answer reports. An unconfirmed response field (such as ElevenLabs' `character-cost` header) is used when present, else Arc counts the amount itself (characters sent, seconds made). Arc's own Test button (F38) stays: an admin may still choose to try a connection live. |

---

## 2. What is true before this (Arc `dev` at eb1e2bca)

- `askAi` asks language models only: text, pictures and PDFs in; text or checked data out
  (`functions/src/ai/askAi.ts`). One connector shape, `Connector(context, request)`,
  returns text and token usage (`connectors/types.ts`); two kinds, `openai` and `vertex`.
- Presets (`presets.ts`) know models by what they read and their token prices, with one
  `PRICES_CHECKED_ON` for all. Keys are always sent as `Authorization: Bearer`.
- `AiModelSettings` has `priceIn` and `priceOut` per million tokens; `AiCallRecord` has
  tokens and cost; `AiUsage` totals by day, purpose, model and key.
- Allowances count `units` per call; the month's budget is checked before each call.
- No files out, no jobs, no pacing, no cache, no voices.
- The Media Manager's tabs come from `mediaManagerMenu` in
  `src/shared/constants/common-constants.ts`, filtered by kind (`image`, `icon`, `file`)
  in `media.page.ts`. `MediaDialogData` has `title`, `allowImages`, `allowIcons`,
  `allowFiles`, `multiple`, `initialTab`, `size` and `cropRatio`. The crop step saves a
  copy with `FileUploadService.uploadCroppedCopy`, reading the source bytes through the
  `readMediaImage` callable. No Media Manager code knows about AI.
- Storage: everything readable by anyone except `users/`, `email-logs/` and `ai-calls/`
  (first two levels).

## 3. The API

```ts
// functions/src/custom/ai.ts (an app's)
import type { AiPurposes } from '../app-kit/index.js';

export const AI_PURPOSES: AiPurposes = {
  'article-audio': {
    label: 'Article audio',
    description: 'Reads a paragraph of an article aloud.',
    makes: 'speech',
    input: { text: { maxChars: 2000 } },
    voices: {
      narrator: { elevenlabs: 'ELEVENLABS_VOICE_ID', sarvam: 'priya', vertex: 'en-US-Chirp3-HD-Kore' },
      guest: { elevenlabs: 'ANOTHER_VOICE_ID', vertex: 'en-US-Chirp3-HD-Puck' },
    },
    speech: { language: 'en-US', format: 'mp3' },
    saveTo: 'app/article-audio',
    cache: true,
    perKeyPerDay: 50_000,
    allowanceIn: 'characters',
  },
  'cover-picture': {
    label: 'Cover picture',
    makes: 'image',
    instruction: 'Flat illustration, warm colours, no text in the picture.',
    image: { aspect: '16:9', quality: 'medium', count: 1 },
    mediaManager: true,
    deleteAfterDays: 7,
  },
  'promo-clip': {
    label: 'Promo clip',
    makes: 'video',
    video: { seconds: 8, aspect: '16:9', resolution: '720p', sound: true },
    onJobDone: async (result, job) => { /* write result.files[0].path to job.ref */ },
  },
};

// an app function
const r = await askAi({
  purpose: 'article-audio',
  input: paragraph.text,
  voice: 'narrator',
  saveAs: `app/article-audio/${articleId}/${paragraph.id}.mp3`,
  limitKey: siteId,
  ref: `articles/${articleId}`,
});
if (r.ok === true) save(r.files[0].path);       // { path, mimeType, bytes, seconds }
else if (r.ok === 'pending') wait(r.jobId);      // video, or a provider's long job
else show(r.reason);
```

What a call may add for a file kind, each only when the purpose's `input` allows it:
`voice`, `speech: { speed, language }`, `image: { aspect, resolution, quality, count,
seed, negativePrompt }`, `audio: { seconds }`, `video: { seconds, aspect, resolution,
sound, seed }`, `avatar` and an audio file (`{ storagePath }`) for a presenter video, input
pictures (`{ storagePath }`) for an edit or a first frame, `saveAs`,
and `readers` for a job. Everything else is the purpose's or the admin's.

Answers:

```ts
type AskAiResult =
  | { ok: true; text?: string; data?: unknown; files?: AiFile[]; usage; recordId; cached?: boolean }
  | { ok: 'pending'; jobId: string; usage; recordId }
  | { ok: false; reason; scope?; wait?; detail?; usage; recordId };

interface AiFile { path: string; mimeType: string; bytes: number; width?: number; height?: number; seconds?: number }
// usage adds: kind, amount, unit ('tokens' | 'pictures' | 'characters' | 'seconds')
```

`ok: 'pending'` is new; an F38 purpose (text or data) never gets it, so existing
`if (r.ok)` code is unchanged. The docs show the three-way check for file kinds.

New app kit exports: `moveAiFile(from, to)`, `aiJob(jobId)`, `estimateAiCost({ purpose,
input?, image?, ... })` (the price-list estimate, for an app's own "this will cost" line),
types `AiFile`, `AiJob`, `AiKind`.

## 4. Data and settings

### 4.1 Collections and folders

| Where | What | Who reads |
|-------|------|-----------|
| `AiCalls/{id}` | F38 record plus `kind`, `amount`, `unit`, `files`, `voice`, `cached`, `jobId` | Admins |
| `AiJobs/{id}` | Long job: status, operation id, outcome, files, cost, `readers` | Admins; each uid in `readers` its own |
| `AiCache/{hash}` | Path, record id, model, made at, expires at | Nobody from a browser |
| `AiPacing/{connection}` | This minute's count and the running requests' leases | Nobody from a browser |
| `AiUsage/{yyyy-mm}` | F38 totals plus `byKind`, each model's amount, cached and cache-write tokens, `cacheHits` | Admins |
| `Settings/ai` connections | Balance, its unit and when it was read (AM-D32) | Admins, as today |
| Storage `ai-files/` | Files made, by purpose and month | Admins |

### 4.2 What a model entry says

```ts
interface AiKnownModel {
  makes: 'text' | 'image' | 'speech' | 'audio' | 'video';   // text covers data
  unit: 'tokens' | 'pictures' | 'characters' | 'seconds';
  reads?: AiReads[];            // text: as today; image: 'pictures' when it edits
  schema?: 'strict' | 'json';   // text only
  prices: {...};                // by unit: in/out/cached in/cache write per M tokens, with an optional higher price above a prompt size; per picture by quality and size; per 1,000 characters; per second by resolution and sound
  currency?: 'USD' | 'INR';     // prices in another currency need the admin's rate (AM-D5)
  image?: { aspects; resolutions; qualities; maxCount; seed; negativePrompt; edit; formats };
  speech?: { maxChars; formats; languages; style; voices: 'list' | 'fixed' };
  audio?: { maxSeconds; loop; formats };
  video?: { seconds: number[]; aspects; resolutions; sound; seed; negativePrompt; firstFrame };
  job?: boolean;                // answers through AiJobs
  recommend?: Array<'cheap' | 'fast' | 'thorough' | 'default'>;
}
```

The admin's `AiModelSettings` gains the same fields, so a model Arc does not know can be
described and priced in Settings, AI, Advanced.

### 4.3 Settings, AI

- **Setup:** connections gain the header (Other only), `perMinute` and `atOnce`, the USD
  value of the provider's currency when it is not USD, and for speech connections a
  Voices button (Avatars for HeyGen). Connections whose key can read a balance show it,
  with Refresh and a low mark (AM-D32); the others link to the provider's billing page.
  Below the tiers, the four default lists (pictures, speech,
  audio, video), each shown only when a connection has a model of that kind. "Use
  recommended models" fills them too.
- **Purposes:** a Kind column; for speech, each named voice with its mapping per provider
  and Play; for file kinds, where files go (`ai-files` or the app's folder),
  `deleteAfterDays` and the cache switch; the allowance with its unit. `arc-media-image`
  listed with the "Arc CMS" mark.
- **Usage:** Kind filter and column; amounts in each model's unit.
- **Calls:** Kind column; a call's details show its pictures, play its audio and video,
  and link its job.

## 5. The Media Manager AI tab

- **Where:** a new `mediaManagerMenu` entry, `value: 'ai'`, `kind: 'image'`, after My
  Uploads. Hidden when the `ai` feature is off or no picture model is set up (read from
  `Settings/ai`, which admins already read). Not shown to editors in this brief.
- **Controls, top to bottom:** Prompt (required, up to 2,000 characters). Model (picture
  models of the purpose's list, or the default list; the first preselected). Aspect, from
  the picker's `cropRatio` (`free` and `original` start at `1:1`), and Resolution, from
  `size` (`s` and `m` standard, `l` and `xl` high). Quality (`low`, `medium`, `high`)
  when the model has it. Count 1 to 4. "More": Negative prompt and Seed, each only when the
  model takes it. Each control is read from the model's entry (4.2), so changing the
  model hides what it lacks and keeps what the admin typed.
- **Before Generate:** one line: "About $0.17 for 4 pictures. 16 pictures left today.
  $12.40 of this month's $20 left." The figures come from `estimateAiCost` and the
  admin's allowance and the month's totals, read by `generateMediaImages({ estimate:
  true })`. Generate is off with the reason when the allowance or the budget would run
  out.
- **While it works:** the grid shows the count of placeholders and the busy line Arc
  uses elsewhere. Cancel stops waiting; the provider may still finish and bill, so those
  pictures are recorded as usual and left in `ai-files/` for `deleteAfterDays`.
- **Results:** a grid of the pictures. Choosing one opens the existing crop step at the
  picker's ratio, then the size step, then saves to the library as an upload does and
  returns it to the caller like any library pick. On the Media page, Save to library
  saves without a caller. Generate again keeps every setting; changing the seed or not is
  the admin's choice.
- **The note:** saved on the library entry (AM-D25); Media details show "Made with AI"
  with the prompt, model, settings, cost and date, and Generate again.
- **Apps:** `mediaPickerDialogConfig({ isDialogOpen: true, initialTab: 'ai', cropRatio:
  '16:9', size: 'xl', ai: { purpose: 'cover-picture', prompt: articleTitle } })` opens the
  tab ready to go with the app's house style.
- **Phone:** the controls stack above the grid, two pictures a row; Generate stays in
  reach at the bottom, as Insert and Cancel do today.
- **Edit with AI** (AM-D26): on a selected library picture, for models with `edit`.

## 6. Providers, first wave

Each row is what the provider's own docs and price pages said on 2026-11-02, read through
a summarising fetcher. Prices are list prices for the entry plan. "Not confirmed" items
follow AM-D34: built from the docs, marked not tested live, settled on first real use.
Model ids change often: each phase re-reads the provider's model list (docs, not live
calls) before choosing what Arc recommends.

### 6.1 Text and data (AM1)

Cached input and cache-write prices for each of these are in AM-D31; the build copies each
model's figures from the provider's page.

| Provider | Connector | Address | Key header | Schema | Reads | Models Arc would recommend, USD per M tokens in / out | Notes |
|----------|-----------|---------|-----------|--------|-------|-------------------------------------------------------|-------|
| Anthropic | `anthropic` (Messages API) | `https://api.anthropic.com/v1/messages` | `x-api-key`, plus `anthropic-version` | strict (`output_config.format`, `json_schema`) | pictures, PDFs | `claude-haiku-5-5` 0.10 / 0.50 (prompts up to 100K tokens; 0.50 / 2.50 above), `claude-sonnet-5-5` 2 / 10, `claude-opus-5-5` 4 / 20 | Version `2026-10-21` refuses `temperature` (400), so the connector drops it; `thinking` maps to `output_config.effort` (`low`, `high`). Busy is 529. Processing: worldwide or US only (`inference_geo: us`, 1.1 times the price); no EU option. |
| Google Gemini API | `gemini` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `x-goog-api-key` | strict | pictures, PDFs | `gemini-3.5-flash-lite` 0.30 / 2.50, `gemini-3.8-flash` 0.75 / 3.75 (1.50 / 7.50 from 2027-01-01), `gemini-4-argon` 2 / 10 (4 / 20 from 2026-12-01) | Same body as Vertex. Google calls `generateContent` "legacy but fully supported" next to its Interactions API; text stays on `generateContent` in this brief (Q2). No EU processing on this API: point EU clients to Vertex. Shipped prices carry their end dates. |
| Mistral | `openai` preset | `https://api.mistral.ai/v1`; EU `https://api.eu.mistral.ai/v1` | `Authorization: Bearer` | strict when `strict: true` is sent (Mistral's default is false) | pictures, PDFs (`document_url`) | `ministral-8b-2512` 0.15 / 0.15, `mistral-small-2603` 0.15 / 0.60; Large 4 0.70 / 2.10 is in preview, id not confirmed | Two presets, Mistral and Mistral EU (EU and EFTA data centres, 1.1 times the price). |
| Groq | `openai` preset | `https://api.groq.com/openai/v1` | `Authorization: Bearer` | strict on some models | pictures on one preview model only, no PDFs | `openai/gpt-oss-20b` 0.075 / 0.30, `openai/gpt-oss-120b` 0.15 / 0.60 | Its Llama 3 models were shut down on 2026-08-16. Sends `retry-after`; a custom 498 status is read as busy. No EU address. |
| xAI | `openai` preset | `https://api.x.ai/v1` | `Authorization: Bearer` | strict | pictures (JPEG, PNG) | `grok-4.3` 1.25 / 2.50, `grok-4.7` 2 / 6 | xAI calls Chat Completions "legacy" in favour of its Responses API (Q2). US-only address `us.api.x.ai` at 1.1 times the price serves two models. No EU address. |
| Sarvam (chat) | `openai` preset | `https://api.sarvam.ai/v1` | `api-subscription-key` | `json_schema` documented, not confirmed per model | text | `sarvam-105b` Rs 15 / Rs 60 | Prices in INR only (AM-D5). A wrong key is 403, out of credit 402 (read as `off`, and admins are told, AM-D32), busy 503. Cached input Rs 5 per M. Pacing 60 a minute on pay as you go. |

### 6.2 Speech (AM2)

| Provider | Connector | Address | Key header | Unit and price | Voices | Notes |
|----------|-----------|---------|-----------|----------------|--------|-------|
| ElevenLabs | `elevenlabs` | `https://api.elevenlabs.io/v1/text-to-speech/{voice}` (raw audio back) | `xi-api-key` | characters: `eleven_v4`, `eleven_v3`, `eleven_multilingual_v2` $0.08 per 1,000; `eleven_flash_v2_5` $0.04 | `GET /v2/voices` with `preview_url`, languages and labels | Most characters a request: v4 10,000, v3 5,000, multilingual v2 10,000, flash v2.5 40,000. `output_format` as a query (`mp3_44100_128` default). Limits are at once, not a minute (Starter 3, Creator 5, Pro 10). A `character-cost` header is shown in ElevenLabs' examples, not confirmed on a live answer. EU, India and other residency addresses are Enterprise only, with their own keys. |
| Sarvam | `sarvam` | `https://api.sarvam.ai/text-to-speech` (base64 in JSON) | `api-subscription-key` | characters: `bulbul:v3` Rs 30 per 10,000, `bulbul:v4-flash` Rs 10 per 10,000 | fixed lists in Sarvam's docs (37 for v3, about 222 for v4 flash), no list call, no sample files | Up to 2,500 characters a request (v3, v4 flash). The language goes in `target_language_code`, which live apps get speech back with (Sarvam's reference page now shows `language_code`; Arc sends the field proven live) (11 Indian languages, `hi-IN` and so on; v4 flash has no Malayalam or Odia yet); `pace` 0.5 to 2; `output_audio_codec` WAV (default) or MP3, never Opus on v3 and v4 flash. `speech_sample_rate` 8000 to 48000 Hz (22050 by default). 60 requests a minute on pay as you go, per account across keys. |
| Google Cloud Text-to-Speech | `vertex` (service account) | `https://texttospeech.googleapis.com/v1/text:synthesize`; EU `eu-texttospeech.googleapis.com` | none (service account) | characters per million: Standard and WaveNet $4, Neural2 $16, Chirp 3 HD $30, Studio $160, each with a monthly free amount; Gemini TTS voices bill tokens | `GET /v1/voices`, no sample files | Up to 5,000 bytes a request, not characters: about 1,600 characters of Devanagari. The Text-to-Speech API must be switched on in the project. |
| MiniMax | `minimax` | `https://api.minimax.io/v1/t2a_v2` (hex audio, or an address kept 24 hours) | `Authorization: Bearer` | characters: HD models $1.00 per 10,000, turbo $0.60 | `POST /v1/get_voice` | About 40 languages, including Hindi and Tamil (Tamil perhaps only on its 2.6 models, not confirmed). Under 10,000 characters a request. 60 requests a minute. |

OpenAI speech is left out (Gunjan, 2026-11-02): OpenAI shuts every model on
`/v1/audio/speech` down on 2027-01-06, and its replacement works only over its Realtime API.
Alibaba's Qwen speech is Singapore only, 600 characters a request and has no Indian
language; its CosyVoice works only over a streaming connection; neither is offered.

### 6.3 Pictures (AM3)

| Provider | Connector | Address | Unit and price | Supports | Notes |
|----------|-----------|---------|----------------|----------|-------|
| OpenAI | `openai` (OpenAI presets only) | `/v1/images/generations`, `/v1/images/edits` | pictures for `gpt-image-2`: low $0.006, medium $0.053, high $0.211 (square; 3:2 and 2:3 a little less); `gpt-image-1-mini` low $0.005, medium $0.011, high $0.036; `gpt-image-2.5-flare` and `-sunburst` tokens only ($30 per M picture tokens out) | quality low to high, sizes 1024 square, 1536 by 1024 and back, custom sizes on `gpt-image-2` up to 3840 by 2160; `n` up to 10 (Arc caps 4); edits with up to 16 pictures; PNG, JPEG or WebP | Always base64 back. No seed, no negative prompt. `gpt-image-1` was shut down on 2026-10-23 and `gpt-image-1.5` goes on 2026-12-01. |
| Alibaba Qwen-Image | `dashscope` (on the Alibaba EU connection) | `{workspace}.eu-central-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` (answers at once); `wan2.6-t2i` through `.../image-generation/generation` with `X-DashScope-Async: enable`, then `GET /api/v1/tasks/{id}` | pictures: Qwen-Image 2.1 turbo $0.016, Qwen-Image 3.0 $0.03, up to $0.075; `wan2.6-t2i` $0.03 | sizes as `W*H`, 1 to 6 a request, seed, negative prompt (not on the 2.1 models; not stated for 3.0) | `Authorization: Bearer`, keys per region. Answers an address kept 24 hours, fetched at once. Frankfurt has pictures only: no speech, no music. |
| MiniMax pictures | `minimax` | `https://api.minimax.io/v1/image_generation`, model `image-01` | pictures: about $0.0035 | 8 aspect ratios, 1 to 9 a request (Arc caps 4), seed; an address or base64 | 10 requests a minute. |
| Google Gemini image | `gemini` (Interactions API) and `vertex` (`generateContent`) | `.../v1beta/interactions`; Vertex `.../locations/global/publishers/google/models/{model}:generateContent` | pictures: `gemini-nano-banana-2.1` 1K $0.034, 2K $0.050, 4K $0.113; `gemini-3.1-flash-lite-image` 1K $0.034; `gemini-3.1-flash-image` 1K $0.067 | aspect ratios, sizes 1K, 2K, 4K; edits with input pictures | No quality, seed or negative prompt. Every picture carries Google's SynthID mark. Imagen 4 is shut down on the Gemini API and marked discontinued on Vertex, so Arc offers no Imagen. |

### 6.4 Video (AM4)

| Provider | Connector | Address | Unit and price | Supports | Notes |
|----------|-----------|---------|----------------|----------|-------|
| Google Gemini Omni Flash on the Gemini API | `gemini` (Interactions API) | `.../v1beta/interactions`, model `gemini-omni-1.1-flash` | tokens, about $0.10 a second at 720p ($17.50 per M video tokens) | 16:9 or 9:16; 360p to 4K (above 720p upscaled); sound on by default; first frame | The first video provider (Gunjan, 2026-11-02). It replaced Veo 3.1 on the Gemini API, whose previews were shut down on 2026-10-22. No negative prompt or seed. The file is fetched from the Files API by the job check. |
| Kling | `kling` | `https://api-singapore.klingai.com`: `POST /text-to-video/kling-3.0` (or `kling-4.0`), `POST /image-to-video/kling-3.0`; check `GET /tasks?task_ids=` | seconds, paid from prepaid units at $0.14 a unit: Kling 3.0 $0.084 to $0.168 a second (720p, 1080p), Kling 4.0 $0.157 to $0.235 a second | 3.0: 720p, 1080p, 4K; 16:9, 9:16, 1:1. 4.0: 720p, 1080p; 21:9 to 1:1; 3 to 30 seconds. First and last frame. No negative prompt field | `Authorization: Bearer` with one API key (the older access key and secret pair is legacy). Results kept 30 days. Each task reports what it was billed, which Arc uses as the cost. |
| MiniMax H3 | `minimax` | `POST /v2/video_generation`; check `GET /v2/query/video_generation/{task}` | seconds: $0.025 to $0.13 a second by model and resolution | `MiniMax-H3` 768p, 2K, 4 to 15 seconds; `-Highspeed`, `-Lite` 480p, 768p; `-Max` | Cheapest. No seed, negative prompt or sound field; whether it makes sound is not confirmed, so Arc offers it as video without sound (section 8). Tasks can be checked for 7 days. Hailuo models are marked legacy and not offered. |
| HeyGen (presenter videos) | `heygen` | `https://api.heygen.com/v3/videos`; check `GET /v3/videos/{id}` | minutes of video from a prepaid USD wallet, about $1 to $4 a minute; Arc ships $4 (AM-D34) | an avatar speaking a script in a voice, or speaking to an audio file; avatar and voice lists | The second step of AM4 (AM-D33). `x-api-key`. HeyGen retired its v1 and v2 API on 2026-11-01, so v3 only. 10 at once. |

Not offered: OpenAI Sora (its API was shut down on 2026-09-24, with no replacement), and
Veo on Vertex (us-central1 only, Provisioned Throughput by Google's page). In the backlog:
ByteDance Seedance (BytePlus, priced by tokens, about $0.04 to $0.57 a second, results kept
24 hours), Alibaba Wan ($0.10 to $0.15 a second; Frankfurt has only the older models),
Vidu (priced in RMB credits) and Runway (gen4.5 $0.12 a second; it also resells Kling,
Seedance, Wan and Veo).

### 6.5 Other audio (AM5)

| Provider | Connector | Address | Unit and price | Supports | Notes |
|----------|-----------|---------|----------------|----------|-------|
| ElevenLabs sound effects | `elevenlabs` | `/v1/sound-generation` | seconds: $0.12 a minute | 0.5 to 30 seconds, `loop`, `prompt_influence` | ElevenLabs' FAQ also says "billed per generation"; Arc ships the per-minute figure, not tested live (AM-D34). |
| ElevenLabs music | `elevenlabs` | `/v1/music` (audio back in the same request) | seconds: $0.15 a minute | 3 seconds to 5 minutes (the shorter of its pages' limits), with or without vocals, `music_v2_5` | No job needed (AM5). |

## 7. Phases

Each phase merges into `dev` on its own, with the docs, tests and full suite green, and
ends with a critical review of that phase's work.

| Phase | What | Done when |
|-------|------|-----------|
| AM1 | Generic core: `makes`, kinds on models and purposes, the connector shape per kind, units and prices per unit (with per-preset dates), files out (`ai-files/`, `saveTo`, `saveAs`, `moveAiFile`, `deleteAfterDays`), stand-in files, pacing (`perMinute`, `atOnce`, retry after 429), key header per preset and for Other, the cache (hits recorded as `cached`, kept out of Usage), `allowanceIn`, records and Usage by kind, `readAiFile`, rules for the new collections and folder; cached-input and cache-write prices for every text connector, the existing ones included (AM-D31); balances and out-of-credit alerts (AM-D32) for DeepSeek and OpenRouter. `testedLive` on presets and models, with "Not tested live yet" in Settings, AI (AM-D34). New text connectors: `anthropic`, `gemini` (key), and presets for Mistral, Groq, xAI and Sarvam chat. Settings, AI: header, pacing, per-unit and cached prices, the currency rate, balances, Kind on Purposes, Usage and Calls. | Unit tests for each kind's checks, stand-ins, pacing under parallel calls, cache hit and miss (a hit adds nothing to Usage but `cacheHits`), header guard, cost per unit, cached-token cost per provider's usage fields, balance and low-mark alerts; connector tests against a fake server for each new provider's failures; rules tests; the Settings, AI changes checked in the browser on xlm in test mode, with no live provider call |
| AM2 | Speech: `elevenlabs` (with its balance), `sarvam`, `minimax`, Google Cloud Text-to-Speech (on the `vertex` connection); named voices, `aiVoices`, Play with samples and `arc-voice-sample`; Settings, AI voices on connections and purposes | Connector tests per provider against a fake server; voice mapping and skip tests; voice lists and Play checked in the browser with the fake answers |
| AM3 | Pictures: OpenAI images (`gpt-image-2` family), Gemini image models on the Gemini API and on Vertex, Alibaba Qwen-Image (`dashscope`), MiniMax pictures; `arc-media-image`, `generateMediaImages`, the Media Manager AI tab, the "Made with AI" note, `MediaDialogData.ai`; then, as a second step in the same phase, Edit with AI | Page specs for the tab (controls per model, estimate, limits, test mode, phone width); connector tests per provider against a fake server; tab checked in the browser in test mode on the Media page and in a picker |
| AM4 | Video with jobs: `AiJobs`, `checkAiJobs`, `onJobDone`, `readers`, `aiJob`; Gemini Omni Flash first, then Kling (with its balance) and MiniMax H3; then, as a second step in the same phase, presenter videos through HeyGen (AM-D33: avatars, `aiAvatars`, script or audio, its wallet balance) | Job tests (pending, done, failed, timeout, retry of `onJobDone`, test-mode job); connector tests per provider against a fake server, presenter videos included |
| AM5 | Other audio: ElevenLabs sound effects (0.5 to 30 seconds) and music (3 seconds to 5 minutes; ElevenLabs answers music in the same request, so it needs no job, but a long piece needs a purpose `timeoutSeconds` near the 540 limit, and Arc refuses a `seconds` its time cannot cover) | Connector tests against a fake server |

No phase calls a provider live (AM-D34). Docs in every phase: `docs/app/ai.html` (each kind, files, jobs, voices, cache, pacing, and which connectors are not tested live yet),
`docs/features/ai.html` (Settings, AI), `docs/features/media.html` (the AI tab, AM3),
the app kit page, and screenshots of every changed screen.

## 8. Open questions

Settled with Gunjan on 2026-11-02: video starts with Gemini Omni Flash (Kling, MiniMax and
HeyGen added after the research; Veo, Seedance, Wan, Vidu and Runway to the backlog);
OpenAI speech is left out; cached input is priced per model (AM-D31); a hit in Arc's own
cache counts against nothing and leaves a record marked `cached` (AM-D16); the admin
enters the USD rate for providers priced in another currency (AM-D5); balances are read
where the call key allows (AM-D32); data residency is not taken further for now.

The rest were settled as assumptions on 2026-11-02, as Gunjan asked; each can be changed
later without reworking the design:

1. **Long text for speech.** Arc does not split a long text across requests. A text over
   a model's cap (Sarvam 2,500 characters, Google 5,000 bytes, ElevenLabs 5,000 to 40,000,
   MiniMax 10,000) skips that model and answers `too-large` when no model in the list takes
   it; apps send a line or a paragraph at a time. The docs say so.
2. **API shapes.** Text stays on Gemini's `generateContent` and xAI's Chat Completions,
   both still supported; pictures and video on the Gemini API use the Interactions API,
   the only shape Google documents for them.
3. **The AI tab's defaults.** Admins only; 20 pictures per admin a day; pictures never
   saved to the library are deleted after 7 days. The admin can change both in Settings,
   AI.
4. **Unconfirmed prices and fields.** Built from the docs and marked not tested live
   (AM-D34): ElevenLabs' cost header and sound-effect price, OpenAI `gpt-image-2.5` (cost
   from tokens), Mistral Large 4 (not recommended until its id is published), HeyGen's
   rate ($4 a minute, the higher figure), Kling's unit ($0.14, as its page says), MiniMax
   and Alibaba per-model prices as their pages give them. Settled on first real use.
5. **MiniMax H3 sound.** Offered as video without sound (`sound` not supported in its
   entry) until a first real use shows otherwise.
6. **AM2 choices** (2026-11-02, from the providers' docs re-read for the phase):
   - Voice maps are keyed by preset, not by connection: two ElevenLabs connections share a voice name's id.
   - A speech purpose without `voices` gets one voice, `default`, which the admin maps.
   - `fallback: false` now limits the list to its first model before anything else, so a
     skipped first model never lets the second speak (it used to count only models tried).
   - Google Cloud Text-to-Speech is one model per voice type (`tts-chirp3-hd`, `tts-neural2`,
     `tts-wavenet`, `tts-standard`, `tts-studio`), since Google prices by type; a voice of
     another type is refused before a request. Gemini TTS voices (billed by tokens) are left
     for later. Its speech models carry their own `testedLive: false` on a tested preset.
   - ElevenLabs: `eleven_v4` recommended; WAV at 24 kHz (44.1 kHz WAV needs its Pro plan); no
     `language_code` to Multilingual v2 and no speed to v3 and v4, which do not take them.
   - MiniMax: `speech-2.8-hd` recommended; the 2.6 models kept; no `GroupId`, which its
     current docs do not mention.
   - Sarvam: `bulbul:v3` recommended, since Arc ships all 37 of its speakers but only the
     first 40 of v4 flash's 222 (the admin can type any other id).
   - ElevenLabs and MiniMax have no text connector, so they have no Test: connecting one
     checks the key by reading its voice list, which is free and counts as the connection's
     last success. Voice lists are read in test mode too, since they send nothing of the
     site's and cost nothing.
   - `arc-voice-sample` is Arc's first own purpose; an app cannot call an `arc-` purpose. It
     takes no models: `aiVoiceSample` names the one model and voice id.
   - From the AM2 review: a speech `too-large` from a provider lets the next speech model try;
     a file call's `off` (a voice, an API for that kind) never marks the connection's card,
     and a file made by a provider that also answers text does not mark it working; a
     sample is said in the admin's language, else English, else the voice's first;
     "Use recommended models" fills only empty lists of kinds the app makes.
7. **AM3 choices** (2026-11-02, from the providers' docs re-read for the phase):
   - OpenAI: `gpt-image-2` recommended, with `gpt-image-2.5-flare` and `-sunburst` (token prices
     only, so their cost comes from the answer's tokens and their estimate says "about").
     `gpt-image-1-mini` is left out: OpenAI shuts it down on 2026-12-01 with `gpt-image-1.5`.
     Edits are sent as JSON with `images` (the reference's shape; its examples use multipart).
   - Gemini on the Gemini API goes through the Interactions API (the only shape its picture guide
     shows); on Vertex through `generateContent` with `imageConfig` (Google marks it deprecated
     for `responseFormat.image`, but the newer field takes JPEG only) at the `global` address,
     since `gemini-nano-banana-2.1` is served only there. One picture a request, sent at once.
   - Alibaba: Qwen-Image 2.1 Turbo (recommended), 3.0 and 3.0 Pro, sync only; `wan2.6-t2i` is
     left out, since Frankfurt runs it only as a background job. Pictures come from Frankfurt's
     Global scope (its EU scope lists none). Singapore's prices ship, the higher. Result
     addresses are fetched from any `aliyuncs.com` host, never with the key; Frankfurt's
     result host is not in the docs.
   - MiniMax `image-01`, base64 back, its own 10 a minute (`kindLimits`, counted in
     `AiPacing/{connection}~image` unless the admin sets the connection's limits).
   - The tab's estimate line reads "Cost: $0.21. Pictures left today: 16. $12.40 of this
     month's $20.00 left." (no plural forms). An edit starts at the picture's own shape. The
     admin's one price for a picture model replaces Arc's prices by quality or resolution.
   - Picture models are added to the image list by "Use recommended models" even when no app
     purpose makes pictures, since Arc's Media image uses that list.
   - From the AM3 review: the tab asks for an estimate only when its settings change (a new
     answer object never starts another request); `gpt-image-2` at high resolution counts four
     times its standard price (`highFactor`); Qwen-Image 3.0 Pro offers standard only (PNG at 4 MP
     could pass `readAiFile`'s 7 MB); a picker's automatic crop is skipped when the picture is
     already the ratio's shape, and a cropped copy keeps the note and title; an app purpose with
     `mediaManager` and no `deleteAfterDays` has its tab pictures deleted with Media image's days;
     Edit with AI reads only paths in the library's `mediaImages/` folder; Generate is off when the
     cost is more than the budget has left; pictures asked for and not made are given back to the
     allowance; the note records the fitted settings; a provider's file is read with a byte cap
     and every hop passes the public-host check; an admin's own pacing numbers put every kind on
     one counter.
8. **AM4 choices** (2026-11-03, from the providers' docs re-read for the phase):
   - The job's id is its call's record id. The record is written first (outcome `pending`,
     with `jobId`), then `AiJobs/{id}`; a job that cannot be kept marks its record
     `unavailable`. Times are written as dates; the job's fields never hold `undefined`.
   - `checkAiJobs` reads every pending job (up to 500), asks the 25 longest waiting, holds each
     with a token for 10 minutes (more than a check may run), and ends a job in a transaction
     only while it still holds it, before touching the record, the totals or the allowance: a
     check stopped part-way leaves the totals short rather than counted twice. `onJobDone` is
     held the same way and should cope with running twice.
   - A job past its time is asked once more; still running, it fails with `timeout` and keeps
     its allowance (the provider may bill it). A key refused on a check keeps the job running
     until its time, since a rotated key says nothing of the job.
   - Gemini Omni Flash is started with `background: true`; one the start answers at once is
     still a job, ended by the next check (its GET answers the video inline). 480p is its 360p.
     No duration is sent: Google's docs give no format for it, and Omni bills tokens.
   - Kling on its current API standard only (API key, `/text-to-video/{model}`, `/tasks`), its
     `billing[]` used as the cost when in USD. Its balance is the units left of packs in use.
   - MiniMax H3 on `/v2` (its `/v1` takes only Hailuo models), offered without sound.
   - HeyGen v3: each look speaks in its own default voice (no voice is sent); its At once
     limits starts, not renders, so a start over HeyGen's 10 renders answers busy. Prices: the
     higher of its own figures, $0.0805, $0.12 and $0.0167 a second for Avatar IV, V and III.
   - `AskAiResult`'s `pending` variant names the other fields as always empty, so code written
     before jobs type-checks; the docs tell apps to check `r.ok === true` before `r.files`.
9. **AM5 choices** (2026-11-03, from ElevenLabs' docs re-read for the phase):
   - `eleven_text_to_sound_v3` is sent explicitly (v2 is deprecated, gone 2027-03-01) and
     `music_v2_5` recommended (`music_v1` goes 2027-01-31). Music is capped at 5 minutes, the
     shorter of ElevenLabs' pages; its API takes no WAV, so music is MP3 only.
   - `audio.type` (`sound` or `music`) on a purpose keeps a sound purpose from a music model and
     back; `instrumental` asks for no vocals. A loop goes only to a sound model.
   - Music is made in the call: a piece whose length plus 30 seconds is more than the purpose's
     `timeoutSeconds` skips the model with the time to set, rather than timing out after it is
     billed. No job is used.
   - Prices: $0.12 and $0.15 a minute ($0.002 and $0.0025 a second), counted by the seconds
     made (the file's own length when it can be read, else the length asked). ElevenLabs' pages
     also say "billed per generation"; settled on first real use (AM-D34).
   - `bad_prompt` (music naming an artist or known lyrics) is `blocked`, with ElevenLabs'
     suggested prompt in the detail; a plan without music (`subscription_required`) is `off`,
     never a refused key. Both `detail.code` and the older `detail.status` are read.
   - From the AM5 review: a purpose's `audio.type` is its own (a call cannot change it) and is
     `sound` when left out; music also skips a model when the time left after a slower model
     cannot cover it; `allowanceIn: 'seconds'` counts 10 seconds when none are asked and gives
     back seconds not made; the estimate uses a model of the purpose's type; `music_v2_5` is
     recommended, so "Use recommended models" fills the Audio list with both.

