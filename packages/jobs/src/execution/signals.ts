/** The subset of `process` the signal installer needs (injectable for tests). */
export type SignalTarget = {
	on: (signal: NodeJS.Signals, listener: () => void) => unknown
	removeListener: (signal: NodeJS.Signals, listener: () => void) => unknown
}

export type SignalCleanup = () => void

/**
 * Register `handler` for each signal and return a cleanup that removes them. The
 * handler fires at most once across all signals (a second signal during drain is
 * ignored). Payload installs no signal handlers of its own, so these never conflict.
 * `target` defaults to `process`; tests pass an EventEmitter.
 */
export const installSignalHandlers = (
	signals: NodeJS.Signals[],
	handler: (signal: NodeJS.Signals) => void,
	target: SignalTarget = process
): SignalCleanup => {
	let fired = false
	const registered = signals.map((signal) => {
		const listener = () => {
			if (fired) {
				return
			}
			fired = true
			handler(signal)
		}
		target.on(signal, listener)
		return [signal, listener] as const
	})
	return () => {
		for (const [signal, listener] of registered) {
			target.removeListener(signal, listener)
		}
	}
}
