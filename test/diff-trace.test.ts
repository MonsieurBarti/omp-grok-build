import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	diffCapturedRequest,
	diffHasFailures,
	formatDiffReport,
	loadTrace,
	loadTraceFile,
} from "../src/diff-trace.ts";
import { buildChatHeaders } from "../src/headers.ts";

const ctx = { version: "1.2.3", platform: "darwin", arch: "arm64", mode: "interactive" };

function chatCapture(headers: Record<string, string>) {
	return {
		url: "https://cli-chat-proxy.grok.com/v1/responses",
		method: "POST",
		headers,
	};
}

describe("capture diff", () => {
	it("accepts a request that matches the plugin and flags a stale version", () => {
		const headers = buildChatHeaders({
			...ctx,
			accessToken: "secret-token",
			sessionId: "11111111-1111-4111-8111-111111111111",
			requestId: "22222222-2222-4222-8222-222222222222",
			agentId: "33333333-3333-4333-8333-333333333333",
			turnIndex: 2,
			modelId: "grok-4.7",
		});
		const ok = diffCapturedRequest(chatCapture(headers), ctx);
		assert.equal(diffHasFailures(ok), false);
		assert.equal(formatDiffReport([ok], ctx).includes("secret-token"), false);

		const stale = diffCapturedRequest(
			chatCapture({ ...headers, "x-grok-client-version": "0.2.16" }),
			ctx,
		);
		assert.equal(diffHasFailures(stale), true);
		assert.equal(stale.mismatched.some(item => item.name === "x-grok-client-version"), true);
		const report = formatDiffReport([stale], ctx);
		assert.match(report, /plugin version: 1\.2\.3/);
		assert.match(report, /0\.2\.16/);
	});

	it("reads HAR entries and ignores other hosts", () => {
		const headers = buildChatHeaders({
			...ctx,
			accessToken: "secret-token",
			sessionId: "session-1",
			requestId: "req-1",
			agentId: "agent-1",
			turnIndex: 1,
			modelId: "grok-4.7",
		});
		const har = {
			log: {
				entries: [
					{
						request: {
							url: "https://api.x.ai/v1/responses",
							headers: [{ name: "Authorization", value: "Bearer secret-token" }],
						},
					},
					{
						request: {
							url: "https://cli-chat-proxy.grok.com/v1/responses",
							headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
						},
					},
				],
			},
		};
		assert.equal(loadTrace(har).length, 2);
		const dir = mkdtempSync(join(tmpdir(), "grok-har-"));
		const path = join(dir, "trace.har");
		writeFileSync(path, JSON.stringify(har));
		const proxyOnly = loadTraceFile(path);
		assert.equal(proxyOnly.length, 1);
		assert.equal(diffHasFailures(diffCapturedRequest(proxyOnly[0]!, ctx)), false);
	});
});
