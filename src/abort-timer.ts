export interface ArmedAbort {
	signal: AbortSignal;
	cancel: () => void;
}

/**
 * Abort after `ms`. `cancel` clears the timer once the stream settles so a
 * finished request does not hold the process open.
 */
export function armAbort(ms: number, parent?: AbortSignal, reason?: unknown): ArmedAbort {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(reason);
	}, ms);
	let settled = false;
	const cancel = () => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
	};
	if (parent) {
		if (parent.aborted) {
			cancel();
			controller.abort(parent.reason);
		} else {
			parent.addEventListener(
				"abort",
				() => {
					cancel();
					controller.abort(parent.reason);
				},
				{ once: true },
			);
		}
	}
	controller.signal.addEventListener("abort", cancel, { once: true });
	return { signal: controller.signal, cancel };
}
