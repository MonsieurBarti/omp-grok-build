import { BILLING_URL, PROVIDER_ID } from "./constants.ts";
import { assertBuildBaseUrl, assertOAuthAccessToken } from "./auth-guard.ts";
import { buildStaticHeaders, type HeaderBuildContext } from "./headers.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface UsageLimit {
	id: string;
	label: string;
	scope: {
		provider: string;
		accountId?: string;
		windowId?: string;
		shared?: boolean;
	};
	window?: {
		id: string;
		label: string;
		durationMs?: number;
		resetsAt?: number;
	};
	amount: {
		used?: number;
		limit?: number;
		remaining?: number;
		usedFraction?: number;
		remainingFraction?: number;
		unit: string;
	};
	status?: "ok" | "warning" | "exhausted";
}

export interface UsageReport {
	provider: string;
	fetchedAt: number;
	limits: UsageLimit[];
	notes?: string[];
	metadata?: Record<string, unknown>;
	raw?: unknown;
}

export interface BillingView {
	periodStart?: string;
	periodEnd?: string;
	weekly: boolean;
	creditUsagePercent?: number;
	products: { product: string; usagePercent: number }[];
}

const PRODUCT_LABELS: Record<string, string> = {
	GrokBuild: "Grok Build",
	GrokImagine: "Grok Imagine",
	Api: "API",
};

export function parseBillingPayload(payload: unknown): BillingView | undefined {
	if (!isRecord(payload)) return undefined;
	const config = isRecord(payload.config) ? payload.config : payload;
	const period = isRecord(config.currentPeriod) ? config.currentPeriod : undefined;
	const periodStart =
		stringField(config.billingPeriodStart) ?? (period ? stringField(period.start) : undefined);
	const periodEnd =
		stringField(config.billingPeriodEnd) ?? (period ? stringField(period.end) : undefined);
	const periodType = (period ? stringField(period.type) : undefined) ?? "USAGE_PERIOD_TYPE_WEEKLY";
	const credit = finite(config.creditUsagePercent);
	const products: BillingView["products"] = [];
	if (Array.isArray(config.productUsage)) {
		for (const item of config.productUsage) {
			if (!isRecord(item)) continue;
			const product = stringField(item.product);
			const usagePercent = finite(item.usagePercent);
			if (!product || usagePercent === undefined || usagePercent < 0) continue;
			products.push({ product, usagePercent: Math.min(usagePercent, 100) });
		}
	}
	if (credit === undefined && products.length === 0) return undefined;
	return {
		...(periodStart ? { periodStart } : {}),
		...(periodEnd ? { periodEnd } : {}),
		weekly: periodType.toUpperCase().includes("WEEK"),
		...(credit !== undefined ? { creditUsagePercent: Math.min(Math.max(credit, 0), 100) } : {}),
		products,
	};
}

export function billingToUsageReport(input: {
	billing: BillingView;
	fetchedAt?: number;
	accountId?: string;
	email?: string;
	raw?: unknown;
}): UsageReport {
	const fetchedAt = input.fetchedAt ?? Date.now();
	const resetsAt = input.billing.periodEnd ? Date.parse(input.billing.periodEnd) : undefined;
	const window = {
		id: input.billing.weekly ? "1w" : "billing-period",
		label: input.billing.weekly ? "Weekly" : "Billing period",
		...(input.billing.weekly ? { durationMs: WEEK_MS } : {}),
		...(resetsAt !== undefined && Number.isFinite(resetsAt) ? { resetsAt } : {}),
	};
	const scope = {
		provider: PROVIDER_ID,
		...(input.accountId ? { accountId: input.accountId } : {}),
		windowId: window.id,
		shared: true as const,
	};
	const limits: UsageLimit[] = [];
	if (input.billing.creditUsagePercent !== undefined) {
		limits.push(percentLimit(`${PROVIDER_ID}:credits:1w`, "Weekly credits", input.billing.creditUsagePercent, scope, window));
	}
	for (const product of input.billing.products) {
		const slug = product.product.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		if (!slug) continue;
		limits.push(
			percentLimit(
				`${PROVIDER_ID}:product:${slug}:1w`,
				PRODUCT_LABELS[product.product] ?? product.product,
				product.usagePercent,
				scope,
				window,
			),
		);
	}
	return {
		provider: PROVIDER_ID,
		fetchedAt,
		limits,
		notes: ["Grok Build weekly credits from cli-chat-proxy.grok.com/v1/billing."],
		metadata: {
			endpoint: BILLING_URL,
			source: "cli-chat-proxy-billing",
			...(input.accountId ? { accountId: input.accountId } : {}),
			...(input.email ? { email: input.email } : {}),
		},
		raw: input.raw,
	};
}

export async function fetchGrokBuildUsage(input: {
	accessToken: string;
	accountId?: string;
	email?: string;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	headerCtx?: HeaderBuildContext;
}): Promise<UsageReport | null> {
	const access = assertOAuthAccessToken(input.accessToken);
	assertBuildBaseUrl(BILLING_URL);
	const fetchImpl = input.fetchImpl ?? fetch;
	const response = await fetchImpl(BILLING_URL, {
		method: "GET",
		headers: {
			...buildStaticHeaders(input.headerCtx),
			Authorization: `Bearer ${access}`,
			Accept: "application/json",
		},
		signal: input.signal,
	});
	if (!response.ok) return null;
	const payload: unknown = await response.json();
	const billing = parseBillingPayload(payload);
	if (!billing) return null;
	return billingToUsageReport({
		billing,
		accountId: input.accountId,
		email: input.email,
		raw: payload,
	});
}

export interface UsageFetchParams {
	provider: string;
	credential: {
		type?: string;
		apiKey?: string;
		accessToken?: string;
		accountId?: string;
		email?: string;
	};
	signal?: AbortSignal;
}

export interface UsageFetchContext {
	fetch: typeof fetch;
}

export const grokBuildUsageProvider = {
	id: PROVIDER_ID,
	cacheVersion: "grok-build-cli-1",
	validatesCredentials: true,
	supports(params: UsageFetchParams): boolean {
		return params.credential.type === "oauth" && Boolean(params.credential.accessToken?.trim());
	},
	async fetchUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport | null> {
		if (!this.supports(params)) return null;
		try {
			return await fetchGrokBuildUsage({
				accessToken: params.credential.accessToken ?? "",
				accountId: params.credential.accountId,
				email: params.credential.email,
				fetchImpl: ctx.fetch,
				signal: params.signal,
			});
		} catch {
			return null;
		}
	},
};

function percentLimit(
	id: string,
	label: string,
	usagePercent: number,
	scope: UsageLimit["scope"],
	window: NonNullable<UsageLimit["window"]>,
): UsageLimit {
	const usedFraction = Math.min(Math.max(usagePercent, 0), 100) / 100;
	return {
		id,
		label,
		scope,
		window,
		amount: {
			used: usagePercent,
			limit: 100,
			remaining: Math.max(0, 100 - usagePercent),
			usedFraction,
			remainingFraction: Math.max(0, 1 - usedFraction),
			unit: "percent",
		},
		status: usedFraction >= 1 ? "exhausted" : usedFraction >= 0.8 ? "warning" : "ok",
	};
}

function finite(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
