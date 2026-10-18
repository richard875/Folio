---
name: xai-api
description: >
  Call the xAI API (Grok) from this app's server code using the injected
  XAI_API_KEY: chat/LLM features, image and video generation (Imagine), and
  voice (text-to-speech). Use when the app needs any "AI" / "assistant" /
  "chatbot" / "Grok" functionality, runtime image/video generation, or speech.
  Triggers on "AI", "LLM", "chatbot", "assistant", "Grok", "xAI", "generate
  text", "summarize", "generate image", "AI video", "voice", "text to speech",
  "TTS", "OpenAI" (use xAI instead).
metadata:
  short-description: "xAI API via the injected XAI_API_KEY: chat, Imagine (image/video), voice"
user-invocable: false
---

# xAI API (Grok)

**Optional recipe, not an active Folio feature.** Folio currently makes no runtime
xAI calls. See [reference scope](../../README.md). Render does not automatically
inject an xAI key; adding a paid API feature requires explicit scope and spend
authorization. Endpoint/model examples below must be checked against the current
[official documentation](https://docs.x.ai) before implementing them.

When `XAI_API_KEY` is present in the environment, this app has **real xAI API
access** — use it for AI features instead of mocking responses or reaching for
another provider, when that provider matches the requested feature. On Grok-managed
deployments a key may be injected; on Render configure secrets explicitly only
for an authorized feature. Local key presence does not establish deployed access.

**The key is the app owner's personal key: every call spends their quota and
credits.** Be deliberate about usage — see [Spend responsibly](#spend-responsibly)
before wiring AI calls into anything that runs automatically or is open to
visitors.

Depending on the account/key's permissions, the API can provide more than chat:

- **Chat / LLM** — choose an available model from the current official catalog;
  do not treat a model named in a template as the latest or universally accessible.
- **Imagine (images & video)** — generate and edit images, generate video,
  at runtime inside the app.
- **Voice** — text-to-speech with expressive voices (and transcription).
- **Official docs: [docs.x.ai](https://docs.x.ai)** — endpoints, models,
  parameters, streaming, tool use. Don't guess API shapes; check the docs.
- The API is **OpenAI-compatible** (`https://api.x.ai/v1`), so any
  OpenAI-style client works by switching the base URL and key.

## Env vars — do **not** create a `.env` file

| Var | Where | Purpose |
|---|---|---|
| `XAI_API_KEY` | server | May be injected by a supporting host; Render requires explicit authorized configuration. Never hardcode it or expose it to the browser. |
| `XAI_MODEL` | server | Example explicit model selection for the optional chat recipe; not a configured Folio variable. |

The key is **server-only**: read it with `process.env.XAI_API_KEY` inside
`createServerFn` handlers / server code, never in client components, and never
expose it via a `VITE_`-prefixed variable or an API response.

It can be **absent** (rollout-gated). Degrade gracefully — check for it and
show a friendly "AI features are unavailable" state instead of crashing:

```ts
const apiKey = process.env.XAI_API_KEY;
if (!apiKey) throw new Error("AI is not available in this environment");
```

## Calling the API (server-only)

No SDK needed — plain `fetch` from a server function:

```ts
import { createServerFn } from "@tanstack/react-start";

export const askGrok = createServerFn({ method: "POST" })
  .validator((input: { prompt: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    const model = process.env.XAI_MODEL;
    if (!apiKey || !model) return { ok: false as const, error: "AI is not configured" };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [{ role: "user", content: data.prompt }],
      }),
    });
    if (!res.ok) {
      return { ok: false as const, error: `xAI API error ${res.status}` };
    }
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return { ok: true as const, text: body.choices[0]?.message.content ?? "" };
  });
```

For streaming, structured outputs, vision, or the full model list, follow
[docs.x.ai](https://docs.x.ai) — the shapes are OpenAI-compatible.

## Imagine — image & video generation (server-only)

The same key drives **runtime** image/video features in the app (user avatars,
scene art, generated content). Distinct from your build-time `imagine_text_to_image` / `imagine_image_to_image` / `imagine_image_to_video` tools (the
`imagine-grok-build` skill): use the **API** when the *running app* generates media, the
tools when *you* create static assets while building.

```ts
// POST https://api.x.ai/v1/images/generations — same auth header as chat
body: JSON.stringify({
  model: "grok-imagine-image-quality", // or "grok-imagine-image" (cheaper)
  prompt: data.prompt,
  // n (≤10), resolution ("1k"|"2k"), response_format ("url"|"b64_json")
})
// → body.data[0].url
```

- **Image editing**: `POST /v1/images/edits` — natural-language edits, up to 3
  reference images.
- **Video**: `grok-imagine-video` via the async video endpoints (start, then
  poll the returned request id; clips up to ~15s).
- Full parameters and examples: [docs.x.ai](https://docs.x.ai) → Imagine API.

## Voice — text-to-speech (server-only)

`POST https://api.x.ai/v1/tts` turns text into spoken audio — narration,
accessibility, character voices:

```ts
// Same Authorization header; returns audio bytes (e.g. MP3)
body: JSON.stringify({ text: data.text, voice_id: "eve" }) // eve = default voice
```

List voices at `GET /v1/tts/voices` (custom voices supported); transcription
(speech-to-text) is also available. Details: [docs.x.ai](https://docs.x.ai) →
Voice API. Serve the audio to the client from your server function — never
call the API from the browser (that would expose the key).

Media model IDs, reference-image counts, duration/resolution limits and voice
names are illustrative, not checked Folio capabilities or a promise of current
service limits. Confirm them in the current API docs and validate responses.

## Spend responsibly

The key belongs to the **app owner** (the user you're building for): every
call — including ones triggered by anonymous visitors of the deployed app —
**spends their personal quota and credits**. Burning it on wasteful calls
degrades or breaks every other use of their key. Be careful with usage:

- **Cap output** (`max_tokens`) and keep prompts small for visitor-facing
  features. Image, and especially video, generation cost far more per call
  than chat.
- **Never call the API in a loop, on every keystroke, or on page load** —
  make calls user-initiated (button press, form submit) and debounce.
- **Cache or persist results** (see the `neon` skill) instead of regenerating
  the same content per visitor or per render.
- **Gate expensive flows** — media generation in particular. On an app that
  already has sign-in, put them behind `authMiddleware` (see the **`auth`
  skill**). Sign-in is off by default, and adding the middleware without it
  breaks the deployed app (AGENTS.md §0.5) — so on an app without accounts, cap
  usage instead: user-initiated calls, small limits, cached results.
- Don't add retry storms: on an API error, surface it; retry at most once.
