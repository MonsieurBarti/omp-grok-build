import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

import { prepareGrokBuildCall } from "../src/stream.ts";
import { jwt } from "./helpers.ts";

const RESPONSES_CANDIDATES = [
	process.env.OMP_PI_AI_RESPONSES,
	`${homedir()}/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-responses.ts`,
	"/home/ubuntu/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-responses.ts",
].filter((value): value is string => Boolean(value));

function responsesEntry(): string {
	for (const path of RESPONSES_CANDIDATES) {
		if (existsSync(path)) return path;
	}
	throw new Error(
		"omp 18.10.4 pi-ai was not found. Install @oh-my-pi/pi-coding-agent or set OMP_PI_AI_RESPONSES.",
	);
}

function sseBody(): string {
	const message = {
		type: "message",
		id: "msg_1",
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text: "OK" }],
	};
	const events: [string, unknown][] = [
		[
			"response.output_item.added",
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { ...message, status: "in_progress", content: [] },
			},
		],
		[
			"response.output_text.delta",
			{
				type: "response.output_text.delta",
				output_index: 0,
				content_index: 0,
				item_id: "msg_1",
				delta: "OK",
			},
		],
		["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: message }],
		[
			"response.completed",
			{
				type: "response.completed",
				response: { id: "resp_1", object: "response", status: "completed", output: [message] },
			},
		],
	];
	return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("") + "data: [DONE]\n\n";
}

function listen(): Promise<{ server: Server; baseUrl: string }> {
	const server = createServer((req, res) => {
		if (req.method !== "POST" || !req.url?.includes("/responses")) {
			res.writeHead(404);
			res.end();
			return;
		}
		res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
		res.end(sseBody());
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("no port"));
				return;
			}
			resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` });
		});
	});
}

function errorText(event: { error?: { errorMessage?: string; stopReason?: string } }): string {
	return event.error?.errorMessage ?? event.error?.stopReason ?? JSON.stringify(event.error);
}

const context = { messages: [{ role: "user" as const, content: "Réponds juste: OK", timestamp: Date.now() }] };

const { streamOpenAIResponses } = await import(responsesEntry());
const { server, baseUrl } = await listen();

try {
	const missing = {
		id: "grok-4.7",
		api: "openai-responses",
		provider: "grok-build",
		baseUrl,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 500_000,
		maxTokens: 128_000,
	};
	let crashed = "";
	for await (const event of streamOpenAIResponses(missing, context, {
		apiKey: "test",
		providerSessionState: new Map(),
	})) {
		if (event.type === "error") crashed = errorText(event);
	}
	assert.match(crashed, /connectionBoundNativeHistory/);

	const prepared = prepareGrokBuildCall(
		{
			id: "grok-4.7",
			name: "Grok 4.7",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
			contextWindow: 500_000,
			maxTokens: 128_000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high", "xhigh"],
				defaultLevel: "high",
			},
			identity: { class: "xai", family: "grok", revision: "4.7.0" },
		},
		context,
		{ apiKey: jwt({ sub: "acct" }), sessionId: "transport-session" },
		{ version: "1.2.3", platform: "linux", arch: "x64" },
	);
	assert.equal(prepared.model.compat?.connectionBoundNativeHistory, false);
	const wired = {
		...prepared.model,
		baseUrl,
		api: "openai-responses" as const,
		name: "Grok 4.7",
		identity: { class: "xai", family: "grok", revision: "4.7.0" },
	};
	let text = "";
	let failed = "";
	for await (const event of streamOpenAIResponses(wired, context, {
		apiKey: jwt({ sub: "acct" }),
		headers: prepared.headers,
		providerSessionState: new Map(),
		sessionId: "transport-session",
	})) {
		if (event.type === "text_delta") text += event.delta;
		if (event.type === "error") failed = errorText(event);
	}
	assert.equal(failed, "");
	assert.equal(text, "OK");
	console.log("transport: streamed OK through streamOpenAIResponses with grok-build compat");
} finally {
	await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}
