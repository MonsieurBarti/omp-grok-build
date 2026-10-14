import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { jwt } from "./helpers.ts";
import { prepareGrokBuildCall, requestTimeoutMs, streamGrokBuild } from "../src/stream.ts";

describe("responses compat", () => {
	it("attaches a full xAI compat object when the registry model has none", () => {
		const registered: { id: string; compat?: Record<string, unknown> } = { id: "grok-build/grok-4.7" };
		const prepared = prepareGrokBuildCall(
			registered,
			{ messages: [{ role: "user", content: "hi" }] },
			{ apiKey: jwt({ sub: "acct" }), sessionId: "s" },
			{ version: "1.2.3", platform: "linux", arch: "x64" },
		);
		assert.equal(prepared.model.api, "openai-responses");
		assert.equal(prepared.model.compat?.connectionBoundNativeHistory, false);
		assert.equal(prepared.model.compat?.storeResponses, false);
		assert.equal(prepared.model.compat?.officialEndpoint, false);
		assert.equal(prepared.model.compat?.rejectRootObjectUnion, true);
		assert.equal(prepared.model.compat?.supportsReasoningSummary, false);
		assert.equal(prepared.model.compat?.includeEncryptedReasoning, true);
		assert.equal(prepared.model.compat?.thinkingLoopGuard, "xai");
		assert.equal(prepared.model.compat?.promptCacheSessionHeader, "x-grok-conv-id");
		assert.equal(prepared.model.compat?.streamFirstEventTimeoutMs, 60_000);
		assert.equal(prepared.model.compat?.streamIdleTimeoutMs, 90_000);
		assert.equal(registered.compat?.connectionBoundNativeHistory, false);
		assert.equal(prepared.options.streamFirstEventTimeoutMs, 60_000);
	});

	it("hands that compat to the transport", () => {
		let seen: unknown;
		streamGrokBuild(
			{ id: "grok-4.7" },
			{ messages: [{ role: "user", content: "hi" }] },
			{ apiKey: jwt({ sub: "acct" }) },
			{
				responses: model => {
					seen = model.compat;
					return { finalResultPromise: Promise.resolve("ok") };
				},
				completions: () => {
					throw new Error("completions");
				},
			},
			{ version: "1.2.3" },
		);
		assert.equal((seen as { connectionBoundNativeHistory?: boolean }).connectionBoundNativeHistory, false);
	});

	it("aborts a stalled request with a proxy timeout", async () => {
		const previous = process.env.GROK_BUILD_TIMEOUT_MS;
		process.env.GROK_BUILD_TIMEOUT_MS = "50";
		try {
			assert.equal(requestTimeoutMs(), 50);
			const stream = streamGrokBuild(
				{ id: "grok-4.7" },
				{ messages: [{ role: "user", content: "hi" }] },
				{ apiKey: jwt({ sub: "acct" }) },
				{
					responses: (_model, _context, options) => ({
						finalResultPromise: new Promise((_resolve, reject) => {
							const fail = () => {
								const reason = options.signal?.reason;
								reject(reason instanceof Error ? reason : new Error(String(reason)));
							};
							if (options.signal?.aborted) fail();
							else options.signal?.addEventListener("abort", fail, { once: true });
						}),
					}),
					completions: () => {
						throw new Error("completions");
					},
				},
				{ version: "1.2.3" },
			) as { finalResultPromise: Promise<unknown> };
			await assert.rejects(
				stream.finalResultPromise,
				/grok-build request to cli-chat-proxy\.grok\.com timed out after 50ms[\s\S]*GROK_BUILD_TIMEOUT_MS/,
			);
		} finally {
			if (previous === undefined) delete process.env.GROK_BUILD_TIMEOUT_MS;
			else process.env.GROK_BUILD_TIMEOUT_MS = previous;
		}
	});
});
