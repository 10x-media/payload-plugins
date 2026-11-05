// biome-ignore-all lint/plugin/noProcessEnv: vitest setup env boundary

const REAL_DATE = Symbol.for('@10x-media/analytics/tests/realDate')

type ClockGlobal = typeof globalThis & { [REAL_DATE]?: DateConstructor }

/**
 * Starts this thread's clock at `instant`; `Date` reads it plus real time since, so time passes.
 * Each test file restarts there while `ANALYTICS_TEST_NOW` is set; unset, the clock is real.
 */
export const startClockAt = (instant: string): void => {
	const at = Date.parse(instant)
	if (Number.isNaN(at)) {
		throw new Error(`ANALYTICS_TEST_NOW must be an ISO instant, got "${instant}"`)
	}
	const scope = globalThis as ClockGlobal
	const RealDate = scope[REAL_DATE] ?? Date
	scope[REAL_DATE] = RealDate
	const offset = at - RealDate.now()
	const now = (): number => RealDate.now() + offset
	globalThis.Date = new Proxy(RealDate, {
		construct: (target, args, newTarget) =>
			Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
		apply: () => new RealDate(now()).toString(),
		get: (target, key, receiver) => (key === 'now' ? now : Reflect.get(target, key, receiver)),
	})
}

const instant = process.env.ANALYTICS_TEST_NOW
if (instant) {
	startClockAt(instant)
}
