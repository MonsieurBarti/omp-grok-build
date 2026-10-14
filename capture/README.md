# Capture the official Grok Build CLI

The plugin's chat fingerprint lives in `src/fingerprint.ts`. The version it sends is, in order:

1. `GROK_CLI_VERSION`
2. `~/.grok/version.json` (`version`, else `stable_version`)
3. `PINNED_CLI_VERSION` in `src/fingerprint.ts`

Header **names** and the non-version values (`x-grok-client-identifier`, `X-XAI-Token-Auth`, user-agent template, whether `x-grok-agent-id` is sent) are the constants in that file. After you capture one real CLI turn, diff it and edit the file so the plugin matches your binary.

This machine confirmed, without a token, on 2026-10-14:

- `GET https://auth.x.ai/.well-known/openid-configuration` lists the device-code and authorization-code grants, S256, and `grok-cli:access`.
- `GET https://cli-chat-proxy.grok.com/v1/models`, `POST /v1/responses`, `POST /v1/chat/completions`, and `GET /v1/billing?format=credits` all exist (401, not 404).
- The 401 body echoes `x_xai_token_auth`. With no header it is `none`. With `X-XAI-Token-Auth: xai-grok-cli` it is `xai-grok-cli`.

That does **not** prove the rest of the header set. A capture from your Mac does.

## 1. Record one chat turn on macOS

Install mitmproxy if you do not already have it:

```bash
brew install mitmproxy
```

Start it on an uncommon port:

```bash
mitmweb --listen-port 8089
```

Trust the CA. mitmproxy writes it to `~/.mitmproxy/mitmproxy-ca-cert.pem` the first time it runs.

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  "$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
```

The official `grok` binary is not Node. `NODE_EXTRA_CA_CERTS` does nothing for it. Point the process at the proxy and at the mitm CA, then open a normal interactive session and send one short prompt (and, if you want usage headers too, whatever the CLI uses to show credits).

```bash
export HTTPS_PROXY=http://127.0.0.1:8089
export HTTP_PROXY=http://127.0.0.1:8089
export SSL_CERT_FILE="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"
export NODE_EXTRA_CA_CERTS="$SSL_CERT_FILE"
grok
```

`NODE_EXTRA_CA_CERTS` is there for a Node build of the CLI. The current binary is Rust. On macOS its TLS stack uses the **Keychain** trust store, which is why the `security add-trusted-cert` step is the one that matters. `SSL_CERT_FILE` covers builds that use OpenSSL or rustls with the webpki env override.

In mitmweb, select the `cli-chat-proxy.grok.com` request whose path is `/v1/responses` (or `/v1/chat/completions` if that is what your build still posts). Export the flow as HAR:

- mitmweb: File → Save, or the flow menu → Export → HAR
- mitmproxy: focus the flow, then `:export.file @focus grok-cli.har`

Save it outside the repo or as `capture/local-grok.har` (gitignored).

### If the CLI ignores the proxy

Some builds do not read `HTTPS_PROXY`. Try, in this order:

1. `grok`'s own debug log, if the build has one. Run `grok --help` and look for `--debug`, `-v`, or `RUST_LOG`. A useful starting point:

   ```bash
   RUST_LOG=debug grok 2>grok-debug.log
   ```

   Search the log for `x-grok-` and `cli-chat-proxy`.

2. Confirm the installed version the plugin will copy automatically:

   ```bash
   cat ~/.grok/version.json
   ```

   If that file exists, you do not need to edit `PINNED_CLI_VERSION` unless the proxy still returns HTTP 426.

3. Force the version the plugin sends while you compare:

   ```bash
   export GROK_CLI_VERSION="$(jq -r '.version // .stable_version' ~/.grok/version.json)"
   ```

Do not send the capture's `Authorization` value anywhere. The diff tool redacts it.

## 2. Diff the capture against this plugin

From the plugin repo:

```bash
npm run diff-trace -- capture/local-grok.har
```

Exit code 0 means every static fingerprint value matches and the per-request ids (`x-grok-session-id`, `x-grok-conv-id`, `x-grok-req-id`, `x-grok-turn-idx`, `x-grok-model-override`, and `x-grok-agent-id` when enabled) are present.

Exit code 1 prints lines like:

```text
value     x-grok-client-version
  plugin  1.0.52
  capture 1.0.53
extra     x-grok-deployment-id  (capture has this, plugin does not send it)
```

## 3. Update the plugin from that diff

| Diff | Edit |
|---|---|
| `x-grok-client-version` | Prefer `~/.grok/version.json` or `GROK_CLI_VERSION`. Change `PINNED_CLI_VERSION` only for machines that do not have the CLI installed. |
| `user-agent` | `userAgentTemplate` in `src/fingerprint.ts`. Placeholders: `{version}`, `{os}`, `{arch}`. `darwin` is sent as `macos`, `arm64` as `aarch64`. |
| `x-grok-client-identifier`, `X-XAI-Token-Auth`, `x-authenticateresponse`, `x-grok-client-mode` | The matching fields in `CLI_FINGERPRINT`. |
| `extra x-grok-agent-id` missing from the capture | Set `sendAgentId: false`. |
| capture shows conv id ≠ session id | Set `convIdEqualsSessionId: false`. The plugin then keeps a second stable id for `x-grok-conv-id`. |
| a model posts to `/v1/chat/completions` instead of `/v1/responses` | Set that row's `wire` to `"openai-completions"` in `src/model-metadata.ts`. |
| context, max output, images, or thinking levels differ | Edit the row in `src/model-metadata.ts`. Server fields on `/v1/models` already override the table when they are present. |

Run `npm test` after the edit. The header tests pin a fake version, so they stay stable.
