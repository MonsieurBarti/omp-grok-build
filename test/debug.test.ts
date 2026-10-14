import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { debugStatusText, grokBuildDebugEnabled, redactHeaders, redactValue, rememberModelsPayload } from "../src/debug.ts";
import { jwt } from "./helpers.ts";

describe("debug redaction", () => {
	it("strips bearer tokens and JWTs from logged payloads", () => {
		const token = jwt({ sub: "acct", email: "a@example.com" });
		const redacted = JSON.stringify(
			redactValue({
				Authorization: `Bearer ${token}`,
				note: `token ${token}`,
				nested: { access_token: token, ok: true },
			}),
		);
		assert.equal(redacted.includes(token), false);
		assert.equal(redacted.includes("eyJ"), false);
		assert.equal(redacted.includes("[redacted]"), true);
		const headers = redactHeaders({ Authorization: `Bearer ${token}`, "x-grok-client-identifier": "grok-shell" });
		assert.equal(headers.Authorization, "[redacted]");
		assert.equal(headers["x-grok-client-identifier"], "grok-shell");
	});

	it("records a models summary without the access token", () => {
		const token = jwt({ sub: "acct" });
		rememberModelsPayload({
			data: [
				{ id: "grok-4.7", context_window: 256000, reasoning_effort: "high", access_token: token },
			],
		});
		const status = debugStatusText();
		assert.match(status, /grok-4\.7/);
		assert.match(status, /256000/);
		assert.equal(status.includes(token), false);
		assert.equal(grokBuildDebugEnabled({}), false);
		assert.equal(grokBuildDebugEnabled({ GROK_BUILD_DEBUG: "1" }), true);
	});
});
