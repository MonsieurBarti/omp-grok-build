import { randomBytes } from "node:crypto";

import { CLI_FINGERPRINT, resolveCliVersion, resolveClientMode } from "./fingerprint.ts";
import { conversationGroupId } from "./session.ts";

export interface HeaderBuildContext {
	version?: string;
	platform?: string;
	arch?: string;
	mode?: string;
	env?: NodeJS.ProcessEnv;
	versionFile?: string;
}

/** darwin→macos, win32→windows, arm64→aarch64, x64→x86_64. Matches captured grok-shell UAs. */
export function mapOs(platform: string): string {
	if (platform === "darwin") return "macos";
	if (platform === "win32") return "windows";
	return platform;
}

export function mapArch(arch: string): string {
	if (arch === "arm64") return "aarch64";
	if (arch === "x64") return "x86_64";
	return arch;
}

export function buildUserAgent(ctx: HeaderBuildContext = {}): string {
	const version =
		ctx.version ??
		resolveCliVersion({ env: ctx.env, versionFile: ctx.versionFile });
	const os = mapOs(ctx.platform ?? process.platform);
	const arch = mapArch(ctx.arch ?? process.arch);
	return CLI_FINGERPRINT.userAgentTemplate
		.replaceAll("{version}", version)
		.replaceAll("{os}", os)
		.replaceAll("{arch}", arch);
}

/**
 * Static fingerprint on every proxy call.
 * Names and values live in fingerprint.ts so a capture diff has one edit point.
 */
export function buildStaticHeaders(ctx: HeaderBuildContext = {}): Record<string, string> {
	const version =
		ctx.version ??
		resolveCliVersion({ env: ctx.env, versionFile: ctx.versionFile });
	const headers: Record<string, string> = {
		"User-Agent": buildUserAgent({ ...ctx, version }),
		"X-XAI-Token-Auth": CLI_FINGERPRINT.tokenAuth,
		"x-grok-client-identifier": CLI_FINGERPRINT.clientIdentifier,
		"x-grok-client-version": version,
		"x-authenticateresponse": CLI_FINGERPRINT.authenticateResponse,
	};
	if (CLI_FINGERPRINT.sendClientMode) {
		headers["x-grok-client-mode"] = ctx.mode ?? resolveClientMode(ctx.env);
	}
	return headers;
}

export const REQUIRED_DYNAMIC_HEADERS = [
	"x-grok-session-id",
	"x-grok-conv-id",
	"x-grok-req-id",
	"x-grok-turn-idx",
	"x-grok-model-override",
	"x-grok-conv-group-id",
	"traceparent",
	"x-grok-doom-loop-check",
	"x-grok-exact-repetition-check",
] as const;

export function optionalDynamicHeaders(): string[] {
	return CLI_FINGERPRINT.sendAgentId ? ["x-grok-agent-id"] : [];
}

/** Present on a sampling request when the model or the token supplies them. */
export const RECOGNIZED_OPTIONAL_CHAT_HEADERS = [
	"x-grok-user-id",
	"x-compactions-remaining",
	"x-compaction-at",
] as const;

/** `00-{trace-id}-{span-id}-01`, matching the CLI's sampling request. */
export function newTraceparent(bytes: (size: number) => Buffer = randomBytes): string {
	const buf = bytes(24);
	return `00-${buf.subarray(0, 16).toString("hex")}-${buf.subarray(16, 24).toString("hex")}-01`;
}

/** Headers whose values the plugin owns. Caller headers cannot replace them. */
export const PROTECTED_HEADER_NAMES = [
	"authorization",
	"user-agent",
	"x-xai-token-auth",
	"x-grok-client-identifier",
	"x-grok-client-version",
	"x-grok-client-mode",
	"x-authenticateresponse",
	"x-grok-session-id",
	"x-grok-conv-id",
	"x-grok-req-id",
	"x-grok-agent-id",
	"x-grok-turn-idx",
	"x-grok-model-override",
	"x-grok-conv-group-id",
	"x-grok-user-id",
	"traceparent",
	"x-grok-doom-loop-check",
	"x-grok-exact-repetition-check",
] as const;

export interface ChatHeaderInput extends HeaderBuildContext {
	accessToken: string;
	sessionId: string;
	convId?: string;
	requestId: string;
	agentId?: string;
	turnIndex: number;
	modelId: string;
	convGroupId?: string;
	userId?: string;
	traceparent?: string;
	extra?: Record<string, string | undefined>;
}

export function buildChatHeaders(input: ChatHeaderInput): Record<string, string> {
	const sessionId = input.sessionId;
	const convId = input.convId ?? sessionId;
	const owned: Record<string, string> = {
		...buildStaticHeaders(input),
		Authorization: `Bearer ${input.accessToken}`,
		Accept: "text/event-stream",
		"x-grok-session-id": sessionId,
		"x-grok-conv-id": convId,
		"x-grok-req-id": input.requestId,
		"x-grok-turn-idx": String(input.turnIndex),
		"x-grok-model-override": input.modelId,
	};
	if (CLI_FINGERPRINT.sendAgentId && input.agentId) {
		owned["x-grok-agent-id"] = input.agentId;
	}
	if (CLI_FINGERPRINT.sendConvGroupId) {
		owned["x-grok-conv-group-id"] = input.convGroupId ?? conversationGroupId();
	}
	if (CLI_FINGERPRINT.sendTraceparent) {
		owned.traceparent = input.traceparent ?? newTraceparent();
	}
	if (input.userId && !input.userId.includes("@")) {
		owned["x-grok-user-id"] = input.userId;
	}
	owned["x-grok-doom-loop-check"] = CLI_FINGERPRINT.doomLoopCheck;
	owned["x-grok-exact-repetition-check"] = CLI_FINGERPRINT.exactRepetitionCheck;

	const merged: Record<string, string> = {};
	for (const [name, value] of Object.entries(input.extra ?? {})) {
		if (!value) continue;
		merged[name] = value;
	}
	const protectedNames = new Set(PROTECTED_HEADER_NAMES.map(name => name.toLowerCase()));
	for (const key of Object.keys(merged)) {
		if (protectedNames.has(key.toLowerCase())) delete merged[key];
	}
	return { ...merged, ...owned };
}

export function deviceCodeHeaders(ctx: HeaderBuildContext = {}): Record<string, string> {
	const version =
		ctx.version ??
		resolveCliVersion({ env: ctx.env, versionFile: ctx.versionFile });
	return {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json",
		"x-grok-client-version": version,
		"x-grok-client-surface": CLI_FINGERPRINT.clientSurface,
	};
}

export function lowerHeaders(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		out[name.toLowerCase()] = value;
	}
	return out;
}
