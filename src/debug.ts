const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SECRET_KEY = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|secret|bearer/i;

let lastModelsSummary = "No /v1/models response captured in this process yet.";

export function grokBuildDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = (env.GROK_BUILD_DEBUG ?? "").trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

export function redactValue(value: unknown): unknown {
	if (typeof value === "string") {
		return value.replace(JWT, "[redacted-jwt]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
	}
	if (Array.isArray(value)) return value.map(item => redactValue(item));
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value)) {
			out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactValue(inner);
		}
		return out;
	}
	return value;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const redacted = redactValue(headers);
	return typeof redacted === "object" && redacted !== null ? (redacted as Record<string, string>) : {};
}

export function debugLog(label: string, value: unknown, env: NodeJS.ProcessEnv = process.env): void {
	if (!grokBuildDebugEnabled(env)) return;
	const body = typeof value === "string" ? redactValue(value) : JSON.stringify(redactValue(value), null, 2);
	console.error(`[grok-build] ${label}\n${body}`);
}

function fmt(value: unknown): string {
	if (value === undefined) return "-";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return "-";
	}
}

function rowsOf(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload;
	if (typeof payload !== "object" || payload === null) return [];
	const record = payload as Record<string, unknown>;
	if (Array.isArray(record.data)) return record.data;
	if (Array.isArray(record.models)) return record.models;
	return [];
}

export function rememberModelsPayload(payload: unknown): void {
	const rows = rowsOf(payload);
	const lines = rows.slice(0, 40).map(row => {
		if (typeof row !== "object" || row === null) return "- (non-object)";
		const record = row as Record<string, unknown>;
		const id = typeof record.id === "string" ? record.id : "?";
		const context = record.context_window ?? record.contextWindow ?? record.context_length ?? record.max_model_len;
		const output = record.max_output_tokens ?? record.max_completion_tokens ?? record.max_tokens;
		const effort = record.reasoning_efforts ?? record.reasoning_effort;
		return `- ${id} context=${fmt(context)} output=${fmt(output)} effort=${fmt(effort)}`;
	});
	const extra = rows.length > 40 ? `\n… ${rows.length - 40} more` : "";
	lastModelsSummary = [`Last /v1/models (${rows.length} rows):`, ...lines].join("\n") + extra;
	debugLog("GET /v1/models response", payload);
}

export function debugStatusText(): string {
	return [
		`GROK_BUILD_DEBUG=${grokBuildDebugEnabled() ? "on" : "off"}`,
		"Set GROK_BUILD_DEBUG=1 to log redacted request headers and the /v1/models body on stderr.",
		"",
		lastModelsSummary,
	].join("\n");
}
