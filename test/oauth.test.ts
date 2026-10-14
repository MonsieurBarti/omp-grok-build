import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { XAI_CLIENT_ID, XAI_SCOPE } from "../src/constants.ts";
import {
	accountIdFromAccessToken,
	authorizationCodeBody,
	buildAuthorizeUrl,
	deviceCodeBody,
	deviceTokenBody,
	loginGrokBuild,
	normalizeLoginMethod,
	parseCallbackInput,
	parseTokenResponse,
	pkcePair,
	readGrokCliAuth,
	refreshGrokBuildToken,
	refreshTokenBody,
	validateXaiHttps,
} from "../src/oauth.ts";
import { deviceCodeHeaders } from "../src/headers.ts";
import { discoveryDocument, jsonResponse, jwt } from "./helpers.ts";

describe("oauth", () => {
	it("pins token endpoints to https x.ai hosts", () => {
		assert.equal(
			validateXaiHttps("https://auth.x.ai/oauth2/token", "token_endpoint").startsWith(
				"https://auth.x.ai/oauth2/token",
			),
			true,
		);
		assert.throws(() => validateXaiHttps("http://auth.x.ai/oauth2/token", "token_endpoint"));
		assert.throws(() => validateXaiHttps("https://api.x.ai/v1", "token_endpoint"));
		assert.throws(() => validateXaiHttps("https://evil.example/token", "token_endpoint"));
	});

	it("builds a PKCE S256 authorize URL for the public CLI client", () => {
		const { verifier, challenge } = pkcePair();
		assert.notEqual(verifier, challenge);
		const url = new URL(
			buildAuthorizeUrl({
				authorizationEndpoint: "https://auth.x.ai/oauth2/authorize",
				redirectUri: "http://127.0.0.1:56121/callback",
				challenge,
				state: "state-1",
				nonce: "nonce-1",
			}),
		);
		assert.equal(url.origin, "https://auth.x.ai");
		assert.equal(url.searchParams.get("response_type"), "code");
		assert.equal(url.searchParams.get("client_id"), XAI_CLIENT_ID);
		assert.equal(url.searchParams.get("scope"), XAI_SCOPE);
		assert.equal(url.searchParams.get("code_challenge"), challenge);
		assert.equal(url.searchParams.get("code_challenge_method"), "S256");
		assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:56121/callback");
		assert.equal(url.searchParams.get("client_secret"), null);
	});

	it("echoes the PKCE challenge on the authorization-code token body", () => {
		const body = authorizationCodeBody({
			code: "abc",
			redirectUri: "http://127.0.0.1:9/callback",
			verifier: "verifier",
			challenge: "challenge",
		});
		assert.equal(body.get("grant_type"), "authorization_code");
		assert.equal(body.get("client_id"), XAI_CLIENT_ID);
		assert.equal(body.get("code_verifier"), "verifier");
		assert.equal(body.get("code_challenge"), "challenge");
		assert.equal(body.get("code_challenge_method"), "S256");
		assert.equal(body.get("client_secret"), null);
	});

	it("requests a device code with the CLI client, scope, and referrer", () => {
		const body = deviceCodeBody();
		assert.equal(body.get("client_id"), XAI_CLIENT_ID);
		assert.equal(body.get("scope"), XAI_SCOPE);
		assert.equal(body.get("referrer"), "grok-build");
		assert.equal(body.get("client_secret"), null);
		const token = deviceTokenBody("device-1");
		assert.equal(token.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
		assert.equal(token.get("device_code"), "device-1");
		const headers = deviceCodeHeaders({ version: "1.0.46" });
		assert.equal(headers["x-grok-client-version"], "1.0.46");
		assert.equal(headers["x-grok-client-surface"], "cli");
	});

	it("refreshes with the public client and keeps the previous refresh token", () => {
		const body = refreshTokenBody("refresh-1");
		assert.equal(body.get("grant_type"), "refresh_token");
		assert.equal(body.get("client_id"), XAI_CLIENT_ID);
		assert.equal(body.get("refresh_token"), "refresh-1");
		assert.equal(body.get("client_secret"), null);
		const parsed = parseTokenResponse(
			{ access_token: "new-access", expires_in: 3600 },
			"refresh",
			"refresh-1",
			1_000_000,
		);
		assert.equal(parsed.refresh, "refresh-1");
		assert.equal(parsed.expires, 1_000_000 + 3600 * 1000 - 60_000);
	});

	it("distinguishes accounts by principal_id, then sub", () => {
		const a = accountIdFromAccessToken(jwt({ principal_id: "acct-a", sub: "sub-a" }));
		const b = accountIdFromAccessToken(jwt({ sub: "acct-b" }));
		assert.equal(a, "acct-a");
		assert.equal(b, "acct-b");
		assert.notEqual(a, b);
	});

	it("completes device-code login and stores email plus account id", async () => {
		const access = jwt({ principal_id: "acct-a", sub: "sub-a" });
		const idToken = jwt({ email: "a@example.com" });
		const calls: { url: string; body?: string; headers?: Record<string, string> }[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			const body = typeof init?.body === "string" || init?.body instanceof URLSearchParams
				? String(init.body)
				: undefined;
			const headers = headersOf(init?.headers);
			calls.push({ url, ...(body ? { body } : {}), headers });
			if (url.includes("openid-configuration")) return jsonResponse(discoveryDocument());
			if (url.includes("/device/code")) {
				return jsonResponse({
					device_code: "dev-1",
					user_code: "ABCD-EFGH",
					verification_uri_complete: "https://auth.x.ai/device?user_code=ABCD-EFGH",
					expires_in: 60,
					interval: 1,
				});
			}
			if (url.includes("/token") && calls.filter(call => call.url.includes("/token")).length === 1) {
				return jsonResponse({ error: "authorization_pending" }, 400);
			}
			if (url.includes("/token")) {
				return jsonResponse({
					access_token: access,
					refresh_token: "refresh-a",
					expires_in: 3600,
					id_token: idToken,
				});
			}
			if (url.includes("/userinfo")) return jsonResponse({}, 404);
			throw new Error(`unexpected ${url}`);
		};

		const credential = await loginGrokBuild(
			{
				onAuth(info) {
					assert.match(info.url, /^https:\/\/auth\.x\.ai\//);
					assert.match(info.instructions ?? "", /ABCD-EFGH/);
				},
				onPrompt: async () => "device",
				fetch: fetchImpl,
			},
			{ sleep: async () => {} },
		);
		assert.equal(credential.access, access);
		assert.equal(credential.refresh, "refresh-a");
		assert.equal(credential.accountId, "acct-a");
		assert.equal(credential.email, "a@example.com");
		const deviceCall = calls.find(call => call.url.includes("/device/code"));
		assert.equal(deviceCall?.headers?.["x-grok-client-surface"], "cli");
		assert.match(deviceCall?.body ?? "", /client_id=b1a00492-073a-47ea-816f-4c329264a828/);
		assert.equal(calls.some(call => call.url.includes("api.x.ai")), false);
	});

	it("refreshes one account without dropping its identity", async () => {
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.includes("openid-configuration")) return jsonResponse(discoveryDocument());
			if (url.includes("/token")) {
				assert.match(String(init?.body), /grant_type=refresh_token/);
				assert.doesNotMatch(String(init?.body), /client_secret/);
				return jsonResponse({
					access_token: "opaque-access",
					expires_in: 120,
				});
			}
			if (url.includes("/userinfo")) return jsonResponse({}, 500);
			throw new Error(url);
		};
		const next = await refreshGrokBuildToken(
			{
				access: jwt({ sub: "acct-b" }),
				refresh: "refresh-b",
				expires: 1,
				email: "b@example.com",
				accountId: "acct-b",
			},
			fetchImpl,
			() => 5_000,
		);
		assert.equal(next.access, "opaque-access");
		assert.equal(next.refresh, "refresh-b");
		assert.equal(next.accountId, "acct-b");
		assert.equal(next.email, "b@example.com");
	});

	it("imports a CLI auth.json by refreshing that account into omp's shape", async () => {
		const dir = mkdtempSync(join(tmpdir(), "grok-auth-"));
		const path = join(dir, "auth.json");
		writeFileSync(
			path,
			JSON.stringify({
				[`https://auth.x.ai::${XAI_CLIENT_ID}`]: {
					key: jwt({ sub: "imported" }),
					refresh_token: "refresh-import",
					email: "imported@example.com",
				},
			}),
		);
		assert.equal(readGrokCliAuth(path)?.refreshToken, "refresh-import");
		const fetchImpl: typeof fetch = async input => {
			const url = String(input);
			if (url.includes("openid-configuration")) return jsonResponse(discoveryDocument());
			if (url.includes("/token")) {
				return jsonResponse({ access_token: jwt({ sub: "imported" }), expires_in: 60 });
			}
			return jsonResponse({}, 404);
		};
		const credential = await loginGrokBuild(
			{ onAuth() {}, onPrompt: async () => "import", fetch: fetchImpl },
			{ authPath: path },
		);
		assert.equal(credential.accountId, "imported");
		assert.equal(credential.email, "imported@example.com");
		assert.equal(credential.refresh, "refresh-import");
	});

	it("exchanges a PKCE browser code with verifier and challenge", async () => {
		const access = jwt({ sub: "pkce-user" });
		let authorize = "";
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.includes("openid-configuration")) return jsonResponse(discoveryDocument());
			if (url.includes("/token")) {
				const body = String(init?.body);
				assert.match(body, /grant_type=authorization_code/);
				assert.match(body, /code=auth-code-1/);
				assert.match(body, /code_verifier=/);
				assert.match(body, /code_challenge=/);
				assert.match(body, /code_challenge_method=S256/);
				assert.doesNotMatch(body, /client_secret/);
				assert.match(body, /redirect_uri=/);
				return jsonResponse({
					access_token: access,
					refresh_token: "refresh-pkce",
					expires_in: 3600,
					id_token: jwt({ email: "pkce@example.com" }),
				});
			}
			return jsonResponse({}, 404);
		};
		const credential = await loginGrokBuild(
			{
				onAuth(info) {
					authorize = info.url;
				},
				onPrompt: async () => "pkce",
				onManualCodeInput: async () => "auth-code-1",
				fetch: fetchImpl,
			},
		);
		const url = new URL(authorize);
		assert.equal(url.searchParams.get("code_challenge_method"), "S256");
		assert.equal(url.searchParams.get("client_id"), XAI_CLIENT_ID);
		assert.match(url.searchParams.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
		assert.equal(credential.accountId, "pkce-user");
		assert.equal(credential.email, "pkce@example.com");
		assert.equal(credential.refresh, "refresh-pkce");
	});

	it("parses redirect URLs and bare codes", () => {
		assert.equal(normalizeLoginMethod(""), "device");
		assert.equal(normalizeLoginMethod("PKCE"), "pkce");
		assert.equal(normalizeLoginMethod("import"), "import");
		assert.deepEqual(parseCallbackInput("https://auth.x.ai/done?code=abc&state=s"), {
			code: "abc",
			state: "s",
			error: undefined,
		});
		assert.deepEqual(parseCallbackInput("plain-code-value"), { code: "plain-code-value" });
	});
});

function headersOf(headers: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers) return out;
	const asHeaders = new Headers(headers);
	asHeaders.forEach((value, key) => {
		out[key] = value;
	});
	return out;
}
