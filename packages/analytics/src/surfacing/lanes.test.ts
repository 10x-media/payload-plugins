import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import type { AnalyticsAdapter, RateLimitDescriptor } from '../core/contract'
import { createPoolShare } from '../native/store/sql/poolShare'
import { memoryAdapter } from '../testing/memoryAdapter'
import { SCOPE_STATE_CAPACITY } from './bounded'
import { BREAKER_BASE_MS } from './breaker'
import { isLaneRefused, type LaneRefusedError } from './classifyError'
import {
	ABANDON_AFTER_MS,
	createLanes,
	type Lane,
	MAX_POOLED_CONCURRENCY,
	type Priority,
	pooledConcurrency,
	RETRY_BASE_MS,
	runUpstream,
} from './lanes'

const source = (id: string, rateLimit: RateLimitDescriptor | null = null): AnalyticsAdapter => {
	const base = memoryAdapter()
	return { ...base, id, capabilities: { ...base.capabilities, rateLimit } }
}

/** A request that stays out until the test lets it answer. */
const held = () => {
	let release: () => void = () => {}
	const answered = new Promise<string>((resolve) => {
		release = () => resolve('answered')
	})
	return { fn: () => answered, release }
}

const options = (overrides: { priority?: Priority; deadline?: number } = {}) => ({
	signal: new AbortController().signal,
	priority: overrides.priority ?? ('interactive' as const),
	...(overrides.deadline === undefined ? {} : { deadline: overrides.deadline }),
})

/** A run that records when its request went out, then waits on the gate. */
const started = (
	lane: Lane,
	run: { label: string; log: string[]; gate: Promise<unknown>; priority?: Priority }
) =>
	lane.run(
		async () => {
			run.log.push(run.label)
			await run.gate
			return run.label
		},
		options({ priority: run.priority ?? 'interactive' })
	)

describe('createLanes', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('keeps one lane per adapter instance, never one per id', () => {
		const lanes = createLanes()
		const a = source('plausible')
		expect(lanes.for(a)).toBe(lanes.for(a))
		expect(lanes.for(source('plausible'))).not.toBe(lanes.for(a))
	})

	it('keys lanes by scope and id for adapters built anew on every read, never across scopes', () => {
		const shared = source('native')
		const lanes = createLanes({ rebuilt: (adapter) => adapter !== shared })
		const a = source('plausible')
		expect(lanes.for(source('plausible'), 't1')).toBe(lanes.for(a, 't1'))
		expect(lanes.for(source('plausible'), 't2')).not.toBe(lanes.for(a, 't1'))
		expect(lanes.for(source('plausible'))).not.toBe(lanes.for(a, 't1'))
		expect(lanes.for(source('plausible:2'), 't1')).not.toBe(lanes.for(a, 't1'))
		expect(lanes.for(shared, 't1')).toBe(lanes.for(shared, 't1'))
		expect(lanes.for(shared, 't1')).not.toBe(lanes.for(shared, 't2'))
	})

	it("counts failures per scope on a lane every scope shares, so one scope's timeouts rest no other", async () => {
		const lanes = createLanes()
		const shared = source('native')
		for (let attempt = 0; attempt < 5; attempt++) {
			await expect(
				lanes.for(shared, 'alpha').run(async () => {
					throw Object.assign(new Error('slow'), { name: 'ReadTimeoutError' })
				}, options())
			).rejects.toThrow('slow')
		}
		expect(lanes.for(shared, 'alpha').health()).toMatchObject({ open: true })
		expect(lanes.for(shared, 'beta').health()).toEqual({ open: false })
		await expect(lanes.for(shared, 'beta').run(async () => 'beta', options())).resolves.toBe('beta')
	})

	it('never opens the breaker for queries the database refused as written', async () => {
		const lanes = createLanes()
		const shared = source('native')
		const badPattern = Object.assign(new Error('Regular expression is invalid'), {
			name: 'MongoServerError',
			code: 51091,
			codeName: 'Location51091',
		})
		for (let attempt = 0; attempt < 8; attempt++) {
			await expect(
				lanes.for(shared, 'alpha').run(async () => {
					throw badPattern
				}, options())
			).rejects.toBe(badPattern)
		}
		expect(lanes.for(shared, 'alpha').health()).toEqual({ open: false })
	})

	it("holds one scope to half the slots of a shared lane, so another scope's read starts at once", async () => {
		const lanes = createLanes({
			local: { is: (adapter) => adapter.id === 'native', capacity: 4 },
			shared: () => true,
		})
		const native = source('native')
		const log: string[] = []
		const gate = held()
		const gateAnswered = gate.fn()
		for (const label of ['a1', 'a2', 'a3', 'a4']) {
			void started(lanes.for(native, 'alpha'), { label, log, gate: gateAnswered })
		}
		const beta = started(lanes.for(native, 'beta'), { label: 'b1', log, gate: Promise.resolve() })
		await vi.advanceTimersByTimeAsync(0)
		expect(log).toEqual(['a1', 'a2', 'b1'])
		await expect(beta).resolves.toBe('b1')
		gate.release()
		await vi.advanceTimersByTimeAsync(0)
		expect(log).toEqual(['a1', 'a2', 'b1', 'a3', 'a4'])
	})

	it('lets the install-wide scope use the whole of a shared lane', async () => {
		const lanes = createLanes({
			local: { is: (adapter) => adapter.id === 'native', capacity: 4 },
			shared: () => true,
		})
		const native = source('native')
		const log: string[] = []
		const gate = held()
		const gateAnswered = gate.fn()
		for (const label of ['n1', 'n2', 'n3', 'n4']) {
			void started(lanes.for(native, null), { label, log, gate: gateAnswered })
		}
		await vi.advanceTimersByTimeAsync(0)
		expect(log).toEqual(['n1', 'n2', 'n3', 'n4'])
		gate.release()
	})

	it('forgets the clean breakers of scopes past its capacity before one that counted a failure', async () => {
		const lanes = createLanes()
		const shared = source('plausible')
		await expect(
			lanes.for(shared, 'kept').run(async () => {
				throw new ProviderHttpError(401, 'plausible', 'bad key')
			}, options())
		).rejects.toThrow('bad key')
		for (let index = 0; index < SCOPE_STATE_CAPACITY + 10; index++) {
			await lanes.for(shared, `made-up-${index}`).run(async () => 'ok', options())
		}
		expect(lanes.for(shared, 'kept').health()).toMatchObject({ open: true })
	})

	it('keeps at most its capacity of lanes for adapters built anew per scope', () => {
		const lanes = createLanes({ rebuilt: () => true })
		const first = lanes.for(source('plausible'), 'first')
		for (let index = 0; index < SCOPE_STATE_CAPACITY; index++) {
			lanes.for(source('plausible'), `made-up-${index}`)
		}
		expect(lanes.for(source('plausible'), 'first')).not.toBe(first)
	})

	it('rests one tenant’s source after a refused key and leaves another tenant’s of the same id', async () => {
		const lanes = createLanes({ rebuilt: () => true })
		const refused = lanes.for(source('plausible'), 't1').run(async () => {
			throw new ProviderHttpError(401, 'plausible', 'bad key')
		}, options())
		await expect(refused).rejects.toThrow('bad key')
		expect(lanes.for(source('plausible'), 't1').health()).toMatchObject({ open: true })
		expect(lanes.for(source('plausible'), 't2').health()).toEqual({ open: false })
		await expect(
			lanes.for(source('plausible'), 't2').run(async () => 'answered', options())
		).resolves.toBe('answered')
	})

	it('holds no slot while a failed request waits out its backoff', async () => {
		const lanes = createLanes({ perSource: 1 })
		const lane = lanes.for(source('vendor'))
		let calls = 0
		const flaky = runUpstream(
			lane,
			async () => {
				calls++
				if (calls === 1) {
					throw new ProviderHttpError(503, 'vendor', 'down')
				}
				return 'recovered'
			},
			{ ...options(), now: () => Date.now() }
		)
		await vi.advanceTimersByTimeAsync(0)
		expect(calls).toBe(1)
		// The lane's single slot is free during the backoff, so another request goes straight out.
		const other = await lane.run(async () => 'other', options())
		expect(other).toBe('other')
		await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
		await expect(flaky).resolves.toBe('recovered')
		expect(calls).toBe(2)
	})

	it('keeps a local lane (native) out of the global cap', async () => {
		const lanes = createLanes({ global: 1, local: { is: (adapter) => adapter.id === 'native' } })
		const vendor = held()
		const busy = lanes.for(source('vendor')).run(vendor.fn, options())
		const queued = lanes.for(source('other-vendor')).run(async () => 'queued', options())
		const local = lanes.for(source('native')).run(async () => 'local', options())
		await expect(local).resolves.toBe('local')
		let queuedDone = false
		void queued.then(() => {
			queuedDone = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(queuedDone).toBe(false)
		vendor.release()
		await expect(busy).resolves.toBe('answered')
		await expect(queued).resolves.toBe('queued')
	})

	it('takes its slot count from rateLimit.maxConcurrent, else perSource', async () => {
		const lanes = createLanes({ perSource: 1 })
		const lane = lanes.for(source('ga4', { maxConcurrent: 2 }))
		const first = held()
		const second = held()
		const log: string[] = []
		void lane.run(async () => {
			log.push('a')
			return first.fn()
		}, options())
		void lane.run(async () => {
			log.push('b')
			return second.fn()
		}, options())
		await vi.advanceTimersByTimeAsync(0)
		expect(log).toEqual(['a', 'b'])
		first.release()
		second.release()
	})

	it('pauses the lane for a Retry-After, holding no slot, and refuses a read that cannot wait that long', async () => {
		const lanes = createLanes()
		const lane = lanes.for(source('vendor'))
		await expect(
			lane.run(async () => {
				throw new ProviderHttpError(429, 'vendor', { message: 'slow down', retryAfterMs: 5000 })
			}, options())
		).rejects.toMatchObject({ status: 429 })
		expect(lane.health()).toMatchObject({ open: false, retryAfterMs: 5000 })

		const refused = lane.run(async () => 'never', options({ deadline: performance.now() + 1000 }))
		await expect(refused).rejects.toSatisfy(isLaneRefused)
		await expect(refused).rejects.toMatchObject({ reason: 'paused', retryAfterMs: 5000 })

		let sent = false
		const waiting = lane.run(async () => {
			sent = true
			return 'after the pause'
		}, options())
		await vi.advanceTimersByTimeAsync(4999)
		expect(sent).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		await expect(waiting).resolves.toBe('after the pause')
	})

	it('serves readers before background work, and never gives background more than half a lane', async () => {
		const lanes = createLanes({ perSource: 4 })
		const lane = lanes.for(source('vendor'))
		const gate = held()
		const log: string[] = []
		for (const label of ['b1', 'b2', 'b3']) {
			void started(lane, { label, log, gate: gate.fn(), priority: 'background' })
		}
		await vi.advanceTimersByTimeAsync(0)
		// Two of four slots: the third background run waits although two slots are free.
		expect(log).toEqual(['b1', 'b2'])
		void started(lane, { label: 'i1', log, gate: gate.fn() })
		void started(lane, { label: 'i2', log, gate: gate.fn() })
		void started(lane, { label: 'i3', log, gate: gate.fn() })
		await vi.advanceTimersByTimeAsync(0)
		expect(log).toEqual(['b1', 'b2', 'i1', 'i2'])
		gate.release()
		await vi.advanceTimersByTimeAsync(0)
		// The waiting reader goes before the background run that waited longer.
		expect(log.slice(4)).toEqual(['i3', 'b3'])
	})

	it('serves interactive reads before normal ones, and normal ones before background work', async () => {
		const lane = createLanes({ perSource: 1 }).for(source('vendor'))
		const log: string[] = []
		const first = held()
		void started(lane, { label: 'held', log, gate: first.fn() })
		const rest = Promise.resolve()
		void started(lane, { label: 'background', log, gate: rest, priority: 'background' })
		void started(lane, { label: 'normal', log, gate: rest, priority: 'normal' })
		void started(lane, { label: 'interactive', log, gate: rest })
		await vi.advanceTimersByTimeAsync(0)
		expect(log).toEqual(['held'])
		first.release()
		await vi.advanceTimersByTimeAsync(0)
		expect(log).toEqual(['held', 'interactive', 'normal', 'background'])
	})

	it('opens on a setup failure and answers at once while open, with how long is left', async () => {
		const lanes = createLanes()
		const lane = lanes.for(source('vendor'))
		await expect(
			lane.run(async () => {
				throw new ProviderHttpError(401, 'vendor', 'bad key')
			}, options())
		).rejects.toMatchObject({ status: 401 })
		expect(lane.health()).toEqual({
			open: true,
			retryAfterMs: BREAKER_BASE_MS,
			lastFailure: 'source_misconfigured',
		})
		const fn = vi.fn(async () => 'never')
		const refusal: LaneRefusedError = await lane.run(fn, options()).then(
			() => {
				throw new Error('expected a refusal')
			},
			(err: LaneRefusedError) => err
		)
		expect(refusal).toMatchObject({ reason: 'open', retryAfterMs: BREAKER_BASE_MS })
		expect(fn).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(BREAKER_BASE_MS)
		await expect(lane.run(async () => 'probe', options())).resolves.toBe('probe')
		expect(lane.health()).toEqual({ open: false })
	})

	it('turns away the runs behind a half-open probe before they spend a rate token', async () => {
		const lanes = createLanes()
		const lane = lanes.for(source('vendor', { requestsPerMinute: 2 }))
		await expect(
			lane.run(async () => {
				throw new ProviderHttpError(401, 'vendor', 'bad key')
			}, options())
		).rejects.toMatchObject({ status: 401 })
		await vi.advanceTimersByTimeAsync(BREAKER_BASE_MS)
		const probe = held()
		const probing = lane.run(probe.fn, options())
		const behind = lane.run(async () => 'behind', options())
		await expect(behind).rejects.toMatchObject({ reason: 'open' })
		probe.release()
		await expect(probing).resolves.toBe('answered')
		let sent = false
		const next = lane.run(async () => {
			sent = true
			return 'next'
		}, options())
		await vi.advanceTimersByTimeAsync(0)
		expect(sent).toBe(true)
		await expect(next).resolves.toBe('next')
	})

	it('gives a claimed probe back when its run stops before the request goes out', async () => {
		const lanes = createLanes()
		const lane = lanes.for(source('vendor', { requestsPerMinute: 1 }))
		await expect(
			lane.run(async () => {
				throw new ProviderHttpError(401, 'vendor', 'bad key')
			}, options())
		).rejects.toMatchObject({ status: 401 })
		await vi.advanceTimersByTimeAsync(BREAKER_BASE_MS)
		// The probe is claimed, then waits half a minute for the bucket's next token.
		const controller = new AbortController()
		const gaveUp = lane.run(async () => 'never', {
			signal: controller.signal,
			priority: 'interactive',
		})
		const settled = expect(gaveUp).rejects.toThrow('gave up')
		await vi.advanceTimersByTimeAsync(0)
		controller.abort(new Error('gave up'))
		await settled
		const probing = lane.run(async () => 'probe', options())
		await vi.advanceTimersByTimeAsync(30_000)
		await expect(probing).resolves.toBe('probe')
	})

	it('never retries a spent quota at once', async () => {
		const lanes = createLanes()
		const lane = lanes.for(source('vendor'))
		const exhausted = vi.fn(async (): Promise<string> => {
			throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 })
		})
		await expect(
			runUpstream(lane, exhausted, { ...options(), now: () => Date.now() })
		).rejects.toThrow('RESOURCE_EXHAUSTED')
		expect(exhausted).toHaveBeenCalledTimes(1)
	})

	it('opens after five consecutive outages, counting each attempt', async () => {
		const lanes = createLanes()
		const lane = lanes.for(source('vendor'))
		const down = async (): Promise<string> => {
			throw new ProviderHttpError(503, 'vendor', 'down')
		}
		const read = runUpstream(lane, down, { ...options(), now: () => Date.now() })
		const failed = expect(read).rejects.toMatchObject({ status: 503 })
		await vi.advanceTimersByTimeAsync(5000)
		await failed
		expect(lane.health().open).toBe(false)
		const second = runUpstream(lane, down, { ...options(), now: () => Date.now() })
		const refused = expect(second).rejects.toSatisfy(isLaneRefused)
		await vi.advanceTimersByTimeAsync(5000)
		await refused
		expect(lane.health()).toMatchObject({ open: true, lastFailure: 'unavailable' })
	})

	it('stops waiting at the abort but keeps the slot until the request settles', async () => {
		const lanes = createLanes({ perSource: 1 })
		const lane = lanes.for(source('vendor'))
		const request = held()
		const controller = new AbortController()
		const reason = new Error('gave up')
		const run = lane.run(request.fn, { signal: controller.signal, priority: 'interactive' })
		const aborted = expect(run).rejects.toBe(reason)
		await vi.advanceTimersByTimeAsync(0)
		controller.abort(reason)
		await aborted
		let next = false
		void lane.run(async () => {
			next = true
			return 'next'
		}, options())
		await vi.advanceTimersByTimeAsync(0)
		expect(next).toBe(false)
		request.release()
		await vi.advanceTimersByTimeAsync(0)
		expect(next).toBe(true)
	})

	it('gives back the slots of a request that ignores its abort and never settles, counted as a timeout', async () => {
		const onAbandon = vi.fn()
		const lanes = createLanes({ perSource: 1, global: 1, breaker: { threshold: 2 }, onAbandon })
		const vendor = source('vendor')
		const lane = lanes.for(vendor)
		const other = lanes.for(source('other'))
		const hang = async (): Promise<string> => new Promise<string>(() => {})
		const runHung = async (): Promise<void> => {
			const controller = new AbortController()
			const run = lane.run(hang, { signal: controller.signal, priority: 'interactive' })
			const aborted = expect(run).rejects.toThrow('timeout')
			await vi.advanceTimersByTimeAsync(0)
			controller.abort(new Error('timeout'))
			await aborted
		}
		await runHung()
		let next = false
		const waiting = other.run(async () => {
			next = true
			return 'next'
		}, options())
		await vi.advanceTimersByTimeAsync(ABANDON_AFTER_MS - 1)
		expect(next).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		await expect(waiting).resolves.toBe('next')
		expect(lane.health()).toMatchObject({ open: false, lastFailure: 'unavailable', abandoned: 1 })
		expect(onAbandon).toHaveBeenCalledWith(vendor)
		await runHung()
		await vi.advanceTimersByTimeAsync(ABANDON_AFTER_MS)
		expect(lane.health()).toMatchObject({ open: true, abandoned: 2 })
		expect(onAbandon).toHaveBeenCalledTimes(1)
	})

	it('keeps the outcome of a request that settles within the grace after its abort', async () => {
		const lanes = createLanes({ perSource: 1 })
		const lane = lanes.for(source('vendor'))
		const request = held()
		const controller = new AbortController()
		const run = lane.run(request.fn, { signal: controller.signal, priority: 'interactive' })
		const aborted = expect(run).rejects.toThrow('gave up')
		await vi.advanceTimersByTimeAsync(0)
		controller.abort(new Error('gave up'))
		await aborted
		request.release()
		await vi.advanceTimersByTimeAsync(ABANDON_AFTER_MS)
		expect(lane.health()).toEqual({ open: false })
	})
})

describe('runUpstream', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('retries an outage twice and gives up with its error', async () => {
		const lane = createLanes().for(source('vendor'))
		const fn = vi.fn(async (): Promise<string> => {
			throw new ProviderHttpError(502, 'vendor', 'bad gateway')
		})
		const read = runUpstream(lane, fn, { ...options(), now: () => Date.now() })
		const failed = expect(read).rejects.toMatchObject({ status: 502 })
		await vi.advanceTimersByTimeAsync(5000)
		await failed
		expect(fn).toHaveBeenCalledTimes(3)
	})

	it('never retries a refused query, a setup failure or a timeout', async () => {
		for (const err of [
			new ProviderHttpError(400, 'vendor', 'bad query'),
			new ProviderHttpError(403, 'vendor', 'forbidden'),
			Object.assign(new Error('deadline'), { code: 4 }),
		]) {
			const lane = createLanes().for(source('vendor'))
			const fn = vi.fn(async (): Promise<string> => {
				throw err
			})
			await expect(runUpstream(lane, fn, { ...options(), now: () => Date.now() })).rejects.toBe(err)
			expect(fn).toHaveBeenCalledTimes(1)
		}
	})

	it('gives up rather than back off past the deadline', async () => {
		const lane = createLanes().for(source('vendor'))
		const err = new ProviderHttpError(503, 'vendor', 'down')
		const fn = vi.fn(async (): Promise<string> => {
			throw err
		})
		await expect(
			runUpstream(lane, fn, {
				...options({ deadline: Date.now() + RETRY_BASE_MS - 1 }),
				now: () => Date.now(),
			})
		).rejects.toBe(err)
		expect(fn).toHaveBeenCalledTimes(1)
	})
})

describe('pooledConcurrency', () => {
	it("admits a third of the pool's reads, never more than the engine's long-work share", () => {
		expect(pooledConcurrency(10)).toBe(3)
		expect(pooledConcurrency(1)).toBe(1)
		expect(pooledConcurrency(100)).toBe(MAX_POOLED_CONCURRENCY)
		for (let poolMax = 1; poolMax <= 40; poolMax++) {
			expect(pooledConcurrency(poolMax)).toBeLessThanOrEqual(createPoolShare(poolMax).longLimit)
		}
	})
})
