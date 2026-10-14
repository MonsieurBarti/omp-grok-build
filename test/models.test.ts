import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { discoverModels } from "../src/discovery.ts";
import { MODELS_URL } from "../src/constants.ts";
import {
	mergeModel,
	mergeServerModels,
	seedModels,
	toProviderModel,
} from "../src/models.ts";
import { jsonResponse, jwt } from "./helpers.ts";

describe("model metadata", () => {
	it("gives grok-4.7 a 500k window, images, thinking levels, and a separate output cap", () => {
		const model = toProviderModel(mergeModel("grok-4.7"));
		assert.equal(model.contextWindow, 500_000);
		assert.equal(model.maxTokens, 128_000);
		assert.notEqual(model.maxTokens, model.contextWindow);
		assert.deepEqual(model.input, ["text", "image"]);
		assert.equal(model.reasoning, true);
		assert.deepEqual(model.thinking?.efforts, ["low", "medium", "high", "xhigh"]);
		assert.equal(model.thinking?.defaultLevel, "high");
		assert.equal(model.compat.supportsReasoningEffort, true);
		assert.equal(model.compat.connectionBoundNativeHistory, false);
		assert.equal(model.compat.supportsReasoningSummary, false);
		assert.equal(model.compat.rejectRootObjectUnion, true);
		assert.equal(model.compat.supportsPenaltyAndStopParams, false);
		assert.equal(model.compat.thinkingLoopGuard, "xai");
		assert.equal(model.compat.promptCacheSessionHeader, "x-grok-conv-id");
		assert.equal(model.compat.omitReasoningEffort, false);
		assert.deepEqual(model.compat.reasoningEffortMap, { minimal: "low" });
	});

	it("does not copy the 128k / no-thinking / no-image / max-equals-context fallback onto a 4.7 variant", () => {
		const model = toProviderModel(mergeModel("grok-4.7-nightly"));
		assert.equal(model.contextWindow, 500_000);
		assert.equal(model.maxTokens, 128_000);
		assert.ok(model.input.includes("image"));
		assert.deepEqual(model.thinking?.efforts, ["low", "medium", "high", "xhigh"]);
		assert.equal(toProviderModel(mergeModel("grok-4.5")).compat.reasoningEffortMap.xhigh, "high");
		assert.equal(toProviderModel(mergeModel("grok-build")).compat.omitReasoningEffort, true);
		assert.equal(toProviderModel(mergeModel("grok-build")).cost.input, 0);
	});

	it("uses conservative defaults for an unknown id", () => {
		const model = toProviderModel(mergeModel("not-a-grok"));
		assert.equal(model.contextWindow, 128_000);
		assert.equal(model.maxTokens, 16_384);
		assert.ok(model.maxTokens < model.contextWindow);
		assert.deepEqual(model.input, ["text"]);
		assert.equal(model.reasoning, false);
		assert.equal(model.thinking, undefined);
		assert.equal(model.compat.supportsReasoningEffort, false);
		assert.equal(model.compat.omitReasoningEffort, true);
		assert.equal(model.compat.connectionBoundNativeHistory, false);
	});

	it("prefers metadata the server actually returns", () => {
		const overridden = toProviderModel(
			mergeModel("grok-4.7", {
				id: "grok-4.7",
				context_window: 1_000_000,
				max_output_tokens: 64_000,
				input_modalities: ["text"],
				reasoning_efforts: ["low", "high"],
				api_backend: "responses",
			}),
		);
		assert.equal(overridden.contextWindow, 1_000_000);
		assert.equal(overridden.maxTokens, 64_000);
		assert.deepEqual(overridden.input, ["text"]);
		assert.deepEqual(overridden.thinking?.efforts, ["low", "high"]);

		const explicitEqual = toProviderModel(
			mergeModel("not-a-grok", {
				context_window: 32_000,
				max_output_tokens: 32_000,
			}),
		);
		assert.equal(explicitEqual.maxTokens, 32_000);

		const genericWindow = toProviderModel(
			mergeModel("grok-4.7", { context_window: 128_000, context_length: 256_000, reasoning_effort: "high" }),
		);
		assert.equal(genericWindow.contextWindow, 500_000);
		assert.deepEqual(genericWindow.thinking?.efforts, ["low", "medium", "high", "xhigh"]);
		assert.ok(genericWindow.input.includes("image"));

		const bareMaxTokens = toProviderModel(mergeModel("grok-4.7", { max_tokens: 256_000 }));
		assert.equal(bareMaxTokens.maxTokens, 128_000);
	});

	it("keeps chat models from a live list and drops non-chat ids", () => {
		const models = mergeServerModels([
			{ id: "grok-4.7", object: "model" },
			{ id: "grok-imagine-1", object: "model" },
			{ id: "text-embedding-3", object: "model" },
			{ id: "grok-4.7", object: "model", name: "duplicate" },
			{ id: "voice-only", object: "model", output_modalities: ["audio"] },
			{ id: "grok-composer-2.5-fast" },
		]);
		assert.deepEqual(
			models.map(model => model.id),
			seedModels().map(model => model.id),
		);
		const grok = models[0];
		assert.equal(grok?.contextWindow, 500_000);
		assert.ok(grok?.input.includes("image"));
		assert.equal(seedModels().some(model => model.id === "grok-4.7"), true);
		for (const model of seedModels()) {
			assert.ok(model.maxTokens < model.contextWindow, model.id);
		}
	});

	it("discovers live models with the CLI proxy and falls back to the seed", async () => {
		let called = false;
		const loggedOut = await discoverModels(undefined, async () => {
			called = true;
			throw new Error("should not fetch");
		});
		assert.equal(called, false);
		assert.equal(loggedOut.some(model => model.id === "grok-4.7"), true);

		const access = jwt({ sub: "acct" });
		const urls: string[] = [];
		const live = await discoverModels(access, async (input, init) => {
			urls.push(String(input));
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("x-xai-token-auth"), "xai-grok-cli");
			assert.equal(headers.get("authorization"), `Bearer ${access}`);
			return jsonResponse({
				data: [
					{ id: "grok-4.7", context_window: 500000, max_output_tokens: 128000 },
					{ id: "brand-new-model" },
				],
			});
		}, { version: "1.2.3", platform: "linux", arch: "x64" });
		assert.deepEqual(urls, [MODELS_URL]);
		assert.equal(urls.some(url => url.includes("api.x.ai")), false);
		assert.equal(live.find(model => model.id === "grok-4.7")?.contextWindow, 500_000);
		const unknown = live.find(model => model.id === "brand-new-model");
		assert.equal(unknown?.maxTokens, 16_384);
		assert.deepEqual(unknown?.input, ["text"]);
		assert.equal(unknown?.reasoning, false);
		assert.equal(live.some(model => model.id === "grok-4.3"), true);
		assert.equal(live.find(model => model.id === "grok-4.7")?.compat.connectionBoundNativeHistory, false);

		const generic = await discoverModels(access, async () =>
			jsonResponse({
				data: ["grok-4.5", "grok-4.6", "grok-4.7", "grok-4.7-build-fast"].map(id => ({
					id,
					context_window: 256_000,
					max_output_tokens: 128_000,
					reasoning_effort: "high",
					reasoning_efforts: ["high"],
					input_modalities: ["text", "image"],
				})),
			}),
		);
		const grok47 = generic.find(model => model.id === "grok-4.7");
		assert.equal(grok47?.contextWindow, 500_000);
		assert.deepEqual(grok47?.thinking?.efforts, ["low", "medium", "high", "xhigh"]);
		assert.equal(generic.some(model => model.id === "grok-4.3"), true);
		const fast = generic.find(model => model.id === "grok-4.7-build-fast");
		assert.equal(fast?.cost.input, 4);
		assert.equal(fast?.cost.output, 12);

		const fallback = await discoverModels(access, async () => jsonResponse({ error: "no" }, 503));
		assert.equal(fallback.some(model => model.id === "grok-4.6"), true);
	});
});
