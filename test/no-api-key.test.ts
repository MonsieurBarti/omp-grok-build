import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { assertOAuthAccessToken } from "../src/auth-guard.ts";
import { FORBIDDEN_API_KEY_ENV, GROK_BUILD_BASE_URL, PROVIDER_ID } from "../src/constants.ts";
import { createGrokBuildProviderConfig, providerHasNoApiKeyFallback } from "../src/provider.ts";
import { prepareGrokBuildCall } from "../src/stream.ts";
import { resetGrokSessionState } from "../src/session.ts";

const previous = process.env[FORBIDDEN_API_KEY_ENV];

afterEach(() => {
	if (previous === undefined) delete process.env[FORBIDDEN_API_KEY_ENV];
	else process.env[FORBIDDEN_API_KEY_ENV] = previous;
	resetGrokSessionState();
});

describe("no API-key fallback", () => {
	it("does not register an apiKey or an api.x.ai base URL", () => {
		const config = createGrokBuildProviderConfig({
			transports: {
				responses: () => "responses",
				completions: () => "completions",
			},
			headerCtx: { version: "1.2.3", platform: "linux", arch: "x64" },
		});
		assert.equal(providerHasNoApiKeyFallback(config), true);
		assert.deepEqual(
			config.models.map(model => model.id),
			[
				"grok-4.7",
				"grok-4.7-build-fast",
				"grok-4.6",
				"grok-4.5",
				"grok-4.3",
				"grok-4.20-multi-agent-0309",
				"grok-4.20-0309-reasoning",
				"grok-4.20-0309-non-reasoning",
				"grok-build",
				"grok-composer-2.5-fast",
			],
		);
		for (const model of config.models) {
			assert.equal("contextWindow" in model, false, model.id);
			assert.equal("thinking" in model, false, model.id);
		}
		assert.equal(typeof config.fetchDynamicModels, "function");
		assert.equal("apiKey" in config, false);
		assert.equal(config.baseUrl, GROK_BUILD_BASE_URL);
		assert.equal(JSON.stringify(config.headers).includes("api.x.ai"), false);
		assert.equal(JSON.stringify(config.oauth).includes(FORBIDDEN_API_KEY_ENV), false);
		assert.throws(() => config.oauth.getApiKey({ access: "", refresh: "r", expires: 1 }));
		assert.throws(() => config.oauth.getApiKey({ access: "xai-live-key", refresh: "r", expires: 1 }));
	});

	it("refuses XAI_API_KEY and xai- API keys on the request path", () => {
		process.env[FORBIDDEN_API_KEY_ENV] = "xai-from-env";
		assert.throws(() => assertOAuthAccessToken(undefined), /XAI_API_KEY is not used/);
		assert.throws(() => assertOAuthAccessToken("XAI_API_KEY"), /literal XAI_API_KEY/);
		assert.throws(() => assertOAuthAccessToken("xai-from-env"), /refused XAI_API_KEY/);
		assert.throws(() => assertOAuthAccessToken("xai-another-key"), /refused an xAI API key/);
		assert.equal(assertOAuthAccessToken("oauth-access-token"), "oauth-access-token");

		assert.throws(
			() =>
				prepareGrokBuildCall(
					{ id: "grok-4.7", baseUrl: "https://api.x.ai/v1" },
					{ messages: [{ role: "user", content: "hi" }] },
					{ apiKey: "xai-from-env", sessionId: "s" },
					{ version: "1.2.3" },
				),
			/refused XAI_API_KEY/,
		);

		const prepared = prepareGrokBuildCall(
			{ id: "grok-4.7", provider: "xai-oauth", baseUrl: "https://api.x.ai/v1" },
			{ messages: [{ role: "user", content: "hi" }] },
			{ apiKey: "oauth-access-token", sessionId: "s" },
			{ version: "1.2.3", platform: "linux", arch: "x64" },
		);
		assert.equal(prepared.model.provider, PROVIDER_ID);
		assert.equal(prepared.model.baseUrl, GROK_BUILD_BASE_URL);
		assert.equal(prepared.options.apiKey, "oauth-access-token");
	});
});
