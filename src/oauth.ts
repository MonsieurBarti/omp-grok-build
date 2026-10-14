import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CLI_FINGERPRINT } from "./fingerprint.ts";
import { deviceCodeHeaders, type HeaderBuildContext } from "./headers.ts";
import {
	DEVICE_CODE_GRANT,
	XAI_CLIENT_ID,
	XAI_DEFAULTS,
	XAI_DISCOVERY_URL,
	XAI_SCOPE,
} from "./constants.ts";

export interface OAuthCredentials {
	access: string;
	refresh: string;
	expires: number;
	email?: string;
	accountId?: string;
}

export interface OAuthPrompt {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
}

export interface OAuthAuthInfo {
	url: string;
	launchUrl?: string;
	instructions?: string;
}

export interface OAuthLoginCallbacks {
	onAuth: (info: OAuthAuthInfo) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	signal?: AbortSignal;
	fetch?: typeof fetch;
}

export type LoginMethod = "device" | "pkce" | "import";

const ACCESS_SKEW_MS = 60_000;
const DISCOVERY_TIMEOUT_MS = 12_000;
const TOKEN_TIMEOUT_MS = 20_000;
const USERINFO_TIMEOUT_MS = 10_000;

export interface XaiEndpoints {
	authorizationEndpoint: string;
	tokenEndpoint: string;
	deviceAuthorizationEndpoint: string;
	userinfoEndpoint: string;
}

export function validateXaiHttps(url: string, field: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid xAI ${field}: ${url}`);
	}
	const host = parsed.hostname.toLowerCase();
	const allowed =
		host === "auth.x.ai" ||
		host === "accounts.x.ai" ||
		host.endsWith(".auth.x.ai") ||
		host.endsWith(".accounts.x.ai");
	if (parsed.protocol !== "https:" || !allowed) {
		throw new Error(`Invalid xAI ${field}: ${url}`);
	}
	return parsed.toString();
}

export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) return undefined;
	try {
		const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padLen = (4 - (padded.length % 4)) % 4;
		const json = Buffer.from(padded + "=".repeat(padLen), "base64").toString("utf8");
		const payload: unknown = JSON.parse(json);
		return isRecord(payload) ? payload : undefined;
	} catch {
		return undefined;
	}
}

/** principal_id, then sub. Two accounts stay distinct in omp's credential store. */
export function accountIdFromAccessToken(access: string): string | undefined {
	const payload = decodeJwtPayload(access);
	if (!payload) return undefined;
	const principal = typeof payload.principal_id === "string" ? payload.principal_id.trim() : "";
	if (principal) return principal;
	const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
	return sub || undefined;
}

export function emailFromIdToken(idToken: string | undefined): string | undefined {
	if (!idToken) return undefined;
	const payload = decodeJwtPayload(idToken);
	const email = payload && typeof payload.email === "string" ? payload.email.trim() : "";
	return email || undefined;
}

export function pkcePair(bytes: () => Buffer = () => randomBytes(32)): {
	verifier: string;
	challenge: string;
} {
	const verifier = bytes().toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

export function buildAuthorizeUrl(input: {
	authorizationEndpoint: string;
	redirectUri: string;
	challenge: string;
	state: string;
	nonce: string;
}): string {
	const endpoint = validateXaiHttps(input.authorizationEndpoint, "authorization_endpoint");
	const url = new URL(endpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", XAI_CLIENT_ID);
	url.searchParams.set("redirect_uri", input.redirectUri);
	url.searchParams.set("scope", XAI_SCOPE);
	url.searchParams.set("code_challenge", input.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", input.state);
	url.searchParams.set("nonce", input.nonce);
	return url.toString();
}

export function authorizationCodeBody(input: {
	code: string;
	redirectUri: string;
	verifier: string;
	challenge: string;
}): URLSearchParams {
	if (!input.verifier) throw new Error("PKCE code_verifier is empty");
	return new URLSearchParams({
		grant_type: "authorization_code",
		client_id: XAI_CLIENT_ID,
		code: input.code,
		redirect_uri: input.redirectUri,
		code_verifier: input.verifier,
		code_challenge: input.challenge,
		code_challenge_method: "S256",
	});
}

export function deviceCodeBody(): URLSearchParams {
	return new URLSearchParams({
		client_id: XAI_CLIENT_ID,
		scope: XAI_SCOPE,
		referrer: CLI_FINGERPRINT.deviceReferrer,
	});
}

export function deviceTokenBody(deviceCode: string): URLSearchParams {
	return new URLSearchParams({
		grant_type: DEVICE_CODE_GRANT,
		client_id: XAI_CLIENT_ID,
		device_code: deviceCode,
	});
}

export function refreshTokenBody(refreshToken: string): URLSearchParams {
	return new URLSearchParams({
		grant_type: "refresh_token",
		client_id: XAI_CLIENT_ID,
		refresh_token: refreshToken,
	});
}

export function normalizeLoginMethod(raw: string | undefined): LoginMethod {
	const value = (raw ?? "").trim().toLowerCase();
	if (value === "" || value === "device" || value === "d" || value === "1") return "device";
	if (value === "pkce" || value === "browser" || value === "web" || value === "2") return "pkce";
	if (value === "import" || value === "cli" || value === "3") return "import";
	throw new Error('Grok Build login method must be "device", "pkce", or "import"');
}

export function parseCallbackInput(input: string): { code?: string; state?: string; error?: string } | undefined {
	const trimmed = input.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("?")) {
		try {
			const url = trimmed.startsWith("?")
				? new URL(`http://127.0.0.1/callback${trimmed}`)
				: new URL(trimmed);
			return {
				code: url.searchParams.get("code") ?? undefined,
				state: url.searchParams.get("state") ?? undefined,
				error: url.searchParams.get("error") ?? undefined,
			};
		} catch {
			return undefined;
		}
	}
	if (/^[A-Za-z0-9._-]{8,}$/.test(trimmed)) return { code: trimmed };
	return undefined;
}

interface TokenPayload {
	access: string;
	refresh: string;
	expires: number;
	idToken?: string;
}

export function parseTokenResponse(
	payload: unknown,
	context: string,
	fallbackRefresh?: string,
	now: number = Date.now(),
): TokenPayload {
	if (!isRecord(payload)) throw new Error(`${context} was not a JSON object`);
	const access = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
	if (!access) throw new Error(`${context} missing access_token`);
	const refreshRaw = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
	const refresh = refreshRaw || fallbackRefresh || "";
	if (!refresh) throw new Error(`${context} missing refresh_token`);
	const expiresIn =
		typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
			? payload.expires_in
			: 3600;
	const idToken =
		typeof payload.id_token === "string" && payload.id_token.trim() ? payload.id_token.trim() : undefined;
	return {
		access,
		refresh,
		expires: now + Math.max(0, expiresIn) * 1000 - ACCESS_SKEW_MS,
		...(idToken ? { idToken } : {}),
	};
}

function applyIdentity(
	token: TokenPayload,
	previous?: Pick<OAuthCredentials, "email" | "accountId">,
	userinfoEmail?: string,
): OAuthCredentials {
	const accountId = accountIdFromAccessToken(token.access) ?? previous?.accountId;
	const email = emailFromIdToken(token.idToken) ?? userinfoEmail ?? previous?.email;
	return {
		access: token.access,
		refresh: token.refresh,
		expires: token.expires,
		...(accountId ? { accountId } : {}),
		...(email ? { email } : {}),
	};
}

async function fetchUserinfoEmail(
	access: string,
	userinfoEndpoint: string,
	fetchImpl: typeof fetch,
	signal?: AbortSignal,
): Promise<string | undefined> {
	try {
		const response = await fetchImpl(validateXaiHttps(userinfoEndpoint, "userinfo_endpoint"), {
			method: "GET",
			headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(USERINFO_TIMEOUT_MS)])
				: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		const payload: unknown = await response.json();
		if (!isRecord(payload)) return undefined;
		const email = typeof payload.email === "string" ? payload.email.trim() : "";
		return email || undefined;
	} catch {
		return undefined;
	}
}

export async function discoverEndpoints(
	fetchImpl: typeof fetch,
	signal?: AbortSignal,
): Promise<XaiEndpoints> {
	let payload: unknown;
	try {
		const response = await fetchImpl(XAI_DISCOVERY_URL, {
			headers: { Accept: "application/json" },
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)])
				: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`status ${response.status}`);
		payload = await response.json();
	} catch (error) {
		throw new Error(
			`xAI OIDC discovery failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(payload)) throw new Error("xAI OIDC discovery was not a JSON object");
	const authorization = stringField(payload.authorization_endpoint) ?? XAI_DEFAULTS.authorizationEndpoint;
	const token = stringField(payload.token_endpoint) ?? XAI_DEFAULTS.tokenEndpoint;
	const device =
		stringField(payload.device_authorization_endpoint) ?? XAI_DEFAULTS.deviceAuthorizationEndpoint;
	const userinfo = stringField(payload.userinfo_endpoint) ?? XAI_DEFAULTS.userinfoEndpoint;
	return {
		authorizationEndpoint: validateXaiHttps(authorization, "authorization_endpoint"),
		tokenEndpoint: validateXaiHttps(token, "token_endpoint"),
		deviceAuthorizationEndpoint: validateXaiHttps(device, "device_authorization_endpoint"),
		userinfoEndpoint: validateXaiHttps(userinfo, "userinfo_endpoint"),
	};
}

export interface GrokCliAuthFileEntry {
	accessToken: string;
	refreshToken?: string;
	email?: string;
}

/** Read `~/.grok/auth.json` without writing it. Import copies tokens into omp's store. */
export function readGrokCliAuth(path: string = defaultGrokAuthPath()): GrokCliAuthFileEntry | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8").trim();
	} catch {
		return undefined;
	}
	if (!raw) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;

	for (const [key, value] of Object.entries(parsed)) {
		if (!key.startsWith("https://auth.x.ai::") || !key.includes(XAI_CLIENT_ID)) continue;
		const entry = readAuthEntry(value);
		if (entry) return entry;
	}
	const legacy = parsed["https://accounts.x.ai/sign-in"];
	return readAuthEntry(legacy);
}

export function defaultGrokAuthPath(): string {
	return join(homedir(), ".grok", "auth.json");
}

function readAuthEntry(value: unknown): GrokCliAuthFileEntry | undefined {
	if (!isRecord(value)) return undefined;
	const access =
		stringField(value.key) ?? stringField(value.access_token) ?? stringField(value.token);
	if (!access) return undefined;
	const refresh = stringField(value.refresh_token) ?? stringField(value.refreshToken);
	const email = stringField(value.email);
	return {
		accessToken: access,
		...(refresh ? { refreshToken: refresh } : {}),
		...(email ? { email } : {}),
	};
}

export async function loginGrokBuild(
	callbacks: OAuthLoginCallbacks,
	options: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; authPath?: string; now?: () => number } = {},
): Promise<OAuthCredentials> {
	const choice = await callbacks.onPrompt({
		message: "Grok Build login: device (device code), pkce (browser), or import (~/.grok/auth.json)",
		placeholder: "device",
		allowEmpty: true,
	});
	const method = normalizeLoginMethod(choice);
	if (method === "import") return importCliCredentials(callbacks, options.authPath);
	if (method === "pkce") return loginWithPkce(callbacks, options);
	return loginWithDeviceCode(callbacks, options);
}

export async function refreshGrokBuildToken(
	credentials: OAuthCredentials,
	fetchImpl: typeof fetch = fetch,
	now: () => number = Date.now,
): Promise<OAuthCredentials> {
	if (!credentials.refresh?.trim()) throw new Error("grok-build refresh token is missing");
	const endpoints = await discoverEndpoints(fetchImpl);
	const response = await fetchImpl(endpoints.tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: refreshTokenBody(credentials.refresh),
		signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
	});
	const payload = await readJson(response, "xAI token refresh");
	if (!response.ok) {
		throw new Error(`xAI token refresh failed: ${response.status} ${errorDetail(payload)}`);
	}
	const token = parseTokenResponse(payload, "xAI token refresh", credentials.refresh, now());
	const email = await fetchUserinfoEmail(token.access, endpoints.userinfoEndpoint, fetchImpl);
	return applyIdentity(token, credentials, email);
}

async function importCliCredentials(
	callbacks: OAuthLoginCallbacks,
	authPath: string = defaultGrokAuthPath(),
): Promise<OAuthCredentials> {
	const entry = readGrokCliAuth(authPath);
	if (!entry?.refreshToken) {
		throw new Error(
			`No refreshable Grok CLI login at ${authPath}. Run \`grok login\` or choose device / pkce.`,
		);
	}
	callbacks.onProgress?.("Copied the Grok CLI refresh token into omp. The CLI file was not modified.");
	const fetchImpl = callbacks.fetch ?? fetch;
	return refreshGrokBuildToken(
		{
			access: entry.accessToken,
			refresh: entry.refreshToken,
			expires: 0,
			...(entry.email ? { email: entry.email } : {}),
		},
		fetchImpl,
	);
}

async function loginWithDeviceCode(
	callbacks: OAuthLoginCallbacks,
	options: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number },
): Promise<OAuthCredentials> {
	const fetchImpl = callbacks.fetch ?? fetch;
	const sleep = options.sleep ?? delay;
	const now = options.now ?? Date.now;
	const endpoints = await discoverEndpoints(fetchImpl, callbacks.signal);
	const headerCtx: HeaderBuildContext = {};
	const response = await fetchImpl(endpoints.deviceAuthorizationEndpoint, {
		method: "POST",
		headers: deviceCodeHeaders(headerCtx),
		body: deviceCodeBody(),
		signal: withTimeout(callbacks.signal, TOKEN_TIMEOUT_MS),
	});
	const payload = await readJson(response, "xAI device-code");
	if (!response.ok || !isRecord(payload)) {
		throw new Error(`xAI device-code request failed: ${response.status} ${errorDetail(payload)}`);
	}
	const deviceCode = stringField(payload.device_code);
	const userCode = stringField(payload.user_code);
	const verification =
		stringField(payload.verification_uri_complete) ?? stringField(payload.verification_uri);
	if (!deviceCode || !userCode || !verification) {
		throw new Error("xAI device-code response was missing device_code, user_code, or verification_uri");
	}
	const url = validateXaiHttps(verification, "verification_uri");
	const expiresIn = positiveSeconds(payload.expires_in) ?? 15 * 60;
	let intervalMs = (positiveSeconds(payload.interval) ?? 5) * 1000;
	callbacks.onAuth({
		url,
		instructions: `Enter code ${userCode}`,
	});
	callbacks.onProgress?.("Waiting for Grok Build device authorization…");
	const deadline = now() + expiresIn * 1000;

	while (now() < deadline) {
		throwIfAborted(callbacks.signal);
		const polled = await fetchImpl(endpoints.tokenEndpoint, {
			method: "POST",
			headers: deviceCodeHeaders(headerCtx),
			body: deviceTokenBody(deviceCode),
			signal: withTimeout(callbacks.signal, TOKEN_TIMEOUT_MS),
		});
		const body = await readJson(polled, "xAI device token");
		if (polled.ok) {
			const token = parseTokenResponse(body, "xAI device token", undefined, now());
			const email = await fetchUserinfoEmail(
				token.access,
				endpoints.userinfoEndpoint,
				fetchImpl,
				callbacks.signal,
			);
			return applyIdentity(token, undefined, email);
		}
		const error = isRecord(body) ? stringField(body.error) : undefined;
		if (error === "authorization_pending") {
			await sleep(intervalMs, callbacks.signal);
			continue;
		}
		if (error === "slow_down") {
			intervalMs += 1000;
			await sleep(intervalMs, callbacks.signal);
			continue;
		}
		throw new Error(`xAI device-code token polling failed: ${errorDetail(body) || polled.status}`);
	}
	throw new Error("xAI device authorization timed out");
}

async function loginWithPkce(
	callbacks: OAuthLoginCallbacks,
	options: { now?: () => number },
): Promise<OAuthCredentials> {
	const fetchImpl = callbacks.fetch ?? fetch;
	const endpoints = await discoverEndpoints(fetchImpl, callbacks.signal);
	const loopback = await startLoopback();
	try {
		const { verifier, challenge } = pkcePair();
		const state = randomUUID().replace(/-/g, "");
		const nonce = randomUUID().replace(/-/g, "");
		const authorizeUrl = buildAuthorizeUrl({
			authorizationEndpoint: endpoints.authorizationEndpoint,
			redirectUri: loopback.redirectUri,
			challenge,
			state,
			nonce,
		});
		callbacks.onAuth({
			url: authorizeUrl,
			instructions:
				"Finish in the browser. If it does not redirect, paste the full redirect URL or the code.",
		});
		callbacks.onProgress?.(`Waiting for the OAuth callback on ${loopback.redirectUri}…`);

		const pastePromise = (callbacks.onManualCodeInput ?? (() => callbacks.onPrompt({
			message: "Paste the redirect URL or authorization code (leave empty if the browser redirects)",
			allowEmpty: true,
		})))();

		let ignoreWaitError = false;
		const callback = await Promise.race([
			loopback.wait(callbacks.signal).catch(error => {
				if (ignoreWaitError) return new Promise<never>(() => {});
				throw error;
			}),
			pastePromise.then(text => {
				const parsed = parseCallbackInput(text ?? "");
				if (!parsed?.code && !parsed?.error) {
					return new Promise<never>(() => {
						/* browser callback wins; empty paste does not resolve */
					});
				}
				return parsed;
			}),
		]);
		ignoreWaitError = true;

		if (callback.error) throw new Error(`xAI authorization failed: ${callback.error}`);
		if (callback.state && callback.state !== state) throw new Error("xAI authorization state mismatch");
		if (!callback.code) throw new Error("xAI authorization returned no code");

		const response = await fetchImpl(endpoints.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: authorizationCodeBody({
				code: callback.code,
				redirectUri: loopback.redirectUri,
				verifier,
				challenge,
			}),
			signal: withTimeout(callbacks.signal, TOKEN_TIMEOUT_MS),
		});
		const payload = await readJson(response, "xAI authorization-code exchange");
		if (!response.ok) {
			throw new Error(`xAI token exchange failed: ${response.status} ${errorDetail(payload)}`);
		}
		const token = parseTokenResponse(payload, "xAI token exchange", undefined, (options.now ?? Date.now)());
		const email = await fetchUserinfoEmail(
			token.access,
			endpoints.userinfoEndpoint,
			fetchImpl,
			callbacks.signal,
		);
		return applyIdentity(token, undefined, email);
	} finally {
		loopback.close();
	}
}

function startLoopback(): Promise<{
	redirectUri: string;
	wait: (signal?: AbortSignal) => Promise<{ code?: string; state?: string; error?: string }>;
	close: () => void;
}> {
	return new Promise((resolve, reject) => {
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const origin = req.headers.origin;
			if (origin === "https://auth.x.ai" || origin === "https://accounts.x.ai") {
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
				res.setHeader("Vary", "Origin");
			}
			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname !== "/callback") {
				res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("Not found");
				return;
			}
			const result = {
				code: url.searchParams.get("code") ?? undefined,
				state: url.searchParams.get("state") ?? undefined,
				error: url.searchParams.get("error") ?? undefined,
			};
			finish(result);
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(
				result.error
					? "<!doctype html><p>Grok Build login failed. You can close this tab.</p>"
					: "<!doctype html><p>Grok Build login received. You can close this tab.</p>",
			);
		});

		let finish: (result: { code?: string; state?: string; error?: string }) => void = () => {};
		const waited = new Promise<{ code?: string; state?: string; error?: string }>(resolveWait => {
			finish = resolveWait;
		});
		const closed = new AbortController();

		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Could not bind the Grok Build OAuth callback"));
				return;
			}
			resolve({
				redirectUri: `http://127.0.0.1:${address.port}/callback`,
				wait: signal =>
					new Promise((resolveWait, rejectWait) => {
						const timer = setTimeout(() => rejectWait(new Error("xAI OAuth callback timed out")), 180_000);
						const onAbort = () => {
							clearTimeout(timer);
							rejectWait(new Error("Login cancelled"));
						};
						closed.signal.addEventListener("abort", onAbort, { once: true });
						signal?.addEventListener("abort", onAbort, { once: true });
						waited.then(
							result => {
								clearTimeout(timer);
								resolveWait(result);
							},
							error => {
								clearTimeout(timer);
								rejectWait(error);
							},
						);
					}),
				close: () => {
					closed.abort();
					server.close();
				},
			});
		});
	});
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("Login cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Login cancelled");
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readJson(response: Response, context: string): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error(`${context} returned invalid JSON (${response.status})`);
	}
}

function errorDetail(payload: unknown): string {
	if (!isRecord(payload)) return "";
	const description = stringField(payload.error_description);
	const error = stringField(payload.error);
	return description || error || "";
}

function stringField(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function positiveSeconds(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
