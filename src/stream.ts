import { randomUUID } from "node:crypto";

import { armAbort } from "./abort-timer.ts";
import { assertBuildBaseUrl, assertOAuthAccessToken } from "./auth-guard.ts";
import { GROK_BUILD_API, GROK_BUILD_BASE_URL, PROVIDER_ID } from "./constants.ts";
import { debugLog, redactHeaders } from "./debug.ts";
import { buildChatHeaders, type HeaderBuildContext } from "./headers.ts";
import { wireFor, bareModelId } from "./models.ts";
import { CLI_FINGERPRINT } from "./fingerprint.ts";
import { agentIdFor, conversationIdFor, countUserTurns, nextTurnIndex, resolveSessionId } from "./session.ts";
import type { WireApi } from "./model-metadata.ts";
import {
	REQUEST_TIMEOUT_MS,
	STREAM_FIRST_EVENT_TIMEOUT_MS,
	STREAM_IDLE_TIMEOUT_MS,
	compatForTransport,
} from "./wire-compat.ts";

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
	const compat = compatForTransport({ ...model, id: modelId });
	try {
		model.compat = compat;
	} catch {
		// A frozen registry row still gets compat on the object passed to the transport.
	}
	debugLog("POST /v1/responses headers", redactHeaders(headers));
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
			compat,
		},
		options: {
			...options,
			apiKey: token,
			sessionId,
			promptCacheKey: sessionId,
			headers,
			streamFirstEventTimeoutMs: options?.streamFirstEventTimeoutMs ?? STREAM_FIRST_EVENT_TIMEOUT_MS,
			streamIdleTimeoutMs: options?.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS,
		},
	};
}

export function requestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.GROK_BUILD_TIMEOUT_MS;
	if (raw === undefined || raw.trim() === "") return REQUEST_TIMEOUT_MS;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) return REQUEST_TIMEOUT_MS;
	return Math.floor(parsed);
}

function timeoutReason(ms: number): Error {
	const label = ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
	return new Error(
		`grok-build request to cli-chat-proxy.grok.com timed out after ${label}. Set GROK_BUILD_TIMEOUT_MS to wait longer.`,
	);
}

function releaseWhenSettled(stream: unknown, cancel: () => void): void {
	if (typeof stream === "object" && stream !== null && "finalResultPromise" in stream) {
		const promise = (stream as { finalResultPromise?: unknown }).finalResultPromise;
		if (promise instanceof Promise) {
			void promise.finally(cancel).catch(() => {});
			return;
		}
	}
	cancel();
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
	const timeoutMs = requestTimeoutMs();
	const armed =
		timeoutMs > 0 ? armAbort(timeoutMs, prepared.options.signal, timeoutReason(timeoutMs)) : undefined;
	if (armed) prepared.options = { ...prepared.options, signal: armed.signal };
	let stream: unknown;
	try {
		stream = transport(prepared.model, prepared.context, prepared.options);
	} catch (error) {
		armed?.cancel();
		throw error;
	}
	if (armed) releaseWhenSettled(stream, armed.cancel);
	return stream;
}

export const STREAM_API = GROK_BUILD_API;
