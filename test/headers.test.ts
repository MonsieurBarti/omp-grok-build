import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";

import { canonicalCliVersion, PINNED_CLI_VERSION, readCliVersionFile, resolveCliVersion } from "../src/fingerprint.ts";
import { buildChatHeaders, buildStaticHeaders, lowerHeaders } from "../src/headers.ts";
import { resetGrokSessionState } from "../src/session.ts";
import { prepareGrokBuildCall } from "../src/stream.ts";
import { mergeServerModels, toProviderModel, mergeModel } from "../src/models.ts";
import { jwt } from "./helpers.ts";

const ctx = { version: "1.2.3", platform: "darwin", arch: "arm64", mode: "interactive" };

describe("headers", () => {
	beforeEach(() => resetGrokSessionState());

	it("sends the CLI fingerprint and per-request ids", () => {
		let n = 0;
		const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
		const first = prepareGrokBuildCall(
			{ id: "grok-4.7", baseUrl: "https://api.x.ai/v1" },
			{ messages: [{ role: "user", content: "hi" }] },
			{ apiKey: "oauth-access-token", sessionId: "session-1", headers: { "X-XAI-Token-Auth": "nope" } },
			{ ...ctx, uuid },
		);
		assert.equal(first.model.baseUrl, "https://cli-chat-proxy.grok.com/v1");
		assert.equal(first.model.api, "openai-responses");
		assert.equal(first.model.compat?.connectionBoundNativeHistory, false);
		assert.equal(first.model.compat?.thinkingLoopGuard, "xai");
		assert.equal(first.model.compat?.promptCacheSessionHeader, "x-grok-conv-id");
		assert.equal(first.wire, "openai-responses");
		const headers = lowerHeaders(first.headers);
		assert.equal(headers["x-xai-token-auth"], "xai-grok-cli");
		assert.equal(headers["x-grok-client-identifier"], "grok-shell");
		assert.equal(headers["x-grok-client-version"], "1.2.3");
		assert.equal(headers["x-grok-client-mode"], "interactive");
		assert.equal(headers["x-authenticateresponse"], "authenticate-response");
		assert.equal(headers["user-agent"], "grok-shell/1.2.3 (macos; aarch64)");
		assert.equal(headers["x-grok-session-id"], "session-1");
		assert.equal(headers["x-grok-conv-id"], "session-1");
		assert.equal(headers["x-grok-req-id"], "00000000-0000-4000-8000-000000000001");
		assert.equal(headers["x-grok-agent-id"], "00000000-0000-4000-8000-000000000002");
		assert.equal(headers["x-grok-turn-idx"], "1");
		assert.equal(headers["x-grok-model-override"], "grok-4.7");
		assert.equal(headers.authorization, "Bearer oauth-access-token");
		assert.equal(headers["x-grok-conv-group-id"], "00000000-0000-4000-8000-000000000003");
		assert.equal(headers["x-grok-doom-loop-check"], "1024");
		assert.equal(headers["x-grok-exact-repetition-check"], "64");
		assert.match(headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
		assert.equal(headers["x-grok-user-id"], undefined);

		const second = prepareGrokBuildCall(
			{ id: "grok-4.7" },
			{ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }, { role: "user", content: "next" }] },
			{ apiKey: "oauth-access-token", sessionId: "session-1" },
			{ ...ctx, uuid },
		);
		const again = lowerHeaders(second.headers);
		assert.notEqual(again["x-grok-req-id"], headers["x-grok-req-id"]);
		assert.equal(again["x-grok-agent-id"], headers["x-grok-agent-id"]);
		assert.equal(again["x-grok-session-id"], "session-1");
		assert.equal(again["x-grok-turn-idx"], "2");
		assert.equal(again["x-grok-conv-group-id"], headers["x-grok-conv-group-id"]);
		assert.notEqual(again.traceparent, headers.traceparent);
	});

	it("sends the account id as x-grok-user-id and the model's compaction headers", () => {
		const catalog = toProviderModel(mergeModel("grok-4.7"));
		const prepared = prepareGrokBuildCall(
			catalog,
			{ messages: [{ role: "user", content: "hi" }] },
			{ apiKey: jwt({ principal_id: "acct-from-token", sub: "sub-a" }), sessionId: "s" },
			ctx,
		);
		const headers = lowerHeaders(prepared.headers);
		assert.equal(headers["x-grok-user-id"], "acct-from-token");
		assert.equal(headers["x-compactions-remaining"], "1");
		assert.equal(headers["x-compaction-at"], "204800");

		const emailLike = prepareGrokBuildCall(
			{ id: "grok-4.7" },
			{ messages: [{ role: "user", content: "hi" }] },
			{ apiKey: jwt({ principal_id: "person@example.com" }), sessionId: "s2" },
			ctx,
		);
		assert.equal(lowerHeaders(emailLike.headers)["x-grok-user-id"], undefined);
	});

	it("uses chat completions only when that model's wire says so", () => {
		mergeServerModels([{ id: "custom-chat", api_backend: "chat_completions" }]);
		const prepared = prepareGrokBuildCall(
			{ id: "custom-chat" },
			{ messages: [{ role: "user", content: "hi" }] },
			{ apiKey: "oauth-access-token", sessionId: "s" },
			ctx,
		);
		assert.equal(prepared.wire, "openai-completions");
		assert.equal(prepared.model.api, "openai-completions");
		assert.equal(prepared.model.baseUrl, "https://cli-chat-proxy.grok.com/v1");
	});

	it("resolves the CLI version from the env, then the version file, then the pin", () => {
		assert.equal(canonicalCliVersion("1.0.46-beta.1"), "1.0.46");
		assert.equal(canonicalCliVersion("nope"), undefined);
		const dir = mkdtempSync(join(tmpdir(), "grok-ver-"));
		const file = join(dir, "version.json");
		writeFileSync(file, JSON.stringify({ version: "9.9.9-open", stable_version: "1.0.1" }));
		assert.equal(readCliVersionFile(file), "9.9.9");
		assert.equal(
			resolveCliVersion({ env: { GROK_CLI_VERSION: "3.2.1" }, versionFile: file, pinned: "1.0.46" }),
			"3.2.1",
		);
		assert.equal(resolveCliVersion({ env: {}, versionFile: file, pinned: "1.0.46" }), "9.9.9");
		assert.equal(
			resolveCliVersion({ env: {}, versionFile: join(dir, "missing.json"), pinned: "1.0.46" }),
			"1.0.46",
		);
		assert.equal(PINNED_CLI_VERSION, "1.0.52");
		assert.equal(
			resolveCliVersion({ env: {}, versionFile: join(dir, "missing.json") }),
			"1.0.52",
		);
	});

	it("static headers stay free of api.x.ai", () => {
		const headers = buildStaticHeaders(ctx);
		assert.equal(JSON.stringify(headers).includes("api.x.ai"), false);
		assert.equal(buildChatHeaders({
			...ctx,
			accessToken: "token",
			sessionId: "s",
			requestId: "r",
			turnIndex: 1,
			modelId: "grok-4.7",
		})["X-XAI-Token-Auth"], "xai-grok-cli");
	});
});
