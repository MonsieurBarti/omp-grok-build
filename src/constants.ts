/** Selector id: `/model grok-build/<model>`. Distinct from `xai` and `xai-oauth`. */
export const PROVIDER_ID = "grok-build";

/**
 * Custom API id so omp calls our streamSimple instead of the built-in
 * openai-responses handler. The handler then forwards to the real wire API.
 */
export const GROK_BUILD_API = "grok-build-cli";

/** Official Grok Build CLI chat proxy. Never api.x.ai. */
export const GROK_BUILD_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

export const GROK_BUILD_ORIGIN = "https://cli-chat-proxy.grok.com";

/** Weekly Build credits. Exists: unauthenticated GET returns 401, not 404. */
export const BILLING_URL = `${GROK_BUILD_BASE_URL}/billing?format=credits`;

export const MODELS_URL = `${GROK_BUILD_BASE_URL}/models`;

export const XAI_ISSUER = "https://auth.x.ai";

export const XAI_DISCOVERY_URL = `${XAI_ISSUER}/.well-known/openid-configuration`;

/** Live OIDC document, fetched 2026-10-14. Discovery still overrides these. */
export const XAI_DEFAULTS = {
	authorizationEndpoint: `${XAI_ISSUER}/oauth2/authorize`,
	deviceAuthorizationEndpoint: `${XAI_ISSUER}/oauth2/device/code`,
	tokenEndpoint: `${XAI_ISSUER}/oauth2/token`,
	userinfoEndpoint: `${XAI_ISSUER}/oauth2/userinfo`,
} as const;

/**
 * Public Grok CLI OAuth client. No secret. `token_endpoint_auth_methods_supported`
 * includes `none`. Same id used by the official CLI and omp's xai-oauth.
 */
export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";

/** Scopes the CLI requests. All of these are in the live discovery `scopes_supported`. */
export const XAI_SCOPE =
	"openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** Env var this provider must never read as a credential. */
export const FORBIDDEN_API_KEY_ENV = "XAI_API_KEY";

export const FORBIDDEN_API_HOSTS = ["api.x.ai", "us.api.x.ai"] as const;
