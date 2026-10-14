/**
 * Maintained Grok Build model metadata.
 *
 * A logged-in Grok CLI 1.0.52 cache of `GET /v1/models` (2026-10-14) is the
 * source for the four models that payload lists. `context_window` is the
 * active window (256k). `context_windows` also offers 500k. `reasoning_efforts`
 * is the ladder, and the entry with `default: true` is the default level.
 * `max_completion_tokens: null` means the CLI sends no output cap.
 * `maxTokens` below is omp's local budget, because the host requires a number.
 * Requests set `omitMaxOutputTokens` so that budget is not sent.
 *
 * Live `/v1/models` replaces those fields when the server sends them (see
 * src/models.ts). A bare generic window or a singular `reasoning_effort` does
 * not. Models the proxy omitted stay on this table.
 *
 * Prices are the public list rates (docs.x.ai). Prompts at or above 200k
 * input tokens are billed at 2x on the API. `grok-build` is the included SKU
 * and stays at 0. The picker shows the base rate. The cache describes Fast as
 * "2x the price."
 *
 * Sources, as of 2026-10-14:
 * - grok-4.7, grok-4.7-build-fast, grok-4.6, grok-4.5: CLI 1.0.52 models cache.
 * - grok-4.3 (1M) and grok-4.20 (2M) windows, and image input on composer /
 *   grok-build: CLI catalog notes. The 1.0.52 cache did not list them.
 * - grok-build and grok-4.20 reasoning SKUs think, but omp's own catalog treats
 *   them as having no reasoning.effort control. thinking is omitted on purpose.
 */

export type WireApi = "openai-responses" | "openai-completions";

export interface ThinkingMeta {
	mode: "effort";
	efforts: string[];
	defaultLevel: string;
}

export interface ModelCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface ModelMetadata {
	id: string;
	name: string;
	wire: WireApi;
	reasoning: boolean;
	supportsReasoningEffort: boolean;
	thinking?: ThinkingMeta;
	/** xhigh on a model that only has high is sent as high. */
	reasoningEffortMap?: Record<string, string>;
	input: ("text" | "image")[];
	/** Active window. The CLI's `context_window` (session totalContextTokens). */
	contextWindow: number;
	/** Larger option from `context_windows`, when the server lists one. */
	maxContextWindow?: number;
	/** Local omp budget. Not sent when `omitMaxOutputTokens` is set. */
	maxTokens: number;
	omitMaxOutputTokens?: boolean;
	extraHeaders?: Record<string, string>;
	compactionsRemaining?: number;
	autoCompactThresholdPercent?: number;
	cost: ModelCost;
}

const ZERO_WRITE = 0;

const xhigh: ThinkingMeta = {
	mode: "effort",
	efforts: ["low", "medium", "high", "xhigh"],
	defaultLevel: "high",
};

const highOnly: ThinkingMeta = {
	mode: "effort",
	efforts: ["low", "medium", "high"],
	defaultLevel: "high",
};

const frontierCost: ModelCost = { input: 2, output: 6, cacheRead: 0.5, cacheWrite: ZERO_WRITE };

/**
 * grok CLI 1.0.52 cache for the four listed chat models.
 * 128k maxTokens is the local omp budget. The server field is null.
 */
const cliListed = {
	contextWindow: 256_000,
	maxContextWindow: 500_000,
	maxTokens: 128_000,
	omitMaxOutputTokens: true,
	compactionsRemaining: 1,
	autoCompactThresholdPercent: 80,
} as const;
const fastCost: ModelCost = { input: 4, output: 12, cacheRead: 1, cacheWrite: ZERO_WRITE };
const legacyCost: ModelCost = { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: ZERO_WRITE };
const included: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function chat(partial: ModelMetadata): ModelMetadata {
	return partial;
}

export const MODEL_METADATA: readonly ModelMetadata[] = [
	chat({
		id: "grok-4.7",
		name: "Grok 4.7",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: true,
		thinking: xhigh,
		input: ["text", "image"],
		...cliListed,
		cost: frontierCost,
	}),
	chat({
		id: "grok-4.7-build-fast",
		name: "Grok 4.7 Fast",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: true,
		thinking: xhigh,
		input: ["text", "image"],
		...cliListed,
		cost: fastCost,
	}),
	chat({
		id: "grok-4.6",
		name: "Grok 4.6",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: true,
		thinking: xhigh,
		input: ["text", "image"],
		...cliListed,
		cost: frontierCost,
	}),
	chat({
		id: "grok-4.5",
		name: "Grok 4.5",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: true,
		thinking: highOnly,
		reasoningEffortMap: { xhigh: "high" },
		input: ["text", "image"],
		...cliListed,
		cost: frontierCost,
	}),
	chat({
		id: "grok-4.3",
		name: "Grok 4.3",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: true,
		thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "low" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: legacyCost,
	}),
	chat({
		id: "grok-4.20-multi-agent-0309",
		name: "Grok 4.20 Multi-Agent",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: true,
		thinking: xhigh,
		input: ["text", "image"],
		contextWindow: 2_000_000,
		maxTokens: 128_000,
		cost: legacyCost,
	}),
	chat({
		id: "grok-4.20-0309-reasoning",
		name: "Grok 4.20 Reasoning",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: false,
		input: ["text", "image"],
		contextWindow: 2_000_000,
		maxTokens: 128_000,
		cost: legacyCost,
	}),
	chat({
		id: "grok-4.20-0309-non-reasoning",
		name: "Grok 4.20 Non-Reasoning",
		wire: "openai-responses",
		reasoning: false,
		supportsReasoningEffort: false,
		input: ["text", "image"],
		contextWindow: 2_000_000,
		maxTokens: 128_000,
		cost: legacyCost,
	}),
	chat({
		id: "grok-build",
		name: "Grok Build",
		wire: "openai-responses",
		reasoning: true,
		supportsReasoningEffort: false,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 128_000,
		cost: included,
	}),
	chat({
		id: "grok-composer-2.5-fast",
		name: "Composer 2.5 Fast",
		wire: "openai-responses",
		reasoning: false,
		supportsReasoningEffort: false,
		input: ["text", "image"],
		contextWindow: 200_000,
		maxTokens: 32_768,
		cost: { input: 3, output: 15, cacheRead: 0.5, cacheWrite: 0 },
	}),
];

export const METADATA_BY_ID: ReadonlyMap<string, ModelMetadata> = new Map(
	MODEL_METADATA.map(model => [model.id, model]),
);

/**
 * Prefix → table id, longest prefix first.
 * A future `grok-4.7-*` id inherits 4.7 instead of the unknown-model defaults.
 * `grok-4.8` does not match and stays conservative until a row is added.
 */
export const FAMILY_PREFIXES: readonly { prefix: string; like: string }[] = [
	{ prefix: "grok-4.20-multi-agent", like: "grok-4.20-multi-agent-0309" },
	{ prefix: "grok-4.20", like: "grok-4.20-0309-reasoning" },
	{ prefix: "grok-4.7", like: "grok-4.7" },
	{ prefix: "grok-4.6", like: "grok-4.6" },
	{ prefix: "grok-4.5", like: "grok-4.5" },
	{ prefix: "grok-4.3", like: "grok-4.3" },
	{ prefix: "grok-composer", like: "grok-composer-2.5-fast" },
	{ prefix: "grok-build", like: "grok-build" },
];

/**
 * Unknown ids that match no family. Text only, no thinking control,
 * and max output is a separate cap — never the context window.
 */
export const UNKNOWN_MODEL_DEFAULTS = {
	wire: "openai-responses" as WireApi,
	reasoning: false,
	supportsReasoningEffort: false,
	input: ["text"] as ("text" | "image")[],
	contextWindow: 128_000,
	maxTokens: 16_384,
	cost: included,
};
