import { readFileSync } from "node:fs";

import { CLI_FINGERPRINT, resolveCliVersion } from "./fingerprint.ts";
import {
	buildStaticHeaders,
	lowerHeaders,
	optionalDynamicHeaders,
	RECOGNIZED_OPTIONAL_CHAT_HEADERS,
	REQUIRED_DYNAMIC_HEADERS,
	type HeaderBuildContext,
} from "./headers.ts";
import { GROK_BUILD_ORIGIN } from "./constants.ts";

export interface CapturedRequest {
	url: string;
	method?: string;
	headers: Record<string, string>;
}

export interface HeaderDiff {
	url: string;
	kind: "chat" | "other";
	missing: string[];
	mismatched: { name: string; plugin: string; capture: string }[];
	extra: string[];
	dynamicOk: string[];
}

const IGNORED = new Set([
	"host",
	"content-length",
	"content-type",
	"accept",
	"accept-encoding",
	"accept-language",
	"connection",
	"cookie",
	"pragma",
	"cache-control",
	"transfer-encoding",
	"expect",
	"te",
	"trailer",
	"upgrade",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pluginStaticHeaders(ctx: HeaderBuildContext = {}): Record<string, string> {
	return lowerHeaders(buildStaticHeaders(ctx));
}

export function isChatUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.origin === GROK_BUILD_ORIGIN &&
			(parsed.pathname.endsWith("/responses") || parsed.pathname.endsWith("/chat/completions"))
		);
	} catch {
		return false;
	}
}

export function diffCapturedRequest(
	request: CapturedRequest,
	ctx: HeaderBuildContext = {},
): HeaderDiff {
	const captured = lowerHeaders(request.headers);
	const plugin = pluginStaticHeaders(ctx);
	const kind = isChatUrl(request.url) ? "chat" : "other";
	const missing: string[] = [];
	const mismatched: HeaderDiff["mismatched"] = [];
	const dynamicOk: string[] = [];

	for (const [name, expected] of Object.entries(plugin)) {
		const actual = captured[name];
		if (actual === undefined) {
			missing.push(name);
			continue;
		}
		if (actual !== expected) {
			mismatched.push({ name, plugin: expected, capture: actual });
		}
	}

	if (kind === "chat") {
		const required = new Set<string>([...REQUIRED_DYNAMIC_HEADERS, ...optionalDynamicHeaders()]);
		const recognized = [...required, ...RECOGNIZED_OPTIONAL_CHAT_HEADERS];
		for (const name of recognized) {
			const actual = captured[name];
			if (!actual) {
				if (required.has(name)) missing.push(name);
				continue;
			}
			if (!dynamicValueOk(name, actual)) {
				mismatched.push({ name, plugin: expectedShape(name), capture: actual });
				continue;
			}
			dynamicOk.push(name);
		}
		const authorization = captured.authorization;
		if (!authorization) missing.push("authorization");
		else if (!/^bearer\s+\S+/i.test(authorization)) {
			mismatched.push({
				name: "authorization",
				plugin: "Bearer <token>",
				capture: "Bearer <redacted>",
			});
		} else {
			dynamicOk.push("authorization");
		}
	}

	const known = new Set<string>([
		...Object.keys(plugin),
		...REQUIRED_DYNAMIC_HEADERS,
		...optionalDynamicHeaders(),
		...RECOGNIZED_OPTIONAL_CHAT_HEADERS,
		"authorization",
		...IGNORED,
	]);
	const extra = Object.keys(captured).filter(name => !known.has(name));
	return { url: request.url, kind, missing, mismatched, extra, dynamicOk };
}

export function diffHasFailures(diff: HeaderDiff): boolean {
	return diff.missing.length > 0 || diff.mismatched.length > 0;
}

function dynamicValueOk(name: string, value: string): boolean {
	if (name === "x-grok-turn-idx") return /^[1-9]\d*$/.test(value);
	if (name === "x-grok-model-override") return value.trim().length > 0;
	if (name === "traceparent") return /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(value);
	if (name === "x-grok-doom-loop-check") return value === CLI_FINGERPRINT.doomLoopCheck;
	if (name === "x-grok-exact-repetition-check") return value === CLI_FINGERPRINT.exactRepetitionCheck;
	if (name.endsWith("-id")) return UUID.test(value) || value.trim().length > 0;
	return value.trim().length > 0;
}

function expectedShape(name: string): string {
	if (name === "x-grok-turn-idx") return "<positive integer>";
	if (name === "x-grok-model-override") return "<model id>";
	if (name === "traceparent") return "00-<32 hex>-<16 hex>-01";
	if (name === "x-grok-doom-loop-check") return CLI_FINGERPRINT.doomLoopCheck;
	if (name === "x-grok-exact-repetition-check") return CLI_FINGERPRINT.exactRepetitionCheck;
	return "<non-empty id>";
}

export function loadTrace(json: unknown): CapturedRequest[] {
	if (Array.isArray(json)) return json.map(coerceRequest).filter(isRequest);
	if (!isRecord(json)) return [];
	if (Array.isArray(json.requests)) return json.requests.map(coerceRequest).filter(isRequest);
	const log = isRecord(json.log) ? json.log : undefined;
	if (log && Array.isArray(log.entries)) {
		return log.entries
			.map(entry => {
				if (!isRecord(entry) || !isRecord(entry.request)) return undefined;
				return coerceRequest(entry.request);
			})
			.filter(isRequest);
	}
	return [];
}

export function loadTraceFile(path: string): CapturedRequest[] {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	return loadTrace(parsed).filter(request => {
		try {
			return new URL(request.url).origin === GROK_BUILD_ORIGIN;
		} catch {
			return false;
		}
	});
}

export function formatDiffReport(diffs: HeaderDiff[], ctx: HeaderBuildContext = {}): string {
	const version = ctx.version ?? resolveCliVersion({ env: ctx.env, versionFile: ctx.versionFile });
	const lines = [
		`grok-build header diff`,
		`plugin version: ${version}`,
		`client: ${CLI_FINGERPRINT.clientIdentifier}`,
		`user-agent template: ${CLI_FINGERPRINT.userAgentTemplate}`,
		`edit src/fingerprint.ts when a static value disagrees with the capture`,
		"",
	];
	if (diffs.length === 0) {
		lines.push("No cli-chat-proxy.grok.com requests in the capture.");
		return lines.join("\n");
	}
	for (const diff of diffs) {
		const status = diffHasFailures(diff) ? "MISMATCH" : "ok";
		lines.push(`${status}  ${diff.kind}  ${diff.url}`);
		for (const name of diff.missing) lines.push(`  missing   ${name}`);
		for (const item of diff.mismatched) {
			lines.push(`  value     ${item.name}`);
			lines.push(`    plugin  ${redact(item.name, item.plugin)}`);
			lines.push(`    capture ${redact(item.name, item.capture)}`);
		}
		for (const name of diff.extra) lines.push(`  extra     ${name}  (capture has this, plugin does not send it)`);
		if (diff.dynamicOk.length > 0) lines.push(`  dynamic   ${diff.dynamicOk.join(", ")}`);
		lines.push("");
	}
	return lines.join("\n");
}

function redact(name: string, value: string): string {
	if (name.toLowerCase() === "authorization") return "Bearer <redacted>";
	return value;
}

function coerceRequest(value: unknown): CapturedRequest | undefined {
	if (!isRecord(value) || typeof value.url !== "string") return undefined;
	const headers: Record<string, string> = {};
	if (Array.isArray(value.headers)) {
		for (const header of value.headers) {
			if (!isRecord(header)) continue;
			const name = typeof header.name === "string" ? header.name : undefined;
			const headerValue = typeof header.value === "string" ? header.value : undefined;
			if (name && headerValue !== undefined) headers[name] = headerValue;
		}
	} else if (isRecord(value.headers)) {
		for (const [name, headerValue] of Object.entries(value.headers)) {
			if (typeof headerValue === "string") headers[name] = headerValue;
		}
	}
	return {
		url: value.url,
		...(typeof value.method === "string" ? { method: value.method } : {}),
		headers,
	};
}

function isRequest(value: CapturedRequest | undefined): value is CapturedRequest {
	return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
