import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * CLI fingerprint. Edit this file after `npm run diff-trace` shows a mismatch.
 *
 * Resolution order for the version string (see `resolveCliVersion`):
 *   1. `GROK_CLI_VERSION` in the environment
 *   2. `~/.grok/version.json` (`version`, else `stable_version`)
 *   3. `PINNED_CLI_VERSION` below
 *
 * `PINNED_CLI_VERSION` is a fallback, not a live probe. A logged-in grok CLI
 * 1.0.52 session (2026-10-14) sent `x-grok-client-version: 1.0.52` and
 * `user-agent: grok-shell/1.0.52 (macos; aarch64)`. Replace the pin when a
 * newer capture says otherwise.
 */
export const PINNED_CLI_VERSION = "1.0.52";

export const CLI_FINGERPRINT = {
	/** Product id. Official sampler default: grok-shell. */
	clientIdentifier: "grok-shell",
	/** Interactive TUI. Set GROK_CLIENT_MODE=headless to match `grok -p` captures. */
	clientMode: "interactive",
	/** Sent on the device-code request, matching device_code.rs. Not on chat. */
	clientSurface: "cli",
	tokenAuth: "xai-grok-cli",
	authenticateResponse: "authenticate-response",
	/**
	 * User-Agent template.
	 * `{version}` `{os}` `{arch}` — os/arch are mapped (darwin→macos, arm64→aarch64).
	 */
	userAgentTemplate: "grok-shell/{version} ({os}; {arch})",
	/** Form field on the device-code request. */
	deviceReferrer: "grok-build",
	/** Main-chat HAR: conv id and session id are the same value. */
	convIdEqualsSessionId: true,
	/** Official sampler also sends x-grok-agent-id. Turn off if a capture lacks it. */
	sendAgentId: true,
	sendClientMode: true,
	/**
	 * Same value on the warmup POST and the sampling POST in a 1.0.52 headless
	 * session. Process-stable, generated here, never a captured uuid.
	 */
	sendConvGroupId: true,
	/** W3C traceparent on the sampling request. A fresh id per HTTP call. */
	sendTraceparent: true,
	/** Sampling request loop guards. The empty warmup POST did not send these. */
	doomLoopCheck: "1024",
	exactRepetitionCheck: "64",
} as const;

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Drop pre-release / build metadata. The proxy's version gate parses base semver. */
export function canonicalCliVersion(raw: string | undefined | null): string | undefined {
	if (typeof raw !== "string") return undefined;
	const base = raw.trim().split(/[-+]/)[0]?.trim() ?? "";
	return SEMVER.test(base) ? base : undefined;
}

export function readCliVersionFile(path: string): string | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	if (!trimmed.startsWith("{")) return canonicalCliVersion(trimmed);
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		return (
			canonicalCliVersion(typeof parsed.version === "string" ? parsed.version : undefined) ??
			canonicalCliVersion(
				typeof parsed.stable_version === "string" ? parsed.stable_version : undefined,
			)
		);
	} catch {
		return undefined;
	}
}

export function defaultVersionFilePath(): string {
	return join(homedir(), ".grok", "version.json");
}

export function resolveCliVersion(options?: {
	env?: NodeJS.ProcessEnv;
	versionFile?: string;
	pinned?: string;
}): string {
	const env = options?.env ?? process.env;
	const fromEnv = canonicalCliVersion(env.GROK_CLI_VERSION);
	if (fromEnv) return fromEnv;
	const file = options?.versionFile ?? defaultVersionFilePath();
	const fromFile = readCliVersionFile(file);
	if (fromFile) return fromFile;
	return canonicalCliVersion(options?.pinned ?? PINNED_CLI_VERSION) ?? PINNED_CLI_VERSION;
}

export function resolveClientMode(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.GROK_CLIENT_MODE?.trim();
	return override || CLI_FINGERPRINT.clientMode;
}
