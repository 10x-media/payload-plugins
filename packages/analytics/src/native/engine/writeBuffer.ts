import { setTimeout as startTimer, clearTimeout as stopTimer } from 'node:timers'
import { monotonicMs } from '../../core/monotonic'
import { isRecord } from '../../core/values'
import { isRowError } from '../../db/errors'
import { isOrderHitId } from '../store/ids'
import type { AppendResult, EventStore, HitRow } from '../store/types'

export interface WriteBufferLimits {
	/** Hits one write to the store carries at most. */
	maxSize: number
	/** How long the first hit of a batch waits for its write. */
	maxAgeMs: number
	/** Hits held at once, waiting or being written; past it, a new one waits for a write. */
	maxPending: number
}

export const DEFAULT_WRITE_BUFFER: Readonly<WriteBufferLimits> = {
	maxSize: 200,
	maxAgeMs: 1000,
	maxPending: 5000,
}

/** `native({ buffer })`: off unless set; `true` takes defaults, an object overrides any of them. */
export type WriteBufferOption = boolean | Partial<WriteBufferLimits>

const wholeLimit = (value: unknown, name: keyof WriteBufferLimits): number => {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new Error(
			`analytics: native buffer.${name} must be a whole number of at least 1, got ${String(value)}`
		)
	}
	return value
}

/** The limits an option asks for, null for no buffer; limits no buffer could keep fail the boot. */
export const resolveWriteBuffer = (
	option: WriteBufferOption | undefined
): WriteBufferLimits | null => {
	if (option === undefined || option === false) {
		return null
	}
	if (option !== true && (!isRecord(option) || Array.isArray(option))) {
		throw new Error('analytics: native buffer must be true, false or an object of limits')
	}
	const given = option === true ? {} : option
	const limits: WriteBufferLimits = {
		maxSize: wholeLimit(given.maxSize ?? DEFAULT_WRITE_BUFFER.maxSize, 'maxSize'),
		maxAgeMs: wholeLimit(given.maxAgeMs ?? DEFAULT_WRITE_BUFFER.maxAgeMs, 'maxAgeMs'),
		maxPending: wholeLimit(given.maxPending ?? DEFAULT_WRITE_BUFFER.maxPending, 'maxPending'),
	}
	if (limits.maxPending < limits.maxSize) {
		throw new Error(
			`analytics: native buffer.maxPending (${limits.maxPending}) must be at least buffer.maxSize (${limits.maxSize})`
		)
	}
	return limits
}

/** Environment variables a serverless platform sets in every function it runs. */
const SERVERLESS_ENV: readonly string[] = ['VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'NETLIFY']

/** The variable that gives a serverless platform away, or undefined when none is set. */
export const serverlessPlatformOf = (
	env: Readonly<Record<string, string | undefined>>
): string | undefined => SERVERLESS_ENV.find((name) => (env[name] ?? '') !== '')

/** One line about dropped hits at most this often, whatever the database does. */
const DROP_LOG_INTERVAL_MS = 60_000

/** How long a batch the database refused as a whole waits before its one retry. */
export const BATCH_RETRY_MS = 500

/** How long a SIGTERM or SIGINT waits for the last write before the signal is handed on. */
const SIGNAL_FLUSH_MS = 5_000

/** How often deferred work asks whether it may run. */
const DEFER_POLL_MS = 50

/** How long deferred work waits at most before it runs anyway. */
export const DEFER_MAX_MS = 600_000

/** Deferred work held at once, waiting or running: past it, more is dropped and logged. */
export const MAX_DEFERRED = 10_000

/** The signals that stop a process and that a writer answers by writing what it holds first. */
type StopSignal = 'SIGTERM' | 'SIGINT'

const STOP_SIGNALS: readonly StopSignal[] = ['SIGTERM', 'SIGINT']

/** What the writer needs of a process to write what it holds when the process is told to stop. */
export interface ShutdownSignals {
	readonly pid: number
	on(event: 'beforeExit' | 'exit' | StopSignal, listener: () => void): unknown
	off(event: 'beforeExit' | 'exit' | StopSignal, listener: () => void): unknown
	listenerCount(event: StopSignal): number
	kill(pid: number, signal: StopSignal): unknown
}

/** The slice of Payload's logger the writer speaks through. */
interface WriterLogger {
	warn(message: string): void
	error(details: { err: unknown; msg: string }): void
}

export interface HitWriterOptions {
	store: Pick<EventStore, 'append'>
	buffer?: WriteBufferOption
	logger?: WriterLogger
	/** The process whose shutdown writes the buffer out: Node's own unless a test hands one in. */
	signals?: ShutdownSignals
	/** What the serverless check reads: `process.env` unless a test hands one in. */
	env?: Readonly<Record<string, string | undefined>>
	now?: () => number
	/** Starts a one-shot timer and answers how to cancel it. */
	setTimer?: (run: () => void, ms: number) => () => void
}

export interface HitWriter {
	/**
	 * Stores one hit, buffered unless an order, `flush: true` or a closed writer. A buffered write
	 * resolves once queued (waiting only at `maxPending`) and answers nothing; a direct one does.
	 */
	write(hit: HitRow, options?: { flush?: boolean }): Promise<AppendResult | undefined>
	/**
	 * Runs `work` once `blocked` answers false, for a hit recorded inside a host's open SQLite
	 * transaction. Never rejects; past {@link DEFER_MAX_MS}, or on `close`, it runs anyway.
	 */
	defer(work: () => Promise<void>, blocked: () => boolean): void
	/** Runs the deferred work that may run, then writes everything buffered so far; never rejects. */
	flush(): Promise<void>
	/** Runs every deferred work, writes what is buffered and takes the process listeners back. */
	close(): Promise<void>
	/** Hits held in the buffer: waiting, and in the write under way. Deferred work is not one. */
	pending(): number
}

const unrefTimer = (run: () => void, ms: number): (() => void) => {
	// A pending write must never be what keeps a process, or a test run, alive.
	const handle = startTimer(run, ms).unref()
	return () => stopTimer(handle)
}

/** Resolves when `work` settles or `ms` has passed, whichever comes first. */
const settleWithin = (work: Promise<void>, ms: number): Promise<void> =>
	new Promise((resolve) => {
		const cancel = unrefTimer(resolve, ms)
		void work.finally(() => {
			cancel()
			resolve()
		})
	})

/** Reports failures at most once a minute, with how many there were since the last line. */
const rateLimitedReport = (
	logger: WriterLogger | undefined,
	now: () => number,
	message: (count: number) => string
): ((count: number, error: unknown) => void) => {
	let missed = 0
	let loggedAt: number | null = null
	return (count, error) => {
		missed += count
		const at = now()
		if (loggedAt !== null && at - loggedAt < DROP_LOG_INTERVAL_MS) {
			return
		}
		loggedAt = at
		logger?.error({ err: error, msg: message(missed) })
		missed = 0
	}
}

interface DeferredWork {
	work: () => Promise<void>
	blocked: () => boolean
	since: number
}

/** Work that waits its turn, asked on a timer whether it may run yet; at most `MAX_DEFERRED`. */
const createDeferrals = (args: {
	now: () => number
	setTimer: (run: () => void, ms: number) => () => void
	failed: (error: unknown) => void
	/** Work refused, `MAX_DEFERRED` waiting or running already. */
	dropped: () => void
}) => {
	let waiting: DeferredWork[] = []
	const running = new Set<Promise<void>>()
	let cancel: (() => void) | null = null

	const mayRun = (entry: DeferredWork, force: boolean): boolean => {
		if (force || args.now() - entry.since >= DEFER_MAX_MS) {
			return true
		}
		try {
			return !entry.blocked()
		} catch {
			return true
		}
	}

	const start = (entry: DeferredWork): void => {
		const task = entry.work().catch(args.failed)
		running.add(task)
		void task.then(() => running.delete(task))
	}

	const poll = (force: boolean): void => {
		cancel?.()
		cancel = null
		const still: DeferredWork[] = []
		for (const entry of waiting) {
			if (mayRun(entry, force)) {
				start(entry)
			} else {
				still.push(entry)
			}
		}
		waiting = still
		if (waiting.length > 0) {
			cancel = args.setTimer(() => poll(false), DEFER_POLL_MS)
		}
	}

	return {
		add(work: () => Promise<void>, blocked: () => boolean): void {
			if (waiting.length + running.size >= MAX_DEFERRED) {
				args.dropped()
				return
			}
			waiting.push({ work, blocked, since: args.now() })
			poll(false)
		},
		/** Work not finished yet, waiting or running. */
		held: (): number => waiting.length + running.size,
		/** Starts what may run (everything, when forced) and waits for all of it to finish. */
		async settle(force: boolean): Promise<void> {
			poll(force)
			while (running.size > 0) {
				await Promise.allSettled([...running])
			}
		},
	}
}

/**
 * Writes what a writer holds before the process goes: on SIGTERM and SIGINT, then hands the signal
 * back; when the event loop runs dry; and on `exit`, where no write can run, warns what is lost.
 */
const guardShutdown = (args: {
	signals: ShutdownSignals
	logger: WriterLogger | undefined
	/** Hits and deferred work not stored yet. */
	held: () => number
	/** Runs every deferred work and writes everything held; `stopping` once the process goes. */
	settle: (stopping: boolean) => Promise<void>
}) => {
	const { signals } = args
	let listening = false
	let settling: Promise<void> | null = null
	const settleOnce = (stopping: boolean): Promise<void> => {
		settling ??= args.settle(stopping).finally(() => {
			settling = null
		})
		return settling
	}
	const onBeforeExit = (): void => {
		// Writing schedules more work, which empties the loop again: only start while work is held.
		if (args.held() > 0 && settling === null) {
			void settleOnce(false)
		}
	}
	const onExit = (): void => {
		const lost = args.held()
		if (lost > 0) {
			args.logger?.warn(
				`analytics: the process exited with ${lost} hits not stored yet, and they are lost. Destroy Payload (await payload.destroy()) before calling process.exit() to store them.`
			)
		}
	}
	// Each writer lets go only once its own write is done, so with several instances in one process
	// the last one out hands the signal back: a listener otherwise keeps Node from stopping.
	const onSignal = (signal: StopSignal) => (): void => {
		void settleWithin(settleOnce(true), SIGNAL_FLUSH_MS).then(() => {
			release()
			if (signals.listenerCount(signal) === 0) {
				signals.kill(signals.pid, signal)
			}
		})
	}
	const handlers = new Map(STOP_SIGNALS.map((signal) => [signal, onSignal(signal)]))
	const release = (): void => {
		if (!listening) {
			return
		}
		listening = false
		signals.off('beforeExit', onBeforeExit)
		signals.off('exit', onExit)
		for (const [signal, handler] of handlers) {
			signals.off(signal, handler)
		}
	}
	return {
		listen(): void {
			if (listening) {
				return
			}
			listening = true
			signals.on('beforeExit', onBeforeExit)
			signals.on('exit', onExit)
			for (const [signal, handler] of handlers) {
				signals.on(signal, handler)
			}
		},
		release,
	}
}

const DEFERRED_FAILED = (count: number): string =>
	`analytics: ${count} server events recorded inside a database transaction could not be stored once it ended. Logged at most once a minute.`

const DEFERRED_DROPPED = (count: number): string =>
	`analytics: ${count} server events recorded inside a database transaction were dropped: ${MAX_DEFERRED} were already waiting for theirs to end. Logged at most once a minute.`

const BUFFERED_DROPPED = (count: number): string =>
	`analytics: ${count} buffered hits could not be written and were dropped. Logged at most once a minute.`

/**
 * Writes hits through an optional buffer bounded by size, age and hits held; a batch refused for
 * its rows goes again hit by hit, one refused for the database's state again whole, once.
 */
export const createHitWriter = (options: HitWriterOptions): HitWriter => {
	const { store, logger } = options
	const limits = resolveWriteBuffer(options.buffer)
	const now = options.now ?? monotonicMs
	const setTimer = options.setTimer ?? unrefTimer
	const deferredFailed = rateLimitedReport(logger, now, DEFERRED_FAILED)
	const deferredDropped = rateLimitedReport(logger, now, DEFERRED_DROPPED)
	const deferrals = createDeferrals({
		now,
		setTimer,
		failed: (error) => deferredFailed(1, error),
		dropped: () => deferredDropped(1, new Error('too many server events waiting')),
	})
	const direct = (hit: HitRow): Promise<AppendResult> => store.append([hit])
	const signals = options.signals ?? process
	if (limits === null) {
		// Without a buffer only deferred work can be lost, so the process is listened to once some
		// is waiting.
		const shutdown = guardShutdown({
			signals,
			logger,
			held: deferrals.held,
			settle: () => deferrals.settle(true),
		})
		return {
			write: direct,
			defer(work, blocked) {
				shutdown.listen()
				deferrals.add(work, blocked)
			},
			flush: () => deferrals.settle(false),
			async close() {
				shutdown.release()
				await deferrals.settle(true)
			},
			pending: () => 0,
		}
	}
	// biome-ignore lint/plugin/noProcessEnv: the platform's own markers, read once to warn at boot
	const platform = serverlessPlatformOf(options.env ?? process.env)
	if (platform !== undefined) {
		logger?.warn(
			`analytics: native buffer is on, and ${platform} is set. On a serverless platform a function can be frozen or stopped between requests, and the hits it still holds in memory are lost: turn the buffer off there.`
		)
	}

	let waiting: HitRow[] = []
	let writing = 0
	let flushing: Promise<void> = Promise.resolve()
	/** A drain is chained behind the current one and has not started yet. */
	let queued = false
	let cancelTimer: (() => void) | null = null
	let closed = false
	const report = rateLimitedReport(logger, now, BUFFERED_DROPPED)

	/** Resolves with the store's refusal of `hits`, or null once they are written. */
	const attempt = (hits: HitRow[]): Promise<unknown> =>
		store.append(hits).then(
			() => null,
			(error: unknown) => error ?? new Error('analytics: the store refused a write')
		)

	const pause = (ms: number): Promise<void> =>
		new Promise((resolve) => {
			setTimer(resolve, ms)
		})

	const writeBatch = async (batch: HitRow[]): Promise<void> => {
		let failure = await attempt(batch)
		if (failure === null) {
			return
		}
		if (!isRowError(failure)) {
			await pause(BATCH_RETRY_MS)
			failure = await attempt(batch)
			if (failure === null) {
				return
			}
			if (!isRowError(failure)) {
				report(batch.length, failure)
				return
			}
		}
		let lost = 0
		for (const [index, hit] of batch.entries()) {
			const refused = await attempt([hit])
			if (refused === null) {
				continue
			}
			if (!isRowError(refused)) {
				report(lost + batch.length - index, refused)
				return
			}
			lost += 1
		}
		if (lost > 0) {
			report(lost, failure)
		}
	}

	const drain = async (): Promise<void> => {
		cancelTimer?.()
		cancelTimer = null
		while (waiting.length > 0) {
			const batch = waiting.slice(0, limits.maxSize)
			waiting = waiting.slice(batch.length)
			writing = batch.length
			try {
				await writeBatch(batch)
			} finally {
				writing = 0
			}
		}
	}

	const drainBuffer = (): Promise<void> => {
		if (!queued) {
			queued = true
			flushing = flushing
				.then(() => {
					queued = false
					return drain()
				})
				.catch(() => undefined)
		}
		return flushing
	}

	const flush = async (): Promise<void> => {
		await deferrals.settle(false)
		await drainBuffer()
	}

	const pending = (): number => waiting.length + writing

	const shutdown = guardShutdown({
		signals,
		logger,
		held: () => pending() + deferrals.held(),
		settle: async (stopping) => {
			closed ||= stopping
			await deferrals.settle(true)
			await drainBuffer()
		},
	})
	shutdown.listen()

	return {
		async write(hit, writeOptions) {
			const bypass = writeOptions?.flush === true || isOrderHitId(hit.id)
			while (!bypass && !closed && pending() >= limits.maxPending) {
				await drainBuffer()
			}
			if (bypass || closed) {
				return direct(hit)
			}
			waiting.push(hit)
			if (waiting.length >= limits.maxSize) {
				void drainBuffer()
			} else if (cancelTimer === null) {
				cancelTimer = setTimer(() => {
					cancelTimer = null
					void drainBuffer()
				}, limits.maxAgeMs)
			}
			return undefined
		},
		defer: deferrals.add,
		flush,
		async close() {
			closed = true
			shutdown.release()
			await deferrals.settle(true)
			await drainBuffer()
		},
		pending,
	}
}
