import { PROVIDER_ID } from "./constants.ts";
import { createGrokBuildProviderConfig } from "./provider.ts";
import { fetchGrokBuildUsage } from "./usage.ts";
import { loadWireTransports } from "./stream.ts";

interface ExtensionUi {
	notify(message: string, level?: string): void;
}

interface ExtensionCommandContext {
	ui: ExtensionUi;
	modelRegistry?: { authStorage?: unknown };
}

interface ExtensionApi {
	setLabel(label: string): void;
	registerProvider(name: string, config: unknown): void;
	registerCommand(
		name: string,
		command: {
			description: string;
			handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
		},
	): void;
}

/**
 * omp extension entry (`package.json#omp.extensions`).
 * Loaded by omp, which provides `@oh-my-pi/pi-ai`.
 */
export default async function grokBuildExtension(pi: ExtensionApi): Promise<void> {
	const transports = await loadWireTransports();
	const config = createGrokBuildProviderConfig({ transports });
	pi.setLabel("Grok Build");
	pi.registerProvider(PROVIDER_ID, config);

	pi.registerCommand("grok-build-help", {
		description: "How to use the Grok Build provider",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[
					"Grok Build",
					"",
					"  /login   → Grok Build",
					"  /logout  → Grok Build",
					"  /model grok-build/grok-4.7",
					"  /usage   → weekly Build credits",
					"",
					"Chat goes to cli-chat-proxy.grok.com.",
					"XAI_API_KEY and api.x.ai are not used.",
				].join("\n"),
				"info",
			);
		},
	});
}

export { fetchGrokBuildUsage };
