import { randomUUID } from "node:crypto";

const turns = new Map<string, number>();
const agents = new Map<string, string>();
const conversations = new Map<string, string>();
let fallbackSessionId: string | undefined;
let convGroupId: string | undefined;

export function resetGrokSessionState(): void {
	turns.clear();
	agents.clear();
	conversations.clear();
	fallbackSessionId = undefined;
	convGroupId = undefined;
}

/** Stable for the process when omp did not pass a session id. */
export function resolveSessionId(raw: string | undefined, uuid: () => string = randomUUID): string {
	const trimmed = typeof raw === "string" ? raw.trim() : "";
	if (trimmed) return trimmed;
	if (!fallbackSessionId) fallbackSessionId = uuid();
	return fallbackSessionId;
}

export function agentIdFor(sessionId: string, uuid: () => string = randomUUID): string {
	const existing = agents.get(sessionId);
	if (existing) return existing;
	const created = uuid();
	agents.set(sessionId, created);
	return created;
}

/**
 * Process-stable conversation group. The CLI sends the same
 * `x-grok-conv-group-id` on every responses call in a process.
 */
export function conversationGroupId(uuid: () => string = randomUUID): string {
	if (!convGroupId) convGroupId = uuid();
	return convGroupId;
}

/** Stable conversation id when the fingerprint does not reuse the session id. */
export function conversationIdFor(sessionId: string, uuid: () => string = randomUUID): string {
	const existing = conversations.get(sessionId);
	if (existing) return existing;
	const created = uuid();
	conversations.set(sessionId, created);
	return created;
}

/**
 * 1-based turn index. Never goes backwards for a session.
 * `observedUserTurns` is the user-message count already in the context.
 */
export function nextTurnIndex(sessionId: string, observedUserTurns?: number): number {
	const prev = turns.get(sessionId) ?? 0;
	const next =
		observedUserTurns === undefined
			? Math.max(prev + 1, 1)
			: Math.max(Math.floor(observedUserTurns), prev, 1);
	turns.set(sessionId, next);
	return next;
}

export function countUserTurns(messages: unknown): number {
	if (!Array.isArray(messages)) return 1;
	let count = 0;
	for (const item of messages) {
		if (!item || typeof item !== "object") continue;
		const role = "role" in item ? item.role : undefined;
		if (role === "user") count += 1;
	}
	return Math.max(1, count);
}
