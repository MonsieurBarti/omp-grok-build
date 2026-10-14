import { randomUUID } from "node:crypto";

import { assertBuildBaseUrl, assertOAuthAccessToken } from "./auth-guard.ts";
import { GROK_BUILD_API, GROK_BUILD_BASE_URL, PROVIDER_ID } from "./constants.ts";
import { buildChatHeaders, type HeaderBuildContext } from "./headers.ts";
import { wireFor, bareModelId } from "./models.ts";
import { CLI_FINGERPRINT } from "./fingerprint.ts";
import { agentIdFor, conversationIdFor, countUserTurns, nextTurnIndex, resolveSessionId } from "./session.ts";
import type { WireApi } from "./model-metadata.ts";

export interface StreamModel {
	id: string;
	api?: string;
	baseUrl?: string;
	provider?: string;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface StreamOptions {
	apiKey?: string;
	sessionId?: string;
	promptCacheKey?: string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	[key: string]: unknown;
}

export interface PreparedCall {
	wire: WireApi;
	model: StreamModel;
	context: { messages?: unknown[] };
	options: StreamOptions;
	headers: Record<string, string>;
}

export interface PrepareDeps extends HeaderBuildContext {
	uuid?: () => string;
}

export function prepareGrokBuildCall(
	model: StreamModel,
	context: { messages?: unknown[] },
	options: StreamOptions | undefined,
	deps: PrepareDeps = {},
): PreparedCall {
	const token = assertOAuthAccessToken(options?.apiKey);
	const baseUrl = assertBuildBaseUrl(GROK_BUILD_BASE_URL);
	const uuid = deps.uuid ?? randomUUID;
	const sessionId = resolveSessionId(options?.sessionId ?? options?.promptCacheKey, uuid);
	const requestId = uuid();
	const agentId = agentIdFor(sessionId, uuid);
	const convId = CLI_FINGERPRINT.convIdEqualsSessionId ? sessionId : conversationIdFor(sessionId, uuid);
	const turnIndex = nextTurnIndex(sessionId, countUserTurns(context?.messages));
	const modelId = bareModelId(model.id);
	const wire = wireFor(modelId);
	const headers = buildChatHeaders({
		...deps,
		accessToken: token,
		sessionId,
		convId,
		requestId,
		agentId,
		turnIndex,
		modelId,
		extra: {
			...(model.headers ?? {}),
			...(options?.headers ?? {}),
		},
	});
	return {
		wire,
		headers,
		context,
		model: {
			...model,
			id: modelId,
			provider: PROVIDER_ID,
			api: wire,
			baseUrl,
			headers,
		},
		options: {
			...options,
			apiKey: token,
			sessionId,
			promptCacheKey: sessionId,
			headers,
		},
	};
}

export type WireTransport = (
	model: StreamModel,
	context: { messages?: unknown[] },
	options: StreamOptions,
) => unknown;

export interface Transports {
	responses: WireTransport;
	completions: WireTransport;
}

export function streamGrokBuild(
	model: StreamModel,
	context: { messages?: unknown[] },
	options: StreamOptions | undefined,
	transports: Transports,
	deps: PrepareDeps = {},
): unknown {
	const prepared = prepareGrokBuildCall(model, context, options, deps);
	const transport = prepared.wire === "openai-completions" ? transports.completions : transports.responses;
	if (typeof transport !== "function") {
		throw new Error(`grok-build has no ${prepared.wire} transport`);
	}
	return transport(prepared.model, prepared.context, prepared.options);
}

export const STREAM_API = GROK_BUILD_API;
