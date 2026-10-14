import { FORBIDDEN_API_HOSTS, FORBIDDEN_API_KEY_ENV, GROK_BUILD_BASE_URL } from "./constants.ts";

/**
 * Refuse API-key credentials. This provider never reads XAI_API_KEY as a
 * login source. The comparison below only rejects a token that is that env
 * value, or that has the public `xai-…` API-key shape (no JWT dots).
 */
export function assertOAuthAccessToken(token: unknown): string {
	if (typeof token !== "string" || !token.trim()) {
		throw new Error(
			"grok-build requires a Grok Build OAuth access token. Run /login and choose Grok Build. XAI_API_KEY is not used.",
		);
	}
	const access = token.trim();
	if (access === FORBIDDEN_API_KEY_ENV) {
		throw new Error(
			"grok-build refused the literal XAI_API_KEY. There is no API-key fallback onto api.x.ai.",
		);
	}
	const fromEnv = process.env[FORBIDDEN_API_KEY_ENV];
	if (typeof fromEnv === "string" && fromEnv.length > 0 && access === fromEnv) {
		throw new Error(
			"grok-build refused XAI_API_KEY. Log in with /login. This provider does not call api.x.ai.",
		);
	}
	if (access.startsWith("xai-") && !access.includes(".")) {
		throw new Error(
			"grok-build refused an xAI API key. Log in with /login for a Build OAuth token.",
		);
	}
	return access;
}

export function assertBuildBaseUrl(url: string = GROK_BUILD_BASE_URL): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`grok-build refused an invalid base URL: ${url}`);
	}
	const host = parsed.hostname.toLowerCase();
	if ((FORBIDDEN_API_HOSTS as readonly string[]).includes(host) || host !== "cli-chat-proxy.grok.com") {
		throw new Error(
			`grok-build only talks to cli-chat-proxy.grok.com (refused ${host}). api.x.ai is the API-quota path and is not a fallback.`,
		);
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`grok-build refused a non-HTTPS base URL: ${url}`);
	}
	return url.replace(/\/+$/, "");
}
