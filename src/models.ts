import {
	FAMILY_PREFIXES,
	METADATA_BY_ID,
	MODEL_METADATA,
	UNKNOWN_MODEL_DEFAULTS,
	type ModelMetadata,
	type ThinkingMeta,
	type WireApi,
} from "./model-metadata.ts";

export interface ServerModel {
	id?: unknown;
	name?: unknown;
	object?: unknown;
	context_window?: unknown;
	context_length?: unknown;
	max_context_length?: unknown;
	max_model_len?: unknown;
	contextWindow?: unknown;
	max_output_tokens?: unknown;
	max_completion_tokens?: unknown;
	max_tokens?: unknown;
	maxTokens?: unknown;
	input_modalities?: unknown;
	output_modalities?: unknown;
	modalities?: unknown;
	capabilities?: unknown;
	supports_reasoning?: unknown;
	reasoning?: unknown;
	supports_reasoning_effort?: unknown;
	reasoning_efforts?: unknown;
	reasoning_effort?: unknown;
	api_backend?: unknown;
	wire?: unknown;
	api?: unknown;
	endpoints?: unknown;
	[key: string]: unknown;
}

export interface ProviderModel {
	id: string;
	name: string;
	api: "grok-build-cli";
	reasoning: boolean;
	thinking?: ThinkingMeta;
	input: ("text" | "image")[];
	cost: ModelMetadata["cost"];
	contextWindow: number;
	maxTokens: number;
	headers: Record<string, string>;
	compat: {
		supportsReasoningEffort: boolean;
		reasoningEffortMap?: Record<string, string>;
		promptCacheSessionHeader: string;
	};
}

const wireById = new Map<string, WireApi>();

const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

const CONTEXT_KEYS = [
	"context_window",
	"context_length",
	"max_context_length",
	"max_model_len",
	"contextWindow",
] as const;

/** Prefer explicit output fields. Bare `max_tokens` is often the context window. */
const OUTPUT_KEYS = ["max_output_tokens", "max_completion_tokens", "maxTokens"] as const;

const EXCLUDE_ID =
	/(?:^|[-_/])(image|images|imagine|flux|tts|stt|whisper|embed|embedding|video|voice|realtime|audio|speech|transcrib|moderation)(?:$|[-_/])/i;

export function bareModelId(id: string): string {
	const slash = id.lastIndexOf("/");
	return (slash === -1 ? id : id.slice(slash + 1)).trim();
}

export function isChatModelId(id: string): boolean {
	return id.length > 0 && !EXCLUDE_ID.test(id);
}

function cloneThinking(thinking: ThinkingMeta | undefined): ThinkingMeta | undefined {
	if (!thinking) return undefined;
	return { mode: "effort", efforts: [...thinking.efforts], defaultLevel: thinking.defaultLevel };
}

function cloneMeta(meta: ModelMetadata, id: string, name?: string): ModelMetadata {
	return {
		...meta,
		id,
		name: name ?? (id === meta.id ? meta.name : id),
		input: [...meta.input],
		cost: { ...meta.cost },
		thinking: cloneThinking(meta.thinking),
		reasoningEffortMap: meta.reasoningEffortMap ? { ...meta.reasoningEffortMap } : undefined,
	};
}

export function familyMetadata(id: string): ModelMetadata | undefined {
	const normalized = id.toLowerCase();
	if (normalized.includes("non-reasoning")) {
		const row = METADATA_BY_ID.get("grok-4.20-0309-non-reasoning");
		if (row && normalized.startsWith("grok-4.20")) return cloneMeta(row, id);
	}
	for (const family of FAMILY_PREFIXES) {
		if (normalized.startsWith(family.prefix)) {
			const row = METADATA_BY_ID.get(family.like);
			if (row) return cloneMeta(row, id);
		}
	}
	return undefined;
}

export function unknownMetadata(id: string): ModelMetadata {
	return {
		id,
		name: id,
		wire: UNKNOWN_MODEL_DEFAULTS.wire,
		reasoning: UNKNOWN_MODEL_DEFAULTS.reasoning,
		supportsReasoningEffort: UNKNOWN_MODEL_DEFAULTS.supportsReasoningEffort,
		input: [...UNKNOWN_MODEL_DEFAULTS.input],
		contextWindow: UNKNOWN_MODEL_DEFAULTS.contextWindow,
		maxTokens: UNKNOWN_MODEL_DEFAULTS.maxTokens,
		cost: { ...UNKNOWN_MODEL_DEFAULTS.cost },
	};
}

function baseMetadata(id: string): ModelMetadata {
	const exact = METADATA_BY_ID.get(id);
	if (exact) return cloneMeta(exact, id);
	return familyMetadata(id) ?? unknownMetadata(id);
}

function positiveInt(value: unknown): number | undefined {
	const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(number) || number <= 0 || number > 10_000_000) return undefined;
	return Math.floor(number);
}

function firstPositive(row: ServerModel, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const parsed = positiveInt(row[key]);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

function stringList(value: unknown): string[] | undefined {
	if (typeof value === "string" && value.trim()) return [value.trim().toLowerCase()];
	if (!Array.isArray(value)) return undefined;
	const items = value
		.map(item => (typeof item === "string" ? item.trim().toLowerCase() : ""))
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

function readImages(row: ServerModel): boolean | undefined {
	const modalities = [
		...(stringList(row.input_modalities) ?? []),
		...(stringList(row.modalities) ?? []),
		...(stringList(row.capabilities) ?? []),
	];
	if (modalities.length === 0 && typeof row.capabilities === "object" && row.capabilities) {
		const caps = row.capabilities as Record<string, unknown>;
		if (typeof caps.vision === "boolean") return caps.vision;
		if (typeof caps.image === "boolean") return caps.image;
		if (typeof caps.images === "boolean") return caps.images;
	}
	if (modalities.length === 0) return undefined;
	return modalities.some(item => /image|vision/.test(item));
}

function readEfforts(row: ServerModel): string[] | undefined {
	const listed = stringList(row.reasoning_efforts) ?? stringList(row.reasoning_effort);
	if (!listed) return undefined;
	const allowed = new Set<string>(EFFORT_ORDER);
	const picked = EFFORT_ORDER.filter(effort => listed.includes(effort) && allowed.has(effort));
	return picked;
}

function readWire(row: ServerModel): WireApi | undefined {
	const raw = [row.api_backend, row.wire, row.api]
		.filter((value): value is string => typeof value === "string")
		.map(value => value.trim().toLowerCase());
	for (const value of raw) {
		if (value === "responses" || value === "openai-responses") return "openai-responses";
		if (
			value === "chat_completions" ||
			value === "chat.completions" ||
			value === "openai-completions"
		) {
			return "openai-completions";
		}
	}
	const endpoints = stringList(row.endpoints);
	if (!endpoints) return undefined;
	const hasResponses = endpoints.some(item => item.includes("response"));
	const hasChat = endpoints.some(item => item.includes("chat"));
	if (hasResponses && !hasChat) return "openai-responses";
	if (hasChat && !hasResponses) return "openai-completions";
	return undefined;
}

function applyServer(base: ModelMetadata, row: ServerModel | undefined): ModelMetadata {
	if (!row) return base;
	const context = firstPositive(row, CONTEXT_KEYS);
	const explicitOutput = firstPositive(row, OUTPUT_KEYS);
	if (context !== undefined) base.contextWindow = context;
	if (explicitOutput !== undefined) {
		base.maxTokens = explicitOutput;
	} else if (base.maxTokens >= base.contextWindow) {
		base.maxTokens = Math.max(1, Math.min(16_384, Math.floor(base.contextWindow / 2)));
	}

	const images = readImages(row);
	if (images !== undefined) base.input = images ? ["text", "image"] : ["text"];

	const efforts = readEfforts(row);
	if (efforts !== undefined) {
		if (efforts.length === 0) {
			base.supportsReasoningEffort = false;
			base.thinking = undefined;
		} else {
			base.reasoning = true;
			base.supportsReasoningEffort = true;
			base.thinking = {
				mode: "effort",
				efforts: [...efforts],
				defaultLevel: efforts.includes("high") ? "high" : efforts[efforts.length - 1]!,
			};
		}
	} else if (typeof row.supports_reasoning === "boolean") {
		base.reasoning = row.supports_reasoning;
		if (!row.supports_reasoning) {
			base.supportsReasoningEffort = false;
			base.thinking = undefined;
		}
	} else if (typeof row.reasoning === "boolean") {
		base.reasoning = row.reasoning;
		if (!row.reasoning) {
			base.supportsReasoningEffort = false;
			base.thinking = undefined;
		}
	}

	if (row.supports_reasoning_effort === false) {
		base.supportsReasoningEffort = false;
		base.thinking = undefined;
	}

	const wire = readWire(row);
	if (wire) base.wire = wire;

	if (typeof row.name === "string" && row.name.trim()) base.name = row.name.trim();
	return base;
}

export function rememberWire(models: readonly ModelMetadata[]): void {
	wireById.clear();
	for (const model of models) wireById.set(model.id, model.wire);
}

export function wireFor(modelId: string): WireApi {
	const id = bareModelId(modelId);
	return wireById.get(id) ?? baseMetadata(id).wire;
}

export function mergeModel(id: string, server?: ServerModel): ModelMetadata {
	return applyServer(baseMetadata(bareModelId(id)), server);
}

export function toProviderModel(meta: ModelMetadata): ProviderModel {
	const thinking =
		meta.reasoning && meta.supportsReasoningEffort ? cloneThinking(meta.thinking) : undefined;
	return {
		id: meta.id,
		name: meta.name,
		api: "grok-build-cli",
		reasoning: meta.reasoning,
		...(thinking ? { thinking } : {}),
		input: [...meta.input],
		cost: { ...meta.cost },
		contextWindow: meta.contextWindow,
		maxTokens: meta.maxTokens,
		headers: { "x-grok-model-override": meta.id },
		compat: {
			supportsReasoningEffort: meta.supportsReasoningEffort,
			...(meta.reasoningEffortMap ? { reasoningEffortMap: { ...meta.reasoningEffortMap } } : {}),
			promptCacheSessionHeader: "x-grok-conv-id",
		},
	};
}

export function seedModels(): ProviderModel[] {
	const metas = MODEL_METADATA.map(model => cloneMeta(model, model.id));
	rememberWire(metas);
	return metas.map(toProviderModel);
}

export function isExcludedServerModel(row: ServerModel): boolean {
	const id = typeof row.id === "string" ? bareModelId(row.id) : "";
	if (!id || !isChatModelId(id)) return true;
	const object = typeof row.object === "string" ? row.object.toLowerCase() : "";
	if (object && object !== "model") return true;
	const outputs = stringList(row.output_modalities) ?? [];
	if (outputs.length > 0 && outputs.every(item => /image|audio|speech/.test(item)) && !outputs.includes("text")) {
		return true;
	}
	return false;
}

export function mergeServerModels(rows: readonly ServerModel[]): ProviderModel[] {
	const merged: ModelMetadata[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		if (isExcludedServerModel(row)) continue;
		const id = bareModelId(String(row.id));
		if (seen.has(id)) continue;
		seen.add(id);
		merged.push(mergeModel(id, row));
	}
	rememberWire(merged);
	return merged.map(toProviderModel);
}

export function parseModelListPayload(payload: unknown): ServerModel[] {
	if (Array.isArray(payload)) return payload.filter(isRecord);
	if (!isRecord(payload)) return [];
	if (Array.isArray(payload.data)) return payload.data.filter(isRecord);
	if (Array.isArray(payload.models)) return payload.models.filter(isRecord);
	return [];
}

function isRecord(value: unknown): value is ServerModel {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
