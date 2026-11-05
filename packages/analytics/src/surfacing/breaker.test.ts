import { describe, expect, it } from 'vitest'
import { BREAKER_BASE_MS, BREAKER_MAX_MS, createBreaker, PROBE_EXPIRES_MS } from './breaker'
import type { ReadFailure } from './classifyError'

const outage = { kind: 'unavailable' as const }
const misconfigured = { kind: 'source_misconfigured' as const }

const setup = () => {
	const clock = { at: 0 }
	return { clock, breaker: createBreaker({ now: () => clock.at }) }
}

/** Admits one run and reports its outcome, the way a lane does. */
const runOnce = (
	breaker: ReturnType<typeof setup>['breaker'],
	outcome: 'success' | ReadFailure
) => {
	const admission = breaker.admit()
	if (admission.ok) {
		breaker.record(outcome, admission.probe)
	}
	return admission
}

describe('createBreaker', () => {
	it('opens after five consecutive outages, and a success between them starts the count again', () => {
		const { breaker } = setup()
		for (let i = 0; i < 4; i++) runOnce(breaker, outage)
		runOnce(breaker, 'success')
		for (let i = 0; i < 4; i++) runOnce(breaker, outage)
		expect(breaker.snapshot().state).toBe('closed')
		runOnce(breaker, outage)
		expect(breaker.snapshot()).toMatchObject({
			state: 'open',
			retryAfterMs: BREAKER_BASE_MS,
			lastFailure: outage,
		})
	})

	it('opens on the first setup failure', () => {
		const { breaker } = setup()
		runOnce(breaker, misconfigured)
		expect(breaker.snapshot()).toMatchObject({ state: 'open', lastFailure: misconfigured })
	})

	it('counts a refused query as an answer, not a failure', () => {
		const { breaker } = setup()
		for (let i = 0; i < 4; i++) runOnce(breaker, outage)
		runOnce(breaker, { kind: 'invalid_param' })
		runOnce(breaker, outage)
		expect(breaker.snapshot().state).toBe('closed')
	})

	it('counts a read refused as too big before it ran as an answer, however often it comes', () => {
		const { breaker } = setup()
		const refused: ReadFailure = { kind: 'unavailable', timeout: true, refused: true }
		for (let i = 0; i < 10; i++) runOnce(breaker, refused)
		expect(breaker.snapshot().state).toBe('closed')
		for (let i = 0; i < 4; i++) runOnce(breaker, outage)
		runOnce(breaker, refused)
		runOnce(breaker, outage)
		expect(breaker.snapshot().state).toBe('closed')
	})

	it('refuses while open, saying how long is left, without claiming anything on peek', () => {
		const { breaker, clock } = setup()
		runOnce(breaker, misconfigured)
		clock.at = 10_000
		expect(breaker.peek()).toEqual({ ok: false, retryAfterMs: 20_000 })
		expect(breaker.admit()).toEqual({ ok: false, retryAfterMs: 20_000 })
	})

	it('lets one probe through once the wait is over, and closes on its success', () => {
		const { breaker, clock } = setup()
		runOnce(breaker, misconfigured)
		clock.at = BREAKER_BASE_MS
		expect(breaker.peek()).toEqual({ ok: true, probe: true })
		const probe = breaker.admit()
		expect(probe).toEqual({ ok: true, probe: true })
		expect(breaker.admit()).toMatchObject({ ok: false })
		expect(breaker.snapshot().state).toBe('half-open')
		breaker.record('success', true)
		expect(breaker.snapshot()).toEqual({ state: 'closed' })
		expect(breaker.admit()).toEqual({ ok: true, probe: false })
	})

	it('doubles the wait after each failed probe, up to ten minutes, and resets it once healthy', () => {
		const { breaker, clock } = setup()
		runOnce(breaker, misconfigured)
		let wait = BREAKER_BASE_MS
		for (let i = 0; i < 6; i++) {
			clock.at += wait
			runOnce(breaker, outage)
			wait = Math.min(wait * 2, BREAKER_MAX_MS)
			expect(breaker.snapshot().retryAfterMs).toBe(wait)
		}
		expect(wait).toBe(BREAKER_MAX_MS)
		clock.at += wait
		runOnce(breaker, 'success')
		runOnce(breaker, misconfigured)
		expect(breaker.snapshot().retryAfterMs).toBe(BREAKER_BASE_MS)
	})

	it('lets the next run probe once a probe has gone unanswered too long', () => {
		const { breaker, clock } = setup()
		runOnce(breaker, misconfigured)
		clock.at = BREAKER_BASE_MS
		expect(breaker.admit()).toEqual({ ok: true, probe: true })
		clock.at += PROBE_EXPIRES_MS - 1
		expect(breaker.admit()).toEqual({ ok: false, retryAfterMs: 1 })
		clock.at += 1
		expect(breaker.admit()).toEqual({ ok: true, probe: true })
		breaker.record('success', true)
		expect(breaker.snapshot()).toEqual({ state: 'closed' })
	})

	it('hands a claimed probe back to the next run when its request never went out', () => {
		const { breaker, clock } = setup()
		runOnce(breaker, misconfigured)
		clock.at = BREAKER_BASE_MS
		expect(breaker.admit()).toEqual({ ok: true, probe: true })
		expect(breaker.admit()).toMatchObject({ ok: false })
		breaker.release()
		expect(breaker.admit()).toEqual({ ok: true, probe: true })
	})
})
