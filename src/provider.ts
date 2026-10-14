import { GROK_BUILD_API, GROK_BUILD_BASE_URL, PROVIDER_ID } from "./constants.ts";
import { discoverModels } from "./discovery.ts";
import { buildStaticHeaders, type HeaderBuildContext } from "./headers.ts";
import {
	loginGrokBuild,
	refreshGrokBuildToken,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
} from "./oauth.ts";
import { assertOAuthAccessToken } from "./auth-guard.ts";
import { grokBuildUsageProvider } from "./usage.ts";
import type { StreamModel, StreamOptions, Transports } from "./stream.ts";
import { streamGrokBuild } from "./stream.ts";

export interface GrokBuildProviderConfig {
	baseUrl: string;
	api: string;
	authHeader: true;
	headers: Record<string, string>;
	fetchDynamicModels: (apiKey: string | undefined) => Promise<unknown[]>;
	streamSimple: (model: StreamModel, context: { messages?: unknown[] }, options?: StreamOptions) => unknown;
	oauth: {
		name: string;
		login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
		refreshToken: (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
		getApiKey: (credentials: OAuthCredentials) => string;
	};
	usage: typeof grokBuildUsageProvider;
}

export interface ProviderDeps {
	transports: Transports;
	fetchImpl?: typeof fetch;
	headerCtx?: HeaderBuildContext;
	login?: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
}

/**
 * Registration passed to `pi.registerProvider("grok-build", …)`.
 * There is no `apiKey` field. omp therefore cannot fall back to XAI_API_KEY.
 */
export function createGrokBuildProviderConfig(deps: ProviderDeps): GrokBuildProviderConfig {
	const headerCtx = deps.headerCtx ?? {};
	return {
		baseUrl: GROK_BUILD_BASE_URL,
		api: GROK_BUILD_API,
		authHeader: true,
		headers: buildStaticHeaders(headerCtx),
		fetchDynamicModels: apiKey => discoverModels(apiKey, deps.fetchImpl, headerCtx),
		streamSimple: (model, context, options) =>
			streamGrokBuild(model, context ?? {}, options, deps.transports, headerCtx),
		oauth: {
			name: "Grok Build",
			login: callbacks => (deps.login ?? loginGrokBuild)(callbacks),
			refreshToken: credentials => refreshGrokBuildToken(credentials, deps.fetchImpl),
			getApiKey: credentials => assertOAuthAccessToken(credentials.access),
		},
		usage: grokBuildUsageProvider,
	};
}

export function providerHasNoApiKeyFallback(config: GrokBuildProviderConfig): boolean {
	return !("apiKey" in config) && config.baseUrl === GROK_BUILD_BASE_URL && config.oauth.name === "Grok Build";
}

export const GROK_BUILD_PROVIDER_ID = PROVIDER_ID;
