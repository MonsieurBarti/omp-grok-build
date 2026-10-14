# omp-grok-build

Oh My Pi provider for **Grok Build**. Chat goes to the official CLI proxy (`https://cli-chat-proxy.grok.com/v1`) with the Grok CLI's OAuth client and request headers. It does not call `api.x.ai` and it does not read `XAI_API_KEY`.

| | |
|---|---|
| Provider id | `grok-build` |
| Login | `/login` → **Grok Build** |
| Wire | OpenAI Responses, per model (`openai-completions` only if that model says so) |
| Credentials | omp's credential store (`agent.db`), one row per account |
| Models | live `GET /v1/models`, merged with `src/model-metadata.ts` |

Stock `xai` / `xai-oauth` stay on the API path. This provider is the Build path from [oh-my-pi#4945](https://github.com/can1357/oh-my-pi/issues/4945) and [discussion #5092](https://github.com/can1357/oh-my-pi/discussions/5092).

## Install

```bash
omp plugin install github:MonsieurBarti/omp-grok-build
```

Local checkout:

```bash
omp plugin link .
```

The entry is `package.json#omp.extensions` (`./src/index.ts`). omp loads that file and rewrites the static `@oh-my-pi/pi-ai/providers/openai-responses` and `openai-completions` imports onto the host transports. Those imports have to be static literals; a runtime `import()` is not rewritten and cannot see the host packages from `~/.omp/plugins/node_modules`.

Do not set `providers.grok-build.apiKey` in `models.yml`. An api key there is the API-quota credential. This plugin will refuse a value that is `XAI_API_KEY` or an `xai-…` API key, and it will not send traffic to `api.x.ai`.

## Use

```text
/login
→ Grok Build
→ (empty, browser PKCE)
```

Pressing enter starts browser PKCE. The prompt also accepts `device` and `import`.

| Method | What it does |
|---|---|
| `pkce` | Default. Authorization code + S256 PKCE. Listens on `127.0.0.1` port 0 `/callback`. Paste the redirect URL if the browser does not come back. |
| `device` | RFC 8628 device code against `https://auth.x.ai/oauth2/device/code`. Works over SSH. |
| `import` | Reads `~/.grok/auth.json` and copies a refresh token into omp. Does not modify the CLI file. `/logout` in omp does not log the CLI out. |

Both login flows use the public Grok CLI client `b1a00492-073a-47ea-816f-4c329264a828` and the scope `openid profile email offline_access grok-cli:access api:access conversations:read conversations:write`. Refresh uses `grant_type=refresh_token` with that client and no secret. Each stored credential keeps `email` and `accountId` (`principal_id`, else `sub`), so a second `/login` with another xAI account is a second row in omp's store rather than an overwrite.

```text
/model grok-build/grok-4.7
/usage
/logout
```

`/usage` calls `GET /v1/billing?format=credits` on the CLI proxy and reports weekly credit percent plus per-product percents (Grok Build, API, …). omp shows it when this registration's `usage` provider is honored. API-key credentials are not queried.

Suggested config:

```yaml
disabledProviders:
  - xai-oauth
modelProviderOrder:
  - grok-build
modelRoles:
  default: grok-build/grok-4.7
```

## Models

The curated ids are registered when the extension loads, so `retry.fallbackChains` can name `grok-build/grok-4.7` (and `grok-build/grok-4.7:high`) before live discovery finishes. The stub for a model that lists a larger window also carries `maxContextWindow`. Context, thinking, and price still come from the table and from `/v1/models`.

Signed out, or if `/v1/models` fails, the picker shows the table in `src/model-metadata.ts`. Signed in, omp calls `fetchDynamicModels` (its usual ~24h cache; `omp models refresh` forces it). The curated rows stay. A live id updates the matching row and unknown ids are appended.

The grok CLI 1.0.52 cache of `GET /v1/models` is a map, `models[id].info`, not an OpenAI `{data:[]}` list. The parser accepts both. For the four models in that cache (grok-4.7, grok-4.7-build-fast, grok-4.6, grok-4.5):

- `context_window` is the active window the CLI puts on the session (`256000`).
- `context_windows` is the option list (`256000` and `500000`). The plugin sets `contextWindow` to the active value and `maxContextWindow` to the larger option. omp 18.10.4 uses `maxContextWindow` on the startup overlay as the extended-context tier.
- `reasoning_efforts` is a list of `{id, value, label, default}` objects. The `default: true` entry is the level (`high`). grok-4.5 stops at `high`. grok-4.6 and grok-4.7 include `xhigh`.
- `api_backend: "responses"` selects the Responses wire. `auth_scheme: "bearer"` is the OAuth access token.
- `extra_headers` on a row are merged onto that model. They cannot replace `Authorization` or the CLI fingerprint.
- `max_completion_tokens: null` means the request omits the output cap (`omitMaxOutputTokens`). `maxTokens` stays `128000` because omp requires a number. That figure is the local budget, not a server field.
- `auto_compact_threshold_percent: 80` and `compactions_remaining: 1` become `x-compaction-at` (`204800` at the 256k window) and `x-compactions-remaining`.

A bare generic window (`128000`, `131072`, `256000`, `262144`) with no `context_windows`, `context_length` / `max_model_len`, bare `max_tokens`, and a singular `reasoning_effort` (or a one-element `["high"]`) do not replace the table. Hidden rows and `supported_in_api: false` are dropped.

Conservative defaults for an id that matches nothing: 128k context, 16k max output, text only, no thinking. Models the 1.0.52 cache omitted (grok-4.3, grok-4.20, grok-build, composer) stay on the curated table. List prices match docs.x.ai (`grok-4.7` is $2 / $6 / $0.50 per 1M; Fast is 2×, which the cache describes as "2x the price"). `grok-build` is the included SKU and shows cost 0. Prompts at or above 200k input tokens are 2× the base rate on the API; the picker shows the base rate.

Every model carries the omp 18.10.4 xAI Responses `compat` object (`connectionBoundNativeHistory: false`, `x-grok-conv-id`, no `reasoning.summary`, root anyOf/oneOf flattened). omp clears `compat` for the custom api `grok-build-cli`, so the stream path writes it back before the host transport runs. A request that gets no event for 60s, or no further event for 90s, fails instead of waiting out the host's 300s default. `GROK_BUILD_TIMEOUT_MS` (default 120000) is the overall abort. The 1.0.52 cache leaves `inference_idle_timeout_secs` null; the plugin timeouts stay so a stalled stream does not sit for five minutes.

Non-chat ids (image, embed, audio, video, tts) are dropped.

## Headers

Every proxy call sends the fingerprint in `src/fingerprint.ts`, plus a bearer token and per-turn ids:

- `X-XAI-Token-Auth: xai-grok-cli`
- `x-grok-client-identifier`, `x-grok-client-version`, `x-grok-client-mode`
- `x-authenticateresponse`
- `User-Agent` from `grok-shell/{version} ({os}; {arch})`
- `x-grok-session-id` and `x-grok-conv-id` (same id on the main chat path)
- a new `x-grok-req-id` per HTTP call, monotonic `x-grok-turn-idx`, `x-grok-model-override`
- `x-grok-agent-id` (stable per session; turn off in the fingerprint if your capture lacks it)
- `x-grok-conv-group-id` (one generated id for the process)
- `traceparent` (`00-{trace}-{span}-01`, a new value per request)
- `x-grok-user-id` when the access token's `principal_id` or `sub` is present and is not an email
- `x-grok-doom-loop-check: 1024` and `x-grok-exact-repetition-check: 64` on chat requests

The version prefers `GROK_CLI_VERSION`, then `~/.grok/version.json`, then the pin `1.0.52`. See [capture/README.md](capture/README.md) for the macOS mitmproxy steps and `npm run diff-trace`.

A 1.0.52 `grok --debug -p` log also shows a sampler connection warmup (`GET` the proxy origin, status 404), feedback and trace upload on the same origin, `content-encoding: zstd`, and `extra_response_includes: ["no_inline_citations"]`. This plugin does not send those. The warmup is a connection pool, telemetry stays off, and omp's transport posts uncompressed JSON. The default `x-grok-client-mode` stays `interactive` for the omp TUI. Set `GROK_CLIENT_MODE=headless` to match `grok -p`.

`GROK_BUILD_DEBUG=1` logs redacted request headers and the `/v1/models` body to stderr. `/grok-build-debug` prints whether that is on and the last models summary (ids, context, output, effort — no tokens).

## Develop

```bash
npm test
npm run diff-trace -- capture/local-grok.har
```

Tests cover device-code and PKCE token requests, refresh, multi-account identity, header ids, the refusal of `XAI_API_KEY` / `api.x.ai`, and the model merge. They do not call xAI.

```text
src/fingerprint.ts       header values — edit from a capture
src/model-metadata.ts    context, max output, thinking, images, wire API
src/oauth.ts             device code, PKCE, refresh, CLI import
src/models.ts            merge live /v1/models onto the table
src/stream.ts            per-request headers, compat, then omp's Responses transport
src/wire-compat.ts       omp 18.10.4 xAI Responses compat snapshot
src/usage.ts             weekly Build credits
capture/diff-trace.ts    HAR or JSON diff
test/fixtures/models-cache.json
                         grok CLI 1.0.52 `/v1/models` cache, identity and etag removed
```

## For omp maintainers

`grok-build` is a third-party provider for the Grok Build CLI proxy. It is not a second registration of `xai` or `xai-oauth`, and it never calls `api.x.ai`.

- Install: `omp plugin install github:MonsieurBarti/omp-grok-build`.
- Entry: `package.json#omp.extensions` → `./src/index.ts`. The OpenAI Responses and Chat Completions transports are static imports of `@oh-my-pi/pi-ai/...` so the extension loader can rewrite them onto the host. A runtime `import()` fails validation from `~/.omp/plugins/node_modules`.
- `pi.registerProvider("grok-build", …)` uses a custom api, `grok-build-cli`, so `streamSimple` runs and can attach the CLI headers. The stream function then sets `model.api` to `openai-responses` (or `openai-completions` when that model's `api_backend` says so) and writes the omp 18.10.4 xAI `compat` object back onto the model. The host clears `compat` for an unknown api, and `streamOpenAIResponses` reads `compat.connectionBoundNativeHistory`.
- `models` is the curated id list, registered before `fetchDynamicModels`, so `retry.fallbackChains` can name `grok-build/grok-4.7` at startup. Those stubs omit `contextWindow` and `thinking`. They include `maxContextWindow` (500000) for the four models whose CLI cache lists that option, which omp applies as the extended-context tier. Live discovery is authoritative for the active window.
- Wire source for model fields and the version pin is a logged-in grok CLI 1.0.52 `GET /v1/models` cache plus one `grok --debug -p` session. The fixture is `test/fixtures/models-cache.json`.
- Login is browser PKCE by default (`device` and `~/.grok/auth.json` import remain), using the public CLI client. Credentials stay in omp's store. There is no `apiKey` field on the provider.
