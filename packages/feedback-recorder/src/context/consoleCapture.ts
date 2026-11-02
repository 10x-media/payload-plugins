export type ConsoleEntry = {
	level: 'error' | 'warn'
	message: string
	at: string
}

const MAX_ENTRIES = 50
const MAX_MESSAGE = 500

type ConsoleTarget = Pick<Console, 'error' | 'warn'>
type EventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

const describe = (value: unknown): string => {
	if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
	if (typeof value === 'string') return value
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

/**
 * Collects console errors and warnings, uncaught errors and unhandled rejections while a
 * recording runs, so a bug report arrives with what the browser complained about. The original
 * console methods still run. `stop()` restores everything and returns what was seen, at most 50
 * entries of at most 500 characters each.
 */
export const startConsoleCapture = (
	targets: { console?: ConsoleTarget; window?: EventTarget } = {}
): { stop: () => ConsoleEntry[] } => {
	const target = targets.console ?? console
	const events = targets.window ?? (typeof window === 'undefined' ? undefined : window)
	const entries: ConsoleEntry[] = []

	const push = (level: ConsoleEntry['level'], parts: unknown[]): void => {
		if (entries.length >= MAX_ENTRIES) return
		entries.push({
			level,
			message: parts.map(describe).join(' ').slice(0, MAX_MESSAGE),
			at: new Date().toISOString(),
		})
	}

	const originalError = target.error
	const originalWarn = target.warn
	target.error = (...parts: unknown[]) => {
		push('error', parts)
		originalError.apply(target, parts)
	}
	target.warn = (...parts: unknown[]) => {
		push('warn', parts)
		originalWarn.apply(target, parts)
	}

	const onError = (event: Event): void => {
		const error = (event as ErrorEvent).error ?? (event as ErrorEvent).message
		push('error', [error])
	}
	const onRejection = (event: Event): void => {
		push('error', ['Unhandled rejection:', (event as PromiseRejectionEvent).reason])
	}
	events?.addEventListener('error', onError)
	events?.addEventListener('unhandledrejection', onRejection)

	return {
		stop: () => {
			target.error = originalError
			target.warn = originalWarn
			events?.removeEventListener('error', onError)
			events?.removeEventListener('unhandledrejection', onRejection)
			return [...entries]
		},
	}
}
