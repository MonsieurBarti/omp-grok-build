import { MODELS_URL } from "./constants.ts";
import { assertBuildBaseUrl, assertOAuthAccessToken } from "./auth-guard.ts";
import { debugLog, redactHeaders, rememberModelsPayload } from "./debug.ts";
import { buildStaticHeaders, type HeaderBuildContext } from "./headers.ts";
import {
	mergeServerModels,
	parseModelListPayload,
	seedModels,
	type ProviderModel,
} from "./models.ts";

const DISCOVERY_TIMEOUT_MS = 12_000;

export async function discoverModels(
	apiKey: string | undefined,
	fetchImpl: typeof fetch = fetch,
	headerCtx: HeaderBuildContext = {},
): Promise<ProviderModel[]> {
	if (!apiKey?.trim()) return seedModels();
	const access = assertOAuthAccessToken(apiKey);
	assertBuildBaseUrl(MODELS_URL);
	const headers = {
		...buildStaticHeaders(headerCtx),
		Authorization: `Bearer ${access}`,
		Accept: "application/json",
	};
	debugLog("GET /v1/models request", { url: MODELS_URL, headers: redactHeaders(headers) });
	let response: Response;
	try {
		response = await fetchImpl(MODELS_URL, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
		});
	} catch {
		return seedModels();
	}
	if (!response.ok) return seedModels();
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return seedModels();
	}
	rememberModelsPayload(payload);
	const rows = parseModelListPayload(payload);
	if (rows.length === 0) return seedModels();
	const merged = mergeServerModels(rows);
	return merged.length > 0 ? merged : seedModels();
}
