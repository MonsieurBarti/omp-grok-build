import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BILLING_URL } from "../src/constants.ts";
import { billingToUsageReport, fetchGrokBuildUsage, grokBuildUsageProvider, parseBillingPayload } from "../src/usage.ts";
import { jsonResponse } from "./helpers.ts";

describe("usage", () => {
	it("maps weekly Build credits into an omp usage report", async () => {
		const billing = parseBillingPayload({
			config: {
				creditUsagePercent: 9,
				currentPeriod: {
					start: "2026-10-08T00:00:00Z",
					end: "2026-10-15T00:00:00Z",
					type: "USAGE_PERIOD_TYPE_WEEKLY",
				},
				productUsage: [
					{ product: "GrokBuild", usagePercent: 9 },
					{ product: "Api", usagePercent: 40 },
				],
			},
		});
		assert.ok(billing);
		assert.equal(billing?.weekly, true);
		const report = billingToUsageReport({
			billing: billing!,
			accountId: "acct-a",
			email: "a@example.com",
			fetchedAt: 10,
		});
		assert.equal(report.provider, "grok-build");
		assert.equal(report.limits[0]?.label, "Weekly credits");
		assert.equal(report.limits[0]?.amount.used, 9);
		assert.equal(report.limits[0]?.window?.label, "Weekly");
		assert.equal(report.limits[1]?.label, "Grok Build");
		assert.equal(report.metadata?.accountId, "acct-a");

		let url = "";
		const fetched = await fetchGrokBuildUsage({
			accessToken: "oauth-access-token",
			accountId: "acct-a",
			headerCtx: { version: "1.2.3", platform: "linux", arch: "x64" },
			fetchImpl: async (input, init) => {
				url = String(input);
				const headers = new Headers(init?.headers);
				assert.equal(headers.get("x-xai-token-auth"), "xai-grok-cli");
				assert.equal(headers.get("authorization"), "Bearer oauth-access-token");
				return jsonResponse({
					config: {
						creditUsagePercent: 12,
						currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-10-15T00:00:00Z" },
						productUsage: [{ product: "GrokBuild", usagePercent: 12 }],
					},
				});
			},
		});
		assert.equal(url, BILLING_URL);
		assert.equal(fetched?.limits[0]?.amount.used, 12);
		assert.equal(await fetchGrokBuildUsage({
			accessToken: "oauth-access-token",
			fetchImpl: async () => jsonResponse({ error: "no" }, 404),
		}), null);
	});

	it("does not query usage for an API key credential", async () => {
		assert.equal(
			grokBuildUsageProvider.supports({
				provider: "grok-build",
				credential: { type: "api_key", apiKey: "xai-key" },
			}),
			false,
		);
		const report = await grokBuildUsageProvider.fetchUsage(
			{ provider: "grok-build", credential: { type: "api_key", apiKey: "xai-key" } },
			{ fetch: async () => { throw new Error("should not fetch"); } },
		);
		assert.equal(report, null);
		assert.equal(
			grokBuildUsageProvider.supports({
				provider: "grok-build",
				credential: { type: "oauth", accessToken: "oauth-access-token", accountId: "acct-a" },
			}),
			true,
		);
	});
});
