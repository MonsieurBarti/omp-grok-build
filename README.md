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

The entry is `package.json#omp.extensions` (`./src/index.ts`). omp loads that file. `@oh-my-pi/pi-ai` and `@oh-my-pi/pi-coding-agent` come from omp; they are optional peer dependencies so this repo's tests can run without them.

Do not set `providers.grok-build.apiKey` in `models.yml`. An api key there is the API-quota credential. This plugin will refuse a value that is `XAI_API_KEY` or an `xai-…` API key, and it will not send traffic to `api.x.ai`.

## Use

```text
/login
→ Grok Build
→ device
```

The prompt accepts `device` (default), `pkce`, or `import`.

| Method | What it does |
|---|---|
| `device` | RFC 8628 device code against `https://auth.x.ai/oauth2/device/code`. Works over SSH. |
| `pkce` | Authorization code + S256 PKCE. Listens on `127.0.0.1` port 0 `/callback`. Paste the redirect URL if the browser does not come back. |
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

Signed out, or if `/v1/models` fails, the picker shows the table in `src/model-metadata.ts`. Signed in, omp calls `fetchDynamicModels` (its usual ~24h cache; `omp models refresh` forces it). The live list is the set of ids. Metadata is merged in this order:

1. Exact table row, else a family prefix (`grok-4.7-nightly` follows `grok-4.7`), else conservative defaults.
2. Any field the server actually returns wins: context, max output, modalities, reasoning efforts, wire API.

Conservative defaults for an id that matches nothing: 128k context, 16k max output, text only, no thinking. Max output is never copied from the context window unless the server explicitly sets both. `grok-4.7` in the table is 500k context, images, thinking `low` / `medium` / `high` / `xhigh`, max output 128k, Responses API.

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

The version prefers `GROK_CLI_VERSION`, then `~/.grok/version.json`, then the pin. See [capture/README.md](capture/README.md) for the macOS mitmproxy steps and `npm run diff-trace`.

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
src/stream.ts            per-request headers, then omp's Responses transport
src/usage.ts             weekly Build credits
capture/diff-trace.ts    HAR or JSON diff
```
