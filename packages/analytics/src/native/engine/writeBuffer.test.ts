import { describe, expect, it, vi } from 'vitest'
import { orderHitId } from '../store/ids'
import type { AppendResult, HitRow } from '../store/types'
import {
	BATCH_RETRY_MS,
	createHitWriter,
	DEFAULT_WRITE_BUFFER,
	DEFER_MAX_MS,
	type HitWriterOptions,
	MAX_DEFERRED,
	resolveWriteBuffer,
	type ShutdownSignals,
	serverlessPlatformOf,
} from './writeBuffer'

const hit = (id: string): HitRow => ({
	id,
	scope: '',
	ts: new Date('2026-10-06T10:00:00.000Z'),
	type: 'pageview',
	hostname: 'a.example',
	path: '/',
	v: 'AAAAAAAAAAAAAAAA',
	landing: true,
	server: false,
})

/** Postgres refusing a value too long for its column: the row's own fault. */
const rowError = (): Error => Object.assign(new Error('value too long'), { code: '22001' })

/** libsql meeting another connection's lock: the database's state, which every row meets alike. */
const lockError = (): Error =>
	Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })

/**
 * A store recording each append; `refuse` fails the calls it picks with `error` (a row's fault by
 * default), `gate` holds every call open.
 */
const fakeStore = (
	options: {
		refuse?: (hits: readonly HitRow[]) => boolean
		error?: () => Error
		gate?: Promise<void>
	} = {}
) => {
	const calls: string[][] = []
	const stored: string[] = []
	const append = vi.fn(async (hits: readonly HitRow[]): Promise<AppendResult> => {
		calls.push(hits.map((row) => row.id))
		await options.gate
		if (options.refuse?.(hits)) {
			throw (options.error ?? rowError)()
		}
		stored.push(...hits.map((row) => row.id))
		return { written: hits.length, duplicates: 0 }
	})
	return { store: { append }, calls, stored }
}

/** A process stand-in: its listeners by event, and the signals the writer sends it. */
const fakeProcess = () => {
	const listeners = new Map<string, Array<() => void>>()
	const sent: string[] = []
	const count = (event: string): number => listeners.get(event)?.length ?? 0
	const signals: ShutdownSignals = {
		pid: 4242,
		on(event, listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener])
		},
		off(event, listener) {
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter((each) => each !== listener)
			)
		},
		listenerCount: count,
		kill(pid, signal) {
			sent.push(`${signal} to ${pid}`)
		},
	}
	const emit = (event: 'beforeExit' | 'exit' | 'SIGTERM' | 'SIGINT'): void => {
		for (const listener of [...(listeners.get(event) ?? [])]) {
			listener()
		}
	}
	return { signals, emit, sent, count }
}

/** Timers a test fires by hand. */
const manualTimers = () => {
	const armed = new Set<() => void>()
	return {
		setTimer: (run: () => void) => {
			const timer = () => {
				armed.delete(timer)
				run()
			}
			armed.add(timer)
			return () => {
				armed.delete(timer)
			}
		},
		fire: () => {
			for (const timer of [...armed]) {
				timer()
			}
		},
		armed: () => armed.size,
	}
}

const logger = () => ({ warn: vi.fn(), error: vi.fn() })

/** Lets every promise the writer chained run to its end. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

const deferred = () => {
	let release: () => void = () => undefined
	const promise = new Promise<void>((resolve) => {
		release = resolve
	})
	return { promise, release }
}

const buffered = (
	store: ReturnType<typeof fakeStore>,
	overrides: Partial<HitWriterOptions> = {}
) => {
	const process = fakeProcess()
	const timers = manualTimers()
	const log = logger()
	const clock = { at: 0 }
	const writer = createHitWriter({
		store: store.store,
		buffer: { maxSize: 3, maxAgeMs: 1000, maxPending: 6 },
		signals: process.signals,
		env: {},
		logger: log,
		now: () => clock.at,
		setTimer: timers.setTimer,
		...overrides,
	})
	return { writer, process, timers, log, clock }
}

describe('createHitWriter without a buffer', () => {
	it('writes each hit straight to the store, and listens for nothing', async () => {
		const store = fakeStore()
		const process = fakeProcess()
		const log = logger()
		const writer = createHitWriter({
			store: store.store,
			signals: process.signals,
			env: { VERCEL: '1' },
			logger: log,
		})
		await writer.write(hit('A'))
		expect(store.calls).toEqual([['A']])
		expect(writer.pending()).toBe(0)
		expect(process.count('SIGTERM') + process.count('beforeExit')).toBe(0)
		expect(log.warn).not.toHaveBeenCalled()
	})

	it('lets a refused write reach its caller, who decides what it costs', async () => {
		const writer = createHitWriter({ store: fakeStore({ refuse: () => true }).store })
		await expect(writer.write(hit('A'))).rejects.toThrow('value too long')
	})
})

describe('createHitWriter with a buffer', () => {
	it('holds hits until maxSize of them wait, then writes them in one call', async () => {
		const store = fakeStore()
		const { writer } = buffered(store)
		await writer.write(hit('A'))
		await writer.write(hit('B'))
		expect(store.calls).toEqual([])
		expect(writer.pending()).toBe(2)
		await writer.write(hit('C'))
		await settle()
		expect(store.calls).toEqual([['A', 'B', 'C']])
		expect(writer.pending()).toBe(0)
	})

	it('writes what waits once the first of it has waited maxAgeMs, with one timer per batch', async () => {
		const store = fakeStore()
		const { writer, timers } = buffered(store)
		await writer.write(hit('A'))
		await writer.write(hit('B'))
		expect(timers.armed()).toBe(1)
		timers.fire()
		await settle()
		expect(store.calls).toEqual([['A', 'B']])
		expect(timers.armed()).toBe(0)
	})

	it('makes a write wait once maxPending hits are held, and never holds more', async () => {
		const gate = deferred()
		const store = fakeStore({ gate: gate.promise })
		const { writer } = buffered(store)
		for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) {
			await writer.write(hit(id))
		}
		let landed = false
		const waiting = writer.write(hit('G')).then(() => {
			landed = true
		})
		await settle()
		expect(landed).toBe(false)
		expect(writer.pending()).toBe(6)
		expect(store.calls).toEqual([['A', 'B', 'C']])
		gate.release()
		await waiting
		expect(store.calls).toEqual([
			['A', 'B', 'C'],
			['D', 'E', 'F'],
		])
		expect(writer.pending()).toBe(1)
		await writer.flush()
		expect(store.stored).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
	})

	it('writes a hit that was waiting for room straight through once the writer closes', async () => {
		const gate = deferred()
		const store = fakeStore({ gate: gate.promise })
		const { writer } = buffered(store)
		for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) {
			await writer.write(hit(id))
		}
		const waiting = writer.write(hit('G'))
		const closing = writer.close()
		gate.release()
		await Promise.all([waiting, closing])
		expect(store.calls).toEqual([['A', 'B', 'C'], ['D', 'E', 'F'], ['G']])
		expect(writer.pending()).toBe(0)
	})

	it('writes a batch refused for its rows again hit by hit, and drops only what fails twice, logging once a minute', async () => {
		const store = fakeStore({
			refuse: (hits) => hits.length > 1 || hits.some((row) => row.id.startsWith('X')),
		})
		const { writer, log, clock } = buffered(store)
		for (const id of ['A', 'X1', 'B']) {
			await writer.write(hit(id))
		}
		await settle()
		expect(store.stored).toEqual(['A', 'B'])
		expect(log.error).toHaveBeenCalledTimes(1)
		expect(log.error.mock.calls[0]?.[0]).toMatchObject({
			msg: expect.stringContaining('1 buffered hits could not be written'),
			err: expect.any(Error),
		})
		for (const id of ['X2', 'C', 'D']) {
			await writer.write(hit(id))
		}
		await settle()
		expect(store.stored).toEqual(['A', 'B', 'C', 'D'])
		expect(log.error).toHaveBeenCalledTimes(1)
		clock.at += 60_000
		for (const id of ['X3', 'E', 'F']) {
			await writer.write(hit(id))
		}
		await settle()
		expect(log.error).toHaveBeenCalledTimes(2)
		expect(log.error.mock.calls[1]?.[0]).toMatchObject({
			msg: expect.stringContaining('2 buffered hits could not be written'),
		})
	})

	it('retries a batch the database refused for its state once, whole, after a pause', async () => {
		let refusals = 1
		const store = fakeStore({ refuse: () => refusals-- > 0, error: lockError })
		const { writer, timers, log } = buffered(store)
		for (const id of ['A', 'B', 'C']) {
			await writer.write(hit(id))
		}
		await settle()
		expect(store.calls).toEqual([['A', 'B', 'C']])
		timers.fire()
		await settle()
		expect(store.calls).toEqual([
			['A', 'B', 'C'],
			['A', 'B', 'C'],
		])
		expect(store.stored).toEqual(['A', 'B', 'C'])
		expect(log.error).not.toHaveBeenCalled()
		expect(BATCH_RETRY_MS).toBeGreaterThan(0)
	})

	it('drops a batch refused twice for the database state without trying it hit by hit', async () => {
		const store = fakeStore({ refuse: () => true, error: lockError })
		const { writer, timers, log } = buffered(store)
		for (const id of ['A', 'B', 'C']) {
			await writer.write(hit(id))
		}
		await settle()
		timers.fire()
		await settle()
		expect(store.calls).toHaveLength(2)
		expect(log.error).toHaveBeenCalledTimes(1)
		expect(log.error.mock.calls[0]?.[0]).toMatchObject({
			msg: expect.stringContaining('3 buffered hits could not be written'),
		})
	})

	it('stops writing hit by hit at the first refusal for the database state', async () => {
		const store = fakeStore({
			refuse: (hits) => hits.length > 1 || hits[0]?.id !== 'A',
			error: () => (store.calls.length > 2 ? lockError() : rowError()),
		})
		const { writer, log } = buffered(store)
		for (const id of ['A', 'B', 'C']) {
			await writer.write(hit(id))
		}
		await settle()
		expect(store.calls).toEqual([['A', 'B', 'C'], ['A'], ['B']])
		expect(store.stored).toEqual(['A'])
		expect(log.error.mock.calls[0]?.[0]).toMatchObject({
			msg: expect.stringContaining('2 buffered hits could not be written'),
		})
	})

	it('releases a write waiting for room after one retry of a locked batch, not one wait per hit', async () => {
		const store = fakeStore({ refuse: () => true, error: lockError })
		const { writer, timers } = buffered(store, {
			buffer: { maxSize: 3, maxAgeMs: 1000, maxPending: 3 },
		})
		for (const id of ['A', 'B', 'C']) {
			await writer.write(hit(id))
		}
		let released = false
		const waiting = writer.write(hit('D')).then(() => {
			released = true
		})
		await settle()
		expect(released).toBe(false)
		timers.fire()
		await waiting
		expect(released).toBe(true)
		expect(store.calls).toEqual([
			['A', 'B', 'C'],
			['A', 'B', 'C'],
		])
	})

	it('writes an order, and a call asking to know its hit landed, straight through', async () => {
		const store = fakeStore()
		const { writer } = buffered(store)
		await writer.write(hit('A'))
		await writer.write(hit(orderHitId('s.abc')))
		await writer.write(hit('B'), { flush: true })
		expect(store.calls).toEqual([['os.abc'], ['B']])
		expect(writer.pending()).toBe(1)
	})

	it('answers what the store did for a write straight through, and nothing for a buffered one', async () => {
		const store = fakeStore()
		const { writer } = buffered(store)
		expect(await writer.write(hit('A'))).toBeUndefined()
		expect(await writer.write(hit(orderHitId('s.abc')))).toEqual({ written: 1, duplicates: 0 })
		expect(await writer.write(hit('B'), { flush: true })).toEqual({ written: 1, duplicates: 0 })
	})

	it('writes what it holds when the event loop runs dry, and nothing when it holds none', async () => {
		const store = fakeStore()
		const { writer, process } = buffered(store)
		await writer.write(hit('A'))
		process.emit('beforeExit')
		await settle()
		process.emit('beforeExit')
		await settle()
		expect(store.calls).toEqual([['A']])
	})

	it('writes what it holds on SIGTERM, then hands the signal back to Node', async () => {
		const store = fakeStore()
		const { writer, process } = buffered(store)
		await writer.write(hit('A'))
		process.emit('SIGTERM')
		await settle()
		expect(store.calls).toEqual([['A']])
		expect(process.count('SIGTERM')).toBe(0)
		expect(process.count('beforeExit')).toBe(0)
		expect(process.sent).toEqual(['SIGTERM to 4242'])
		await writer.write(hit('B'))
		expect(store.calls).toEqual([['A'], ['B']])
	})

	it('leaves the signal to a listener of the host that is still there to handle it', async () => {
		const store = fakeStore()
		const { writer, process } = buffered(store)
		process.signals.on('SIGTERM', () => undefined)
		await writer.write(hit('A'))
		process.emit('SIGTERM')
		await settle()
		expect(store.calls).toEqual([['A']])
		expect(process.count('SIGTERM')).toBe(1)
		expect(process.sent).toEqual([])
	})

	it('hands the signal back once, when the last of several writers has written', async () => {
		const slow = deferred()
		const process = fakeProcess()
		const fast = fakeStore()
		const held = fakeStore({ gate: slow.promise })
		const options = { buffer: true, signals: process.signals, env: {} }
		const first = createHitWriter({ store: fast.store, ...options })
		const second = createHitWriter({ store: held.store, ...options })
		await first.write(hit('A'))
		await second.write(hit('B'))
		process.emit('SIGTERM')
		await settle()
		expect(fast.stored).toEqual(['A'])
		expect(process.sent).toEqual([])
		slow.release()
		await settle()
		await settle()
		expect(held.stored).toEqual(['B'])
		expect(process.sent).toEqual(['SIGTERM to 4242'])
	})

	it('writes what it holds on SIGINT too, then hands that signal back', async () => {
		const store = fakeStore()
		const { writer, process } = buffered(store)
		await writer.write(hit('A'))
		process.emit('SIGINT')
		await settle()
		expect(store.calls).toEqual([['A']])
		expect(process.count('SIGINT') + process.count('SIGTERM') + process.count('exit')).toBe(0)
		expect(process.sent).toEqual(['SIGINT to 4242'])
	})

	it('names what is lost when the process exits before it could write it', async () => {
		const gate = deferred()
		const store = fakeStore({ gate: gate.promise })
		const { writer, process, log } = buffered(store)
		await writer.write(hit('A'))
		await writer.write(hit('B'))
		process.emit('exit')
		expect(log.warn).toHaveBeenCalledTimes(1)
		expect(log.warn.mock.calls[0]?.[0]).toContain('2 hits not stored yet')
		gate.release()
		await writer.close()
		process.emit('exit')
		expect(log.warn).toHaveBeenCalledTimes(1)
	})

	it('writes what it holds and takes its listeners back on close', async () => {
		const store = fakeStore()
		const { writer, process, timers } = buffered(store)
		await writer.write(hit('A'))
		await writer.close()
		expect(store.calls).toEqual([['A']])
		expect(
			process.count('SIGTERM') +
				process.count('SIGINT') +
				process.count('beforeExit') +
				process.count('exit')
		).toBe(0)
		expect(timers.armed()).toBe(0)
		await writer.write(hit('B'))
		expect(store.calls).toEqual([['A'], ['B']])
		expect(writer.pending()).toBe(0)
	})

	it("listens on Node's own process unless handed another, and lets go of it on close", async () => {
		const before = process.listenerCount('SIGTERM')
		const writer = createHitWriter({ store: fakeStore().store, buffer: true, env: {} })
		expect(process.listenerCount('SIGTERM')).toBe(before + 1)
		await writer.close()
		expect(process.listenerCount('SIGTERM')).toBe(before)
	})
})

describe('deferred work', () => {
	/** A writer without a buffer, on a hand-fired timer and a hand-moved clock. */
	const unbuffered = (store: ReturnType<typeof fakeStore>) => {
		const timers = manualTimers()
		const log = logger()
		const clock = { at: 0 }
		const process = fakeProcess()
		const writer = createHitWriter({
			store: store.store,
			logger: log,
			signals: process.signals,
			now: () => clock.at,
			setTimer: timers.setTimer,
		})
		return { writer, timers, log, clock, process }
	}

	it('waits while it is blocked, asking on a timer, and runs once it no longer is', async () => {
		const store = fakeStore()
		const { writer, timers } = unbuffered(store)
		const lock = { held: true }
		writer.defer(
			async () => {
				await writer.write(hit('A'))
			},
			() => lock.held
		)
		expect(timers.armed()).toBe(1)
		timers.fire()
		await settle()
		expect(store.calls).toEqual([])
		expect(timers.armed()).toBe(1)
		lock.held = false
		timers.fire()
		await settle()
		expect(store.stored).toEqual(['A'])
		expect(timers.armed()).toBe(0)
	})

	it('runs what may run when flushed, and waits for it, buffered writes included', async () => {
		const store = fakeStore()
		const { writer } = buffered(store)
		const lock = { held: true }
		writer.defer(
			async () => {
				await writer.write(hit('A'))
			},
			() => lock.held
		)
		await writer.flush()
		expect(store.stored).toEqual([])
		lock.held = false
		await writer.flush()
		expect(store.stored).toEqual(['A'])
	})

	it('holds at most MAX_DEFERRED waiting, dropping and logging the rest', async () => {
		const store = fakeStore()
		const { writer, log } = unbuffered(store)
		const ran: number[] = []
		for (let index = 0; index <= MAX_DEFERRED + 1; index++) {
			writer.defer(
				async () => {
					ran.push(index)
				},
				() => true
			)
		}
		expect(log.error).toHaveBeenCalledTimes(1)
		expect(log.error.mock.calls[0]?.[0]).toMatchObject({
			msg: expect.stringMatching(/server events .* were dropped/),
		})
		await writer.close()
		expect(ran).toHaveLength(MAX_DEFERRED)
	})

	it('runs anyway once it has waited ten minutes, and at once when the writer closes', async () => {
		const store = fakeStore()
		const { writer, timers, clock } = unbuffered(store)
		writer.defer(
			async () => {
				await writer.write(hit('A'))
			},
			() => true
		)
		clock.at += DEFER_MAX_MS
		timers.fire()
		await settle()
		expect(store.stored).toEqual(['A'])
		writer.defer(
			async () => {
				await writer.write(hit('B'))
			},
			() => true
		)
		await writer.close()
		expect(store.stored).toEqual(['A', 'B'])
		expect(timers.armed()).toBe(0)
	})

	it('never rejects, and logs what fails at most once a minute', async () => {
		const { writer, log, clock } = unbuffered(fakeStore({ refuse: () => true }))
		for (const id of ['A', 'B']) {
			writer.defer(
				async () => {
					await writer.write(hit(id))
				},
				() => false
			)
		}
		await writer.flush()
		expect(log.error).toHaveBeenCalledTimes(1)
		expect(log.error.mock.calls[0]?.[0]).toMatchObject({
			msg: expect.stringContaining('1 server events recorded inside a database transaction'),
			err: expect.any(Error),
		})
		clock.at += 60_000
		writer.defer(
			async () => {
				await writer.write(hit('C'))
			},
			() => false
		)
		await writer.flush()
		expect(log.error).toHaveBeenCalledTimes(2)
		expect(log.error.mock.calls[1]?.[0]).toMatchObject({
			msg: expect.stringContaining('2 server events recorded inside a database transaction'),
		})
	})

	it('listens to the process only once work waits, and runs it on SIGTERM before handing it back', async () => {
		const store = fakeStore()
		const { writer, process } = unbuffered(store)
		expect(process.count('SIGTERM')).toBe(0)
		writer.defer(
			async () => {
				await writer.write(hit('A'))
			},
			() => true
		)
		expect(process.count('SIGTERM')).toBe(1)
		expect(process.count('SIGINT')).toBe(1)
		process.emit('SIGTERM')
		await settle()
		expect(store.stored).toEqual(['A'])
		expect(process.count('SIGTERM') + process.count('SIGINT')).toBe(0)
		expect(process.sent).toEqual(['SIGTERM to 4242'])
	})

	it('runs waiting work once when the event loop runs dry, rather than holding the process', async () => {
		const store = fakeStore()
		const { writer, process } = unbuffered(store)
		writer.defer(
			async () => {
				await writer.write(hit('A'))
			},
			() => true
		)
		process.emit('beforeExit')
		await settle()
		expect(store.stored).toEqual(['A'])
		process.emit('beforeExit')
		await settle()
		expect(store.calls).toEqual([['A']])
		await writer.close()
		expect(process.count('beforeExit')).toBe(0)
	})

	it('runs work whose check throws rather than holding it forever', async () => {
		const store = fakeStore()
		const { writer } = unbuffered(store)
		writer.defer(
			async () => {
				await writer.write(hit('A'))
			},
			() => {
				throw new Error('no session map')
			}
		)
		await writer.flush()
		expect(store.stored).toEqual(['A'])
	})
})

describe('serverless platforms', () => {
	it('warns once, when the writer is made, that a buffer there loses what it holds', async () => {
		for (const name of ['VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'NETLIFY']) {
			const log = logger()
			const writer = createHitWriter({
				store: fakeStore().store,
				buffer: true,
				signals: fakeProcess().signals,
				env: { [name]: '1' },
				logger: log,
			})
			await writer.write(hit('A'))
			expect(log.warn).toHaveBeenCalledTimes(1)
			expect(log.warn.mock.calls[0]?.[0]).toContain(name)
			await writer.close()
		}
	})

	it('says nothing on a long-running server', () => {
		const log = logger()
		createHitWriter({
			store: fakeStore().store,
			buffer: true,
			signals: fakeProcess().signals,
			env: { VERCEL: '', HOME: '/home/app' },
			logger: log,
		})
		expect(log.warn).not.toHaveBeenCalled()
	})

	it('names the variable that gives a platform away', () => {
		expect(serverlessPlatformOf({ NETLIFY: 'true' })).toBe('NETLIFY')
		expect(serverlessPlatformOf({ AWS_LAMBDA_FUNCTION_NAME: 'ingest' })).toBe(
			'AWS_LAMBDA_FUNCTION_NAME'
		)
		expect(serverlessPlatformOf({})).toBeUndefined()
	})
})

describe('resolveWriteBuffer', () => {
	it('is off unless set, and takes the defaults for true', () => {
		expect(resolveWriteBuffer(undefined)).toBeNull()
		expect(resolveWriteBuffer(false)).toBeNull()
		expect(resolveWriteBuffer(true)).toEqual({ maxSize: 200, maxAgeMs: 1000, maxPending: 5000 })
		expect(resolveWriteBuffer(true)).toEqual(DEFAULT_WRITE_BUFFER)
		expect(resolveWriteBuffer({ maxSize: 50 })).toEqual({ ...DEFAULT_WRITE_BUFFER, maxSize: 50 })
	})

	it('fails the boot on limits no buffer could keep', () => {
		for (const maxSize of [0, -1, 1.5, Number.NaN]) {
			expect(() => resolveWriteBuffer({ maxSize })).toThrow(/buffer\.maxSize/)
		}
		expect(() => resolveWriteBuffer({ maxAgeMs: 0 })).toThrow(/buffer\.maxAgeMs/)
		expect(() => resolveWriteBuffer({ maxSize: 300, maxPending: 200 })).toThrow(
			/maxPending \(200\) must be at least buffer\.maxSize \(300\)/
		)
		expect(() => resolveWriteBuffer([] as never)).toThrow(/true, false or an object/)
		expect(() => resolveWriteBuffer('yes' as never)).toThrow(/true, false or an object/)
	})
})
