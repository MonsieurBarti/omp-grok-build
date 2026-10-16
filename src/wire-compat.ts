/**
 * Responses `compat` for every grok-build model.
 *
 * omp 18.10.4 `buildModel` sets `compat` to undefined for a custom api
 * (`grok-build-cli`). `streamOpenAIResponses` then throws
 * `e.compat.connectionBoundNativeHistory`. The object below is the compat
 * `buildModel` produces for provider `xai`, api `openai-responses`, id
 * `grok-4.7` in that release, plus the first-event and idle budgets this
 * proxy needs (the host default is 300s, which is the hung `omp -p`).
 *
 * `cli-chat-proxy.grok.com` is not an xAI host to the resolver
 * (`api.x.ai` / provider `xai` only), so these flags are applied explicitly:
 * no `reasoning.summary`, no penalty/stop, flatten root anyOf/oneOf, and
 * `x-grok-conv-id` as the prompt-cache session header.
 */

export const STREAM_FIRST_EVENT_TIMEOUT_MS = 60_000;
export const STREAM_IDLE_TIMEOUT_MS = 90_000;
export const REQUEST_TIMEOUT_MS = 0;

export interface ResponsesCompat {
	supportsDeveloperRole: boolean;
	supportsStrictMode: boolean;
	supportsReasoningEffort: boolean;
	supportsLongPromptCacheRetention: boolean;
	supportsPromptCacheBreakpoints: boolean;
	strictResponsesPairing: boolean;
	supportsImageDetailOriginal: boolean;
	supportsReasoningSummary: boolean;
	supportsAllTurnsReasoningContext: boolean;
	supportsConfigurationUpdate: boolean;
	supportsSteering: boolean;
	requiresReasoningOffJuiceInstruction: boolean;
	stripImageInput: boolean;
	thinkingLoopGuard: "xai";
	reasoningEffortMap: Record<string, string>;
	supportsReasoningParams: boolean;
	supportsSamplingParams: boolean;
	supportsPenaltyAndStopParams: boolean;
	thinkingFormat: "openai";
	reasoningDisableMode: "lowest-effort";
	omitReasoningEffort: boolean;
	includeEncryptedReasoning: boolean;
	filterReasoningHistory: boolean;
	disableReasoningOnForcedToolChoice: boolean;
	disableReasoningOnToolChoice: boolean;
	disableReasoningWithTools: boolean;
	supportsToolChoice: boolean;
	supportsForcedToolChoice: boolean;
	supportsNamedToolChoice: boolean;
	reasoningContentField: "reasoning_content";
	requiresReasoningContentForToolCalls: boolean;
	requiresReasoningContentForAllAssistantTurns: boolean;
	allowsSyntheticReasoningContentForToolCalls: boolean;
	replayReasoningContent: boolean;
	qwenPreserveThinking: boolean;
	qwenTemplateReasoningEffort: boolean;
	requiresThinkingAsText: boolean;
	requiresMistralToolIds: boolean;
	requiresToolResultName: boolean;
	requiresAssistantAfterToolResult: boolean;
	requiresAssistantContentForToolCalls: boolean;
	isOpenRouterHost: boolean;
	isVercelGatewayHost: boolean;
	wireModelIdMode: "raw";
	alwaysSendMaxTokens: boolean;
	clampOutputToModelMax: boolean;
	supportsObfuscationOptOut: boolean;
	storeResponses: boolean;
	connectionBoundNativeHistory: boolean;
	officialEndpoint: boolean;
	harmonyLeakMitigation: boolean;
	rejectRootObjectUnion: boolean;
	retryWithoutStrictOnGrammarError: boolean;
	stripDeepseekSpecialTokens: boolean;
	streamMarkupHealingPattern: "thinking";
	reasoningDeltasMayBeCumulative: boolean;
	emptyLengthFinishIsContextError: boolean;
	usesOpenAIToolCallIdLimit: boolean;
	promptCacheSessionHeader: "x-grok-conv-id";
	streamFirstEventTimeoutMs: number;
	streamIdleTimeoutMs: number;
}

const XHIGH_PREFIXES = ["grok-4.7", "grok-4.6", "grok-4.20-multi-agent"] as const;
const EFFORT_PREFIXES = [
	"grok-4.7",
	"grok-4.6",
	"grok-4.5",
	"grok-4.3",
	"grok-4.20-multi-agent",
	"grok-3-mini",
] as const;

function bare(id: string): string {
	const slash = id.lastIndexOf("/");
	return (slash === -1 ? id : id.slice(slash + 1)).trim().toLowerCase();
}

function startsWithOne(id: string, prefixes: readonly string[]): boolean {
	return prefixes.some(prefix => id.startsWith(prefix));
}

/** xAI wire: reasoning-suffixed SKUs, grok-build, and composer 400 if effort is sent. */
function omitsEffort(id: string): boolean {
	return (
		id.includes("composer") ||
		id.startsWith("grok-build") ||
		id.startsWith("grok-code-fast") ||
		id.includes("reasoning")
	);
}

function baseCompat(): ResponsesCompat {
	return {
		supportsDeveloperRole: false,
		supportsStrictMode: false,
		supportsReasoningEffort: true,
		supportsLongPromptCacheRetention: false,
		supportsPromptCacheBreakpoints: false,
		strictResponsesPairing: false,
		supportsImageDetailOriginal: false,
		supportsReasoningSummary: false,
		supportsAllTurnsReasoningContext: false,
		supportsConfigurationUpdate: false,
		supportsSteering: false,
		requiresReasoningOffJuiceInstruction: false,
		stripImageInput: false,
		thinkingLoopGuard: "xai",
		reasoningEffortMap: { minimal: "low" },
		supportsReasoningParams: true,
		supportsSamplingParams: true,
		supportsPenaltyAndStopParams: false,
		thinkingFormat: "openai",
		reasoningDisableMode: "lowest-effort",
		omitReasoningEffort: false,
		includeEncryptedReasoning: true,
		filterReasoningHistory: false,
		disableReasoningOnForcedToolChoice: false,
		disableReasoningOnToolChoice: false,
		disableReasoningWithTools: false,
		supportsToolChoice: true,
		supportsForcedToolChoice: true,
		supportsNamedToolChoice: true,
		reasoningContentField: "reasoning_content",
		requiresReasoningContentForToolCalls: false,
		requiresReasoningContentForAllAssistantTurns: false,
		allowsSyntheticReasoningContentForToolCalls: true,
		replayReasoningContent: false,
		qwenPreserveThinking: false,
		qwenTemplateReasoningEffort: false,
		requiresThinkingAsText: false,
		requiresMistralToolIds: false,
		requiresToolResultName: false,
		requiresAssistantAfterToolResult: false,
		requiresAssistantContentForToolCalls: false,
		isOpenRouterHost: false,
		isVercelGatewayHost: false,
		wireModelIdMode: "raw",
		alwaysSendMaxTokens: false,
		clampOutputToModelMax: false,
		supportsObfuscationOptOut: false,
		storeResponses: false,
		connectionBoundNativeHistory: false,
		officialEndpoint: false,
		harmonyLeakMitigation: false,
		rejectRootObjectUnion: true,
		retryWithoutStrictOnGrammarError: false,
		stripDeepseekSpecialTokens: false,
		streamMarkupHealingPattern: "thinking",
		reasoningDeltasMayBeCumulative: false,
		emptyLengthFinishIsContextError: false,
		usesOpenAIToolCallIdLimit: false,
		promptCacheSessionHeader: "x-grok-conv-id",
		streamFirstEventTimeoutMs: STREAM_FIRST_EVENT_TIMEOUT_MS,
		streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
	};
}

export interface CompatHints {
	supportsReasoningEffort?: boolean;
	reasoningEffortMap?: Record<string, string>;
}

export function responsesCompatFor(id: string, hints: CompatHints = {}): ResponsesCompat {
	const normalized = bare(id);
	const effortCapable = !omitsEffort(normalized) && startsWithOne(normalized, EFFORT_PREFIXES);
	const supports = hints.supportsReasoningEffort ?? effortCapable;
	const xhighNative = supports && startsWithOne(normalized, XHIGH_PREFIXES) && !hints.reasoningEffortMap?.xhigh;
	const map: Record<string, string> = xhighNative
		? { minimal: "low" }
		: { minimal: "low", xhigh: "high", max: "high" };
	if (hints.reasoningEffortMap) {
		for (const [key, value] of Object.entries(hints.reasoningEffortMap)) {
			if (value) map[key] = value;
		}
	}
	if (xhighNative) {
		delete map.xhigh;
		delete map.max;
	}
	return {
		...baseCompat(),
		supportsReasoningEffort: supports,
		omitReasoningEffort: !supports,
		reasoningEffortMap: map,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Compat the transport actually sees. The host keeps the registered object on
 * `compatConfig` and clears `compat` for this api, so a missing `compat` is
 * rebuilt from the id and any effort hint the registration still carries.
 */
export function compatForTransport(model: {
	id?: string;
	compat?: unknown;
	compatConfig?: unknown;
	reasoning?: boolean;
}): ResponsesCompat {
	const prior = asRecord(model.compat) ?? asRecord(model.compatConfig);
	const hinted = typeof prior?.supportsReasoningEffort === "boolean" ? prior.supportsReasoningEffort : undefined;
	const rawMap = asRecord(prior?.reasoningEffortMap);
	const reasoningEffortMap: Record<string, string> = {};
	if (rawMap) {
		for (const [key, value] of Object.entries(rawMap)) {
			if (typeof value === "string" && value) reasoningEffortMap[key] = value;
		}
	}
	const compat = responsesCompatFor(String(model.id ?? ""), {
		...(hinted !== undefined ? { supportsReasoningEffort: hinted } : {}),
		...(Object.keys(reasoningEffortMap).length > 0 ? { reasoningEffortMap } : {}),
	});
	if (model.reasoning === false) {
		compat.supportsReasoningEffort = false;
		compat.omitReasoningEffort = true;
	}
	compat.connectionBoundNativeHistory = false;
	return compat;
}
