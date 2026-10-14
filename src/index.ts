import { streamOpenAICompletions } from "@oh-my-pi/pi-ai/providers/openai-completions";
import { streamOpenAIResponses } from "@oh-my-pi/pi-ai/providers/openai-responses";

import { PROVIDER_ID } from "./constants.ts";
import { createGrokBuildProviderConfig } from "./provider.ts";
import type { Transports } from "./stream.ts";
import { fetchGrokBuildUsage } from "./usage.ts";

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
 * Host transports. These specifiers must stay static string literals.
 * omp's extension loader rewrites `@oh-my-pi/pi-ai/...` onto the in-process
 * copy before the module runs. A runtime `import(specifier)` is invisible to
 * that rewrite and fails from `~/.omp/plugins/node_modules`, where the host
 * packages are not installed.
 */
const transports: Transports = {
	responses: (model, context, options) => streamOpenAIResponses(model as never, context as never, options),
	completions: (model, context, options) => streamOpenAICompletions(model as never, context as never, options),
};

/**
 * omp extension entry (`package.json#omp.extensions`).
 */
export default async function grokBuildExtension(pi: ExtensionApi): Promise<void> {
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
