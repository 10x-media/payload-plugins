import { beforeEach, describe, expect, it } from 'vitest'
import { CAPTURE_SLOTS } from '../capture/slots'
import type { TrackerSlotConfig } from './config'
import {
	answeredSnapshot,
	appendGateAnswer,
	createGate,
	createGateQueue,
	forgetLegacyConsent,
	GATE_QUEUE_LIMIT,
	GATE_SLOTS,
	gateAnswer,
	LEGACY_CONSENT_KEYS,
	openAtBoot,
	queueable,
	settleGateAnswers,
	slotIsGated,
} from './gate'
import type { TrackerEvent, TrackerWindow } from './types'

const slot = (extra: Partial<TrackerSlotConfig> = {}): TrackerSlotConfig => ({
	slot: 'tenant',
	kind: 'posthog',
	adapterId: 'posthog',
	path: '/api/_x/p/tenant',
	snippet: { scripts: [] },
	client: { kind: 'posthog', token: 'phc' },
	gated: true,
	...extra,
})

const engagement: TrackerEvent = {
	type: 'engagement',
	path: '/',
	hostname: 'site.test',
	durationMs: 4000,
}

describe('the slots', () => {
	it('lists every capture slot, in slot order', () => {
		expect(GATE_SLOTS).toEqual(CAPTURE_SLOTS)
	})
})

describe('createGateQueue', () => {
	it('drains in FIFO order and empties itself', () => {
		const queue = createGateQueue<number>()
		queue.push(1)
		queue.push(2)
		expect(queue.size).toBe(2)
		expect(queue.drain()).toEqual([1, 2])
		expect(queue.size).toBe(0)
		expect(queue.drain()).toEqual([])
	})

	it('drops the oldest entry past the limit of 100', () => {
		const queue = createGateQueue<number>()
		for (let i = 0; i < GATE_QUEUE_LIMIT + 5; i += 1) {
			queue.push(i)
		}
		const drained = queue.drain()
		expect(GATE_QUEUE_LIMIT).toBe(100)
		expect(drained).toHaveLength(GATE_QUEUE_LIMIT)
		expect(drained[0]).toBe(5)
		expect(drained.at(-1)).toBe(GATE_QUEUE_LIMIT + 4)
	})

	it('clears without draining', () => {
		const queue = createGateQueue<number>()
		queue.push(1)
		queue.clear()
		expect(queue.drain()).toEqual([])
	})
})

describe('queueable', () => {
	it('queues an engagement for a native slot alone', () => {
		expect(queueable(engagement, 'native')).toEqual(engagement)
		expect(queueable(engagement, 'posthog')).toBeNull()
		expect(queueable(engagement, 'ga4')).toBeNull()
	})

	it('queues every other event for any slot', () => {
		const event: TrackerEvent = { type: 'event', name: 'signup', path: '/', hostname: 'site.test' }
		expect(queueable(event, 'plausible')).toEqual(event)
	})

	it('leaves the items seen behind, and an engagement with nothing else is not queued', () => {
		expect(queueable({ ...engagement, impressions: ['offers:1'] }, 'native')).toEqual(engagement)
		expect(
			queueable(
				{ type: 'engagement', path: '/', hostname: 'site.test', impressions: ['offers:1'] },
				'native'
			)
		).toBeNull()
	})
})

describe('slotIsGated', () => {
	it('reads gated, falls back to a cached requiresConsent, and holds a slot carrying neither', () => {
		const { gated: _gated, ...cached } = slot()
		const legacy = (extra: Record<string, unknown>): TrackerSlotConfig =>
			({ ...cached, ...extra }) as unknown as TrackerSlotConfig

		expect(slotIsGated(slot({ gated: false }))).toBe(false)
		expect(slotIsGated(slot({ gated: true }))).toBe(true)
		expect(slotIsGated(legacy({ requiresConsent: false }))).toBe(false)
		expect(slotIsGated(legacy({ requiresConsent: true }))).toBe(true)
		expect(slotIsGated(legacy({}))).toBe(true)
		expect(slotIsGated(legacy({ requiresConsent: 'no' }))).toBe(true)
	})
})

describe('gateAnswer and openAtBoot', () => {
	it('answers a held slot with a boolean, and any slot by name', () => {
		expect(gateAnswer(true, 'tenant', true)).toBe(true)
		expect(gateAnswer(false, 'tenant', false)).toBeUndefined()
		expect(gateAnswer({ tenant: false }, 'tenant', false)).toBe(false)
		expect(gateAnswer({ tenant: true }, 'global', true)).toBeUndefined()
		expect(gateAnswer(undefined, 'tenant', true)).toBeUndefined()
	})

	it('opens a slot at boot on the server answer, else when it is not held', () => {
		expect(openAtBoot(slot(), undefined)).toBe(false)
		expect(openAtBoot(slot(), { tenant: true })).toBe(true)
		expect(openAtBoot(slot({ gated: false }), undefined)).toBe(true)
		expect(openAtBoot(slot({ gated: false }), false)).toBe(true)
		expect(openAtBoot(slot({ gated: false }), { tenant: false })).toBe(false)
	})
})

describe('createGate', () => {
	const ungatedGlobal = slot({ slot: 'global', gated: false })
	const both = [slot({ slot: 'global' }), slot()]

	it('starts a held slot pending and an ungated one open', () => {
		const gate = createGate([ungatedGlobal, slot()])
		expect(gate.snapshot).toEqual({ global: 'open', tenant: 'pending' })
	})

	it('moves the slots an answer covers, saying from where and to where', () => {
		const gate = createGate([ungatedGlobal, slot()])
		expect(gate.answer(true)).toEqual([{ slot: 'tenant', from: 'pending', to: 'open' }])
		expect(gate.answer(false)).toEqual([{ slot: 'tenant', from: 'open', to: 'closed' }])
		expect(gate.answer({ global: false })).toEqual([{ slot: 'global', from: 'open', to: 'closed' }])
		expect(gate.snapshot).toEqual({ global: 'closed', tenant: 'closed' })
	})

	it('treats the first explicit answer as a move, and a repeat as none', () => {
		const gate = createGate([ungatedGlobal, slot()])
		const before = gate.snapshot
		expect(gate.answer({ global: true })).toEqual([{ slot: 'global', from: 'open', to: 'open' }])
		expect(gate.snapshot).toBe(before)
		expect(gate.answer({ global: true })).toEqual([])
		expect(gate.answer({ tenant: undefined })).toEqual([])
	})

	it('reopens a closed slot', () => {
		const gate = createGate(both)
		gate.answer(false)
		expect(gate.answer({ tenant: true })).toEqual([{ slot: 'tenant', from: 'closed', to: 'open' }])
		expect(gate.status('tenant')).toBe('open')
		expect(gate.status('global')).toBe('closed')
	})

	// The tenant slot of an unscoped install, or one whose adapter declares no capture.
	it('reads a slot the config does not fill as closed, and no answer moves it', () => {
		const gate = createGate([ungatedGlobal])
		expect(gate.snapshot).toEqual({ global: 'open', tenant: 'closed' })
		expect(gate.answer(true)).toEqual([])
		expect(gate.answer({ tenant: true })).toEqual([])
		expect(gate.status('tenant')).toBe('closed')
		expect(createGate([]).snapshot).toEqual({ global: 'closed', tenant: 'closed' })
	})
})

describe('appendGateAnswer, settleGateAnswers and answeredSnapshot', () => {
	const ungatedGlobal = slot({ slot: 'global', gated: false })
	const both = [slot({ slot: 'global' }), slot()]

	it('keeps the latest boolean and the latest named answer per slot', () => {
		let answers = appendGateAnswer([], true)
		answers = appendGateAnswer(answers, { tenant: false, global: undefined })
		answers = appendGateAnswer(answers, false)
		answers = appendGateAnswer(answers, { tenant: true })
		expect(answers).toEqual([false, { tenant: true }])
	})

	it('replays to the same gate as the full history', () => {
		const history = [true, { tenant: false }, { global: false }, true]
		let answers: ReturnType<typeof appendGateAnswer> = []
		const full = createGate(both)
		for (const state of history) {
			answers = appendGateAnswer(answers, state)
			full.answer(state)
		}
		const replayed = createGate(both)
		for (const state of answers) {
			replayed.answer(state)
		}
		expect(replayed.snapshot).toEqual(full.snapshot)
		expect(answeredSnapshot(answers, both)).toEqual(full.snapshot)
	})

	it('settles answers into one boot answer, a boolean reaching only the slots held', () => {
		expect(settleGateAnswers([ungatedGlobal, slot()], [true])).toEqual({ tenant: true })
		expect(
			settleGateAnswers([ungatedGlobal, slot()], [{ global: true }, false, { tenant: true }])
		).toEqual({ global: true, tenant: true })
		expect(settleGateAnswers([ungatedGlobal], [{ tenant: undefined }])).toBeUndefined()
		expect(settleGateAnswers([], [false])).toEqual({ global: false, tenant: false })
	})

	it('reads pending for a slot no answer spoke for', () => {
		expect(answeredSnapshot([{ tenant: true }])).toEqual({ global: 'pending', tenant: 'open' })
		expect(answeredSnapshot([])).toEqual({ global: 'pending', tenant: 'pending' })
	})

	// Before any config, a refusal closes a held slot and leaves an ungated one open: unknown.
	it('reads an answer the slots would take differently as pending until the config says', () => {
		expect(answeredSnapshot([true])).toEqual({ global: 'open', tenant: 'open' })
		expect(answeredSnapshot([false])).toEqual({ global: 'pending', tenant: 'pending' })
		expect(answeredSnapshot([false, { global: false }])).toEqual({
			global: 'closed',
			tenant: 'pending',
		})
		expect(answeredSnapshot([{ global: false }, true])).toEqual({
			global: 'pending',
			tenant: 'open',
		})
	})

	it('reads the gate a tracker would boot with once the config is known', () => {
		expect(answeredSnapshot([false], [ungatedGlobal, slot()])).toEqual({
			global: 'open',
			tenant: 'closed',
		})
		expect(answeredSnapshot([], [ungatedGlobal])).toEqual({ global: 'open', tenant: 'closed' })
	})
})

describe('forgetLegacyConsent', () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it('deletes the key 1.0.0-beta.11 wrote and nothing else', () => {
		window.localStorage.setItem('analytics:consent', 'granted')
		window.localStorage.setItem('analytics:consent:global', 'never released')
		window.localStorage.setItem('analytics:exclude', '1')
		forgetLegacyConsent(window)
		expect(LEGACY_CONSENT_KEYS).toEqual(['analytics:consent'])
		expect(Object.keys(window.localStorage).sort()).toEqual([
			'analytics:consent:global',
			'analytics:exclude',
		])
	})

	it('survives a storage that throws', () => {
		const throwing = {
			localStorage: {
				removeItem: () => {
					throw new Error('denied')
				},
			},
		} as unknown as TrackerWindow
		expect(() => forgetLegacyConsent(throwing)).not.toThrow()
	})
})
