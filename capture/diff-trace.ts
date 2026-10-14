import { diffCapturedRequest, diffHasFailures, formatDiffReport, loadTraceFile } from "../src/diff-trace.ts";

const path = process.argv[2];
if (!path) {
	process.stderr.write(
		"Usage: npm run diff-trace -- capture/your-grok.har\n\nSee capture/README.md for how to record the official Grok Build CLI.\n",
	);
	process.exit(2);
}

const requests = loadTraceFile(path);
const diffs = requests.map(request => diffCapturedRequest(request));
process.stdout.write(`${formatDiffReport(diffs)}\n`);
process.exit(diffs.some(diffHasFailures) || diffs.length === 0 ? 1 : 0);
